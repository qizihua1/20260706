import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole, hasAnyRole } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId, generateTicketNo } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import {
  syncWaybillFromV2,
  markV2ExceptionStatus,
} from "@/lib/services/data-sync-service";
import { resolveApprovalLevel } from "@/lib/rules/approval-rule-engine";

const VALID_SUBTYPES = ["丢件", "破损", "拒收", "超时未签收", "地址错误"];

const PostBodySchema = z
  .object({
    waybillExternalCode: z.string().optional(),
    waybillId: z.string().optional(),
    category: z.literal("LOGISTICS").default("LOGISTICS"),
    subType: z.enum(VALID_SUBTYPES as [string, ...string[]]),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
    description: z.string().min(1, "描述必填"),
    evidenceUrls: z.array(z.string()).optional(),
    amount: z.coerce.number().min(0).optional(),
    photoEvidence: z.any().optional(),
  })
  .refine(
    (d) => d.waybillExternalCode || d.waybillId,
    "必须提供 waybillExternalCode 或 waybillId 之一"
  );

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
        "当前用户无异常上报权限（需 WAREHOUSE_OPERATOR / QC_SUPERVISOR / ADMIN）"
      );
    }

    const snapshot = await syncWaybillFromV2(
      {
        externalCode: input.waybillExternalCode,
        waybillId: input.waybillId,
        callerUserId: caller.id,
        forceRefresh: true,
      },
      prisma as any
    );
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          error: "运单不存在或无法同步",
          code: "WAYBILL_NOT_FOUND",
          requestId: reqId,
        },
        { status: 404 }
      );
    }

    const existTicket = await (prisma as any).exception_tickets.findFirst({
      where: {
        relatedWaybillId: snapshot.waybillId,
        subType: input.subType,
        category: "LOGISTICS",
        currentStatus: { notIn: TERMINAL_STATUSES },
      },
    });
    if (existTicket) {
      return NextResponse.json(
        {
          ok: false,
          error: "该运单已存在同类型未关闭异常工单，请勿重复上报",
          code: "TICKET_ALREADY_EXISTS",
          existingTicket: existTicket,
          requestId: reqId,
        },
        { status: 409 }
      );
    }

    const amount =
      input.amount !== undefined
        ? input.amount
        : Number(snapshot.totalAmount ?? 0);

    const levelResult = await resolveApprovalLevel(
      {
        amount,
        category: "LOGISTICS",
        severity: input.severity as any,
      },
      prisma as any
    );

    const activeL1 = await (prisma as any).users.findFirst({
      where: {
        isActive: true,
        roles: { hasSome: [UserRole.APPROVER_L1, UserRole.ADMIN] },
      },
      orderBy: { username: "asc" },
    });
    const activeL2 = await (prisma as any).users.findFirst({
      where: {
        isActive: true,
        roles: { hasSome: [UserRole.APPROVER_L2, UserRole.ADMIN] },
      },
      orderBy: { username: "asc" },
    });

    const currentStatus = levelResult.level === 1 ? "L1_APPROVING" : "L2_APPROVING";
    const seqNum = Math.floor(Math.random() * 9000) + 1000;
    const ticketNo = generateTicketNo(new Date(), seqNum);
    const now = new Date();

    const createdTicket = await (prisma as any).exception_tickets.create({
      data: {
        ticketNo,
        source: "MANUAL_REPORT",
        category: "LOGISTICS",
        subType: input.subType,
        severity: input.severity,
        currentStatus,
        waybillSnapshotId: snapshot.id,
        relatedWaybillId: snapshot.waybillId,
        reportedByUserId: caller.id,
        reportedAt: now,
        description: input.description,
        evidenceUrls: input.evidenceUrls ?? null,
        amount,
        approvalLevelRequired: levelResult.level,
        l1AssigneeId: activeL1?.id ?? null,
        l2AssigneeId: activeL2?.id ?? null,
        resubmitCount: 0,
        lastStatusChangedAt: now,
        deadlineAt: levelResult.deadlineAt,
        approvalRuleSnapshot: levelResult.matchedThreshold
          ? {
              matchedThreshold: levelResult.matchedThreshold,
              ruleCode: levelResult.ruleCode,
              timeoutMinutes: levelResult.timeoutMinutes,
            }
          : null,
        version: 0,
      },
    });

    try {
      await markV2ExceptionStatus(createdTicket, true);
    } catch {
      // ignore async best-effort
    }

    return NextResponse.json({
      ok: true,
      ticket: createdTicket,
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
