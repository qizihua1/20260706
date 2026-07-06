import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentUser,
  UserRole,
  isQcSupervisor,
} from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError, v2Client } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import { syncWaybillFromV2 } from "@/lib/services/data-sync-service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reqId = requestId();
    const ticketId = params.id;

    const caller = await resolveCurrentUser(headers());
    const isAdmin = caller.roles.includes(UserRole.ADMIN);
    const isApproverL1 = caller.roles.includes(UserRole.APPROVER_L1);
    const isApproverL2 = caller.roles.includes(UserRole.APPROVER_L2);
    const isOperator = caller.roles.includes(UserRole.WAREHOUSE_OPERATOR);
    const isQcSuper = isQcSupervisor(caller);

    const ticket = await (prisma as any).exception_tickets.findUnique({
      where: { id: ticketId },
      include: {
        waybillSnapshot: true,
        reporter: { select: { id: true, username: true, displayName: true } },
        l1Assignee: { select: { id: true, username: true, displayName: true } },
        l2Assignee: { select: { id: true, username: true, displayName: true } },
        approvalRecords: {
          include: {
            approver: {
              select: { id: true, username: true, displayName: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        compensationRecords: true,
        inventoryRecords: true,
        scanRecords: true,
      },
    });

    if (!ticket) {
      return NextResponse.json(
        {
          ok: false,
          error: "工单不存在",
          code: "TICKET_NOT_FOUND",
          requestId: reqId,
        },
        { status: 404 }
      );
    }

    let canAccess = false;
    if (isAdmin) canAccess = true;
    else if (ticket.reportedByUserId === caller.id) canAccess = true;
    else if (isQcSuper && ticket.category === "QC") canAccess = true;
    else if (
      (isApproverL1 && ticket.l1AssigneeId === caller.id) ||
      (isApproverL2 && ticket.l2AssigneeId === caller.id)
    )
      canAccess = true;
    else if (
      (isApproverL1 && ticket.approvalLevelRequired === 1) ||
      (isApproverL2 && ticket.approvalLevelRequired <= 2)
    )
      canAccess = true;

    if (!canAccess) {
      throw new PermissionDeniedError("当前用户无权访问该工单");
    }

    const waybillSnapshot = ticket.waybillSnapshot;
    let v2WaybillSourceInfo: any = {
      source: "local-fallback",
      syncedAt: waybillSnapshot?.syncedAt ?? new Date(),
      requestId: reqId,
      diffWithSnapshot: null,
    };

    try {
      const realtime = await v2Client.getShipment(
        {
          id: waybillSnapshot?.waybillId ?? undefined,
          externalCode: waybillSnapshot?.externalCode ?? undefined,
        },
        { noLog: true }
      );
      if (realtime.source === "v2-realtime" && realtime.shipment) {
        const diff: any = {};
        const localItems = waybillSnapshot?.itemsSnapshot ?? [];
        const rtItems = realtime.shipment.items ?? [];
        if (
          Number(waybillSnapshot?.totalAmount ?? 0) !==
          rtItems.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0)
        ) {
          diff.totalAmount = {
            local: Number(waybillSnapshot?.totalAmount ?? 0),
            realtime: rtItems.reduce(
              (s: number, i: any) => s + (i.quantity ?? 0),
              0
            ),
          };
        }
        if (
          waybillSnapshot?.recipientAddress !== realtime.shipment.recipientAddress
        ) {
          diff.recipientAddress = {
            local: waybillSnapshot?.recipientAddress,
            realtime: realtime.shipment.recipientAddress,
          };
        }
        if (waybillSnapshot?.v2Status !== realtime.shipment.status) {
          diff.v2Status = {
            local: waybillSnapshot?.v2Status,
            realtime: realtime.shipment.status,
          };
        }
        v2WaybillSourceInfo = {
          source: "v2-realtime",
          syncedAt: realtime.fetchedAt,
          requestId: realtime.requestId,
          diffWithSnapshot: Object.keys(diff).length > 0 ? diff : null,
        };
      }
    } catch {
      // fallback info already set
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        ...ticket,
        allScanRecords: ticket.scanRecords,
        waybillSnapshot: ticket.waybillSnapshot
          ? {
              ...ticket.waybillSnapshot,
              itemsSnapshot: ticket.waybillSnapshot.itemsSnapshot,
            }
          : null,
      },
      v2WaybillSourceInfo,
      // 向后兼容：E2E 通过 data.* 直接读取详情
      data: {
        ...ticket,
        allScanRecords: ticket.scanRecords,
        ticket: {
          ...ticket,
          allScanRecords: ticket.scanRecords,
          waybillSnapshot: ticket.waybillSnapshot ?? null,
        },
        waybillSnapshot: ticket.waybillSnapshot ?? null,
        approvalRecords: ticket.approvalRecords ?? [],
        // compensationRecords → payoutRecords（E2E 字段名）
        payoutRecords: Array.isArray(ticket.compensationRecords)
          ? ticket.compensationRecords.map((c: any) => ({
              ...c,
              direction: c?.payoutDirection ?? c?.direction ?? "PAY_TO_CUSTOMER",
              payoutDirection: c?.payoutDirection ?? c?.direction ?? "PAY_TO_CUSTOMER",
              approvalRecordId: c?.approvalRecordId ?? null,
            }))
          : [],
        compensationRecords: ticket.compensationRecords ?? [],
        inventoryRecords: ticket.inventoryRecords ?? [],
        scanRecords: ticket.scanRecords ?? [],
      },
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
