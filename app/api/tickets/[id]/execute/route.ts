import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentUser,
  UserRole,
  canApproveLevel,
} from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import {
  executeApprovalActionsInTx,
  ExecuteAction,
} from "@/lib/services/consistency-engine";
import {
  markV2ExceptionStatus,
} from "@/lib/services/data-sync-service";

const VALID_ACTIONS: ExecuteAction[] = [
  "QC_RELEASE",
  "QC_RETURN_SUPPLIER",
  "QC_REPURCHASE",
  "QC_DOWNGRADE",
  "LOGISTICS_COMPENSATE_ONLY",
  "LOGISTICS_RESHIP",
  "LOGISTICS_RETURN_RESHIP",
  "LOGISTICS_ADDRESS_FIX_RESHIP",
];

const PostBodySchema = z.object({
  executeAction: z.enum(VALID_ACTIONS as [ExecuteAction, ...ExecuteAction[]]),
  payoutAmount: z.coerce.number().min(0).optional(),
  reshipmentSku: z
    .array(
      z.object({
        skuCode: z.string().min(1),
        skuName: z.string().optional(),
        qty: z.coerce.number().int().min(1),
      })
    )
    .optional(),
  remark: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reqId = requestId();
    const ticketId = params.id;
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
    const isAdmin = caller.roles.includes(UserRole.ADMIN);

    const preTicket = await (prisma as any).exception_tickets.findUnique({
      where: { id: ticketId },
    });
    if (!preTicket) {
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

    let isLastApprover = false;
    const lastApproved = await (prisma as any).approval_records.findFirst({
      where: { ticketId, action: "APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    if (lastApproved?.approverUserId === caller.id) {
      isLastApprover = true;
    }
    const ticketLevel = (preTicket.approvalLevelRequired ?? 1) as 1 | 2;
    const hasApproveLevel = canApproveLevel(caller, ticketLevel);

    if (!isAdmin && !isLastApprover && !hasApproveLevel) {
      throw new PermissionDeniedError(
        "当前用户无执行权限（需 ADMIN / 最后审批人 / 对应审批级别）"
      );
    }

    const txResult = await (prisma as any).$transaction(async (tx: any) => {
      const ticket = await tx.exception_tickets.findUnique({
        where: { id: ticketId },
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

      const latestApproved = await tx.approval_records.findFirst({
        where: { ticketId, action: "APPROVED" },
        orderBy: { createdAt: "desc" },
      });

      const res = await executeApprovalActionsInTx(tx, {
        ticket,
        approvalRecord: latestApproved,
        executeAction: input.executeAction,
        payoutAmount:
          input.payoutAmount !== undefined
            ? Number(input.payoutAmount)
            : Number(ticket.amount ?? 0),
        reshipmentSku: input.reshipmentSku,
        remark: input.remark,
      });

      return res;
    });

    if (txResult instanceof NextResponse) return txResult;

    try {
      await markV2ExceptionStatus(txResult.finalTicket, false);
    } catch {
      // best-effort ignore
    }

    return NextResponse.json({
      ok: true,
      finalTicket: txResult.finalTicket,
      compensation: txResult.compensation,
      inventoryChanges: txResult.inventoryChanges,
      batchStatusChanged:
        Array.isArray(txResult.inventoryChanges) &&
        txResult.inventoryChanges.length > 0,
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
        error: "该工单已被处理，请刷新",
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
