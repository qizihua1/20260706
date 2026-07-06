import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole, hasAnyRole } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { evaluateQcCheck } from "@/lib/rules/qc-rule-engine";
import { syncWaybillFromV2 } from "@/lib/services/data-sync-service";
import { v2Client, V2ApiError } from "@/lib/v2-api-client";
import { requestId, generateTicketNo } from "@/lib/utils";
import { OptimisticConcurrencyError, TicketStateTransitionError } from "@/lib/services/ticket-state-machine";

const PostBodySchema = z
  .object({
    waybillExternalCode: z.string().optional(),
    waybillId: z.string().optional(),
    skuCode: z.string().min(1),
    skuName: z.string().optional(),
    batchNo: z.string().min(1),
    scanQty: z.coerce.number().int().min(1).default(1),
    scanDevice: z.string().default("manual"),
    expectedQty: z.coerce.number().int().optional(),
    specA: z.coerce.number().optional(),
    specB: z.coerce.number().optional(),
    damageLevel: z.coerce.number().int().min(0).max(5).optional(),
    labelPresent: z.boolean().default(true),
    batchExpireDate: z
      .string()
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
  })
  .refine(
    (d) => d.waybillExternalCode || d.waybillId,
    "必须提供 waybillExternalCode 或 waybillId 之一"
  );

const QC_CATEGORY_TO_SUBTYPE: Record<string, string> = {
  QTY_DIFF: "数量不符",
  DAMAGE: "外观破损",
  SPEC_MISMATCH: "规格不符",
  LABEL_ERROR: "标签错误",
  BATCH_ERROR: "批次异常",
};

