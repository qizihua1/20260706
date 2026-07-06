import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
  transitionTicket,
} from "@/lib/services/ticket-state-machine";
import { resolveApprovalLevel } from "@/lib/rules/approval-rule-engine";

const PostBodySchema = z.object({
  newDescription: z.string().min(1).optional(),
  newAmount: z.coerce.number().min(0).optional(),
  newEvidenceUrls: z.array(z.string()).optional(),
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

    if (preTicket.reportedByUserId !== caller.id) {
      throw new PermissionDeniedError(
        "只有原上报人可重新提交被拒绝的工单"
      );
    }

    if (preTicket.currentStatus !== "REJECTED_RESUBMIT") {
      return NextResponse.json(
        {
          ok: false,
          error: `当前工单状态 ${preTicket.currentStatus} 不允许重提，仅 REJECTED_RESUBMIT 可重提`,
          code: "INVALID_STATUS",
          requestId: reqId,
        },
        { status: 422 }
      );
    }

    const txResult = await (prisma as any).$transaction(async (tx: any) => {
      const transitionRes = await transitionTicket(tx, ticketId, {
        kind: "RESUBMIT",
        actorUserId: caller.id,
        comment: "重新提交",
        level: 1,
      });

      let finalTicket = transitionRes.ticket;
      const newAmount =
        input.newAmount !== undefined
          ? Number(input.newAmount)
          : Number(preTicket.amount ?? 0);
      const needAmountUpdate =
        input.newAmount !== undefined &&
        Number(input.newAmount) !== Number(preTicket.amount);
      const needDescUpdate =
        input.newDescription !== undefined &&
        input.newDescription !== preTicket.description;
      const needEvidenceUpdate =
        input.newEvidenceUrls !== undefined;

      if (needAmountUpdate || needDescUpdate || needEvidenceUpdate) {
        const levelRes = await resolveApprovalLevel(
          {
            amount: newAmount,
            category: preTicket.category,
            severity: preTicket.severity,
          },
          tx
        );
        const updateData: any = {};
        if (needDescUpdate) updateData.description = input.newDescription;
        if (needAmountUpdate) updateData.amount = input.newAmount;
        if (needEvidenceUpdate)
          updateData.evidenceUrls = input.newEvidenceUrls ?? null;
        updateData.deadlineAt = levelRes.deadlineAt;
        updateData.lastStatusChangedAt = new Date();

        finalTicket = await tx.exception_tickets.update({
          where: { id: ticketId, version: finalTicket.version },
          data: updateData,
        });
      }

      return {
        ok: true,
        ticket: finalTicket,
        approvalRecord: transitionRes.approvalRecord,
      };
    });

    return NextResponse.json(txResult);
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
