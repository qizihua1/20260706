import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentUser,
  canApproveLevel,
} from "@/lib/auth/user-context";
import {
  PermissionDeniedError,
  cannotApproveOwnTicket,
} from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
  transitionTicket,
} from "@/lib/services/ticket-state-machine";
import { resolveApprovalLevel } from "@/lib/rules/approval-rule-engine";

const PostBodySchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.coerce.number().int().min(1).max(2)]),
  action: z.enum(["APPROVED", "REJECTED", "ESCALATED"]),
  comment: z.string().optional(),
  resubmissionPayload: z
    .object({
      newDescription: z.string().optional(),
      newAmount: z.coerce.number().min(0).optional(),
    })
    .optional(),
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
    const level = (input.level === 1 ? 1 : 2) as 1 | 2;

    const caller = await resolveCurrentUser(headers());
    if (!canApproveLevel(caller, level)) {
      throw new PermissionDeniedError(`当前用户无 L${level} 审批权限`);
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

      if (cannotApproveOwnTicket(ticket.reportedByUserId, caller.id)) {
        return NextResponse.json(
          {
            ok: false,
            error: "禁止自批自核：不能审批自己上报的工单",
            code: "SELF_APPROVAL_FORBIDDEN",
            requestId: reqId,
          },
          { status: 403 }
        );
      }

      const isAssigneeOk =
        (level === 1 &&
          (ticket.l1AssigneeId === caller.id ||
            (canApproveLevel(caller, 1) && ticket.l1AssigneeId !== caller.id))) ||
        (level === 2 &&
          (ticket.l2AssigneeId === caller.id ||
            (canApproveLevel(caller, 2) && ticket.l2AssigneeId !== caller.id)));
      if (!isAssigneeOk && !canApproveLevel(caller, level)) {
        throw new PermissionDeniedError(
          `当前用户未被分配该工单的 L${level} 审批`
        );
      }

      let kind: any;
      if (input.action === "APPROVED") {
        kind = level === 1 ? "L1_APPROVE" : "L2_APPROVE";
      } else if (input.action === "REJECTED") {
        kind = level === 1 ? "L1_REJECT" : "L2_REJECT";
      } else {
        kind = level === 1 ? "L1_APPROVE" : "L2_APPROVE";
      }

      if (input.action === "ESCALATED") {
        kind = level === 1 ? "QC_FORCE_L2" : "L2_APPROVE";
      }

      let transitionRes: any;
      try {
        transitionRes = await transitionTicket(tx, ticketId, {
          kind,
          actorUserId: caller.id,
          level,
          reason: input.comment,
          comment: input.comment,
          approvalActionOverride:
            input.action === "ESCALATED" ? "ESCALATED" : undefined,
        });
      } catch (e: any) {
        if (e instanceof OptimisticConcurrencyError) {
          return NextResponse.json(
            {
              ok: false,
              error: "该工单已被处理，请刷新",
              code: "CONFLICT",
              requestId: e.ticketId ?? reqId,
            },
            { status: 409 }
          );
        }
        throw e;
      }

      let finalTicket = transitionRes.ticket;
      if (
        input.action === "REJECTED" &&
        finalTicket.currentStatus === "REJECTED_RESUBMIT" &&
        input.resubmissionPayload
      ) {
        const newAmount =
          input.resubmissionPayload.newAmount !== undefined
            ? Number(input.resubmissionPayload.newAmount)
            : Number(ticket.amount);
        const levelRes = await resolveApprovalLevel(
          {
            amount: newAmount,
            category: ticket.category,
            severity: ticket.severity,
          },
          tx
        );

        const updateData: any = {};
        if (input.resubmissionPayload.newDescription) {
          updateData.description = input.resubmissionPayload.newDescription;
        }
        if (input.resubmissionPayload.newAmount !== undefined) {
          updateData.amount = input.resubmissionPayload.newAmount;
        }
        updateData.deadlineAt = levelRes.deadlineAt;
        updateData.currentStatus = "PENDING_REVIEW";
        updateData.lastStatusChangedAt = new Date();

        const refreshed = await tx.exception_tickets.update({
          where: { id: ticketId, version: finalTicket.version },
          data: updateData,
        });
        finalTicket = refreshed;
      }

      const requireExecutionNext =
        input.action === "APPROVED" &&
        (finalTicket.currentStatus === "EXECUTING" ||
          finalTicket.currentStatus === "L2_APPROVING" ||
          finalTicket.currentStatus === "ESCALATED_AUTO");

      return {
        ok: true,
        ticket: finalTicket,
        approvalRecord: transitionRes.approvalRecord ?? null,
        requireExecutionNext,
      };
    });

    if (txResult instanceof NextResponse) return txResult;
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