const TERMINAL_STATUSES = ["COMPLETED", "CLOSED_AUTO_DISMISSED"];

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
    const body = await req.json();
    const parsed = PostBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.errors.map((e) => e.message).join("; "),
          code: "BAD_PARAM",
          requestId: reqId,
        },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const caller = await resolveCurrentUser(headers());
    if (
      !hasAnyRole(caller, [
        UserRole.WAREHOUSE_OPERATOR,
        UserRole.QC_SUPERVISOR,
        UserRole.ADMIN,
      ])
    ) {
      throw new PermissionDeniedError(
        "当前用户无扫描/品控操作权限（需 WAREHOUSE_OPERATOR / QC_SUPERVISOR / ADMIN）"
      );
    }

    const snapshot = await syncWaybillFromV2(
      {
        externalCode: input.waybillExternalCode,
        waybillId: input.waybillId,
        callerUserId: caller.id,
        forceRefresh: false,
      },
      prisma as any
    );
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          error: "运单不存在或无法同步（V2 异常且本地无快照）",
          code: "WAYBILL_NOT_FOUND",
          requestId: reqId,
        },
        { status: 404 }
      );
    }

    const idOrCode = input.waybillExternalCode ?? snapshot.waybillId;
    const skuVerify = await v2Client.verifySkuBelongs(
      {
        shipmentIdOrExternalCode: idOrCode,
        skuCode: input.skuCode,
      },
      { callerUserId: caller.id }
    );
    if (!skuVerify.belongs) {
      return NextResponse.json(
        {
          ok: false,
          error: `SKU ${input.skuCode} 不属于该运单`,
          code: "SKU_NOT_IN_WAYBILL",
          requestId: skuVerify.requestId ?? reqId,
        },
        { status: 422 }
      );
    }

    const qcResult = await evaluateQcCheck(
      {
        skuCode: input.skuCode,
        skuName: input.skuName,
        scanQty: input.scanQty,
        expectedQty: input.expectedQty,
        specA: input.specA,
        specB: input.specB,
        damageLevel: input.damageLevel,
        labelPresent: input.labelPresent,
        batchNo: input.batchNo,
        batchExpireDate: input.batchExpireDate,
      },
      prisma as any
    );

    const finalQcResult = qcResult.passed ? ("PASSED" as const) : ("HELD" as const);
    const qcBatchStatus = qcResult.passed ? ("FREE" as const) : ("LOCKED" as const);

    const existingLockedBatch = await (prisma as any).scan_records.findFirst({
      where: {
        batchNo: input.batchNo,
        skuCode: input.skuCode,
        qcBatchStatus: "LOCKED",
        ticketId: { not: null },
      },
      include: { ticket: true },
      orderBy: { createdAt: "desc" },
    });

    const hasOpenTicket =
      existingLockedBatch?.ticket &&
      !TERMINAL_STATUSES.includes(existingLockedBatch.ticket.currentStatus);

    let duplicated = false;
    let existingTicketId: string | null = null;
    let createdTicket: any = null;

    const txResult = await (prisma as any).$transaction(async (tx: any) => {
      let localTicket: any = null;

      if (hasOpenTicket) {
        duplicated = true;
        existingTicketId = existingLockedBatch.ticket.id;
      } else if (!qcResult.passed && qcResult.shouldAutoCreateTicket && qcResult.hitRule) {
        const activeL1 = await tx.users.findFirst({
          where: {
            isActive: true,
            roles: { hasSome: [UserRole.APPROVER_L1, UserRole.ADMIN] },
          },
          orderBy: { username: "asc" },
        });
        const activeL2 = await tx.users.findFirst({
          where: {
            isActive: true,
            roles: { hasSome: [UserRole.APPROVER_L2, UserRole.ADMIN] },
          },
          orderBy: { username: "asc" },
        });

        const level = qcResult.routeToApprovalLevel ?? 2;
        const currentStatus =
          level === 1 ? "L1_APPROVING" : "L2_APPROVING";

        const seqNum = Math.floor(Math.random() * 9000) + 1000;
        const ticketNo = generateTicketNo(new Date(), seqNum);

        const now = new Date();
        const matchedThreshold: any = {
          matchedCondition: qcResult.hitRule.matchedCondition,
          severity: qcResult.hitRule.severity,
          routeToApprovalLevel: level,
        };

        localTicket = await tx.exception_tickets.create({
          data: {
            ticketNo,
            source: "SCAN_TRIGGER",
            category: "QC",
            subType:
              QC_CATEGORY_TO_SUBTYPE[qcResult.hitRule.category] ??
              qcResult.hitRule.category,
            severity: qcResult.hitRule.severity,
            currentStatus,
            waybillSnapshotId: snapshot.id,
            relatedWaybillId: snapshot.waybillId,
            reportedByUserId: caller.id,
            reportedAt: now,
            description: qcResult.hitRule.detail,
            evidenceUrls: null,
            amount: snapshot.totalAmount ?? 0,
            approvalLevelRequired: level,
            l1AssigneeId: activeL1?.id ?? null,
            l2AssigneeId: activeL2?.id ?? null,
            resubmitCount: 0,
            lastStatusChangedAt: now,
            deadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            approvalRuleSnapshot: matchedThreshold,
            qcBatchLockId: `${input.batchNo}-${input.skuCode}`,
            version: 0,
          },
        });
      }

      const scanNo = `SC${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const scanRecordData: any = {
        scanNo,
        waybillSnapshotId: snapshot.id,
        relatedWaybillId: snapshot.waybillId,
        skuCode: input.skuCode,
        skuName: input.skuName ?? null,
        batchNo: input.batchNo,
        scanQty: input.scanQty,
        scannedByUserId: caller.id,
        scanDevice: input.scanDevice,
        qcResult: finalQcResult,
        qcRuleHitId: qcResult.hitRule?.id ?? null,
        qcRuleHitDetail: qcResult.qcRuleHitDetail ?? null,
        qcBatchStatus,
        ticketId: localTicket ? localTicket.id : hasOpenTicket ? existingTicketId : null,
      };

      const scanRecord = await tx.scan_records.create({
        data: scanRecordData,
      });

      return {
        scanRecord,
        localTicket,
      };
    });

    createdTicket = txResult.localTicket;

    return NextResponse.json({
      ok: true,
      qcResult: finalQcResult,
      scanRecord: txResult.scanRecord,
      ticket: createdTicket ?? undefined,
      duplicated,
      existingTicketId: duplicated ? existingTicketId : undefined,
      hitRuleDetail: qcResult.hitRule
        ? {
            ruleCode: qcResult.hitRule.ruleCode,
            ruleName: qcResult.hitRule.ruleName,
            category: qcResult.hitRule.category,
            severity: qcResult.hitRule.severity,
            detail: qcResult.hitRule.detail,
            computed: qcResult.qcRuleHitDetail?.computedValues,
          }
        : null,
      message: duplicated ? "已存在未关闭品控工单，仅追加扫描记录" : undefined,
    });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

function handleRouteError(err: any): NextResponse {
  const reqId = requestId();
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.errors.map((e) => e.message).join("; "),
        code: "BAD_PARAM",
        requestId: reqId,
      },
      { status: 400 }
    );
  }
  if (err instanceof V2ApiError) {
    const statusMap: Record<string, number> = {
      NETWORK_TIMEOUT: 504,
      AUTH: 401,
      NOT_FOUND: 404,
      BAD_PARAM: 400,
      V2_SERVER_ERROR: 502,
      UNKNOWN: 500,
    };
    const status = statusMap[err.category] ?? 500;
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: err.category,
        requestId: err.requestId ?? reqId,
      },
      { status }
    );
  }
  if (err instanceof OptimisticConcurrencyError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "CONFLICT",
        requestId: err.ticketId ?? reqId,
      },
      { status: 409 }
    );
  }
  if (err instanceof PermissionDeniedError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "PERMISSION_DENIED",
        requestId: reqId,
      },
      { status: 403 }
    );
  }
  if (err instanceof TicketStateTransitionError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "STATE_TRANSITION_ERROR",
        requestId: reqId,
      },
      { status: 422 }
    );
  }
  const isDev = process.env.NODE_ENV !== "production";
  return NextResponse.json(
    {
      ok: false,
      error: isDev ? err?.message ?? String(err) : "系统错误",
      code: "INTERNAL_ERROR",
      requestId: reqId,
    },
    { status: 500 }
  );
}
