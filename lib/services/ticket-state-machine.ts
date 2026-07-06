import { prisma } from "../prisma";
import { requestId } from "../utils";
import type { Prisma } from "@prisma/client";

export type TicketStatus =
  | "PENDING_REVIEW"
  | "L1_APPROVING"
  | "L2_APPROVING"
  | "EXECUTING"
  | "REJECTED_RESUBMIT"
  | "COMPLETED"
  | "CLOSED_AUTO_DISMISSED"
  | "ESCALATED_AUTO";

export type ApprovalAction =
  | "APPROVED"
  | "REJECTED"
  | "ESCALATED"
  | "AUTO_TIMEOUT_ESCALATE"
  | "AUTO_TIMEOUT_DISMISS"
  | "QUICK_RELEASE_QC";

export type TransitionEventKind =
  | "L1_ASSIGN"
  | "L2_ASSIGN"
  | "L1_APPROVE"
  | "L2_APPROVE"
  | "L1_REJECT"
  | "L2_REJECT"
  | "L1_TIMEOUT"
  | "L2_TIMEOUT"
  | "PENDING_TIMEOUT"
  | "EXECUTE_DONE"
  | "QC_FORCE_L2"
  | "RESUBMIT"
  | "DISMISS_MAX_RESUBMIT";

export type TransitionEvent = {
  kind: TransitionEventKind;
  actorUserId?: string;
  level?: 1 | 2;
  reason?: string;
  approvalActionOverride?: ApprovalAction;
  deadlineAt?: Date;
  escalatedAt?: Date;
  comment?: string;
};

export const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  PENDING_REVIEW: [
    "L1_APPROVING",
    "ESCALATED_AUTO",
    "CLOSED_AUTO_DISMISSED",
    "REJECTED_RESUBMIT",
    "COMPLETED",
  ],
  L1_APPROVING: [
    "L2_APPROVING",
    "PENDING_REVIEW",
    "EXECUTING",
    "ESCALATED_AUTO",
    "CLOSED_AUTO_DISMISSED",
  ],
  L2_APPROVING: [
    "PENDING_REVIEW",
    "EXECUTING",
    "ESCALATED_AUTO",
    "CLOSED_AUTO_DISMISSED",
  ],
  EXECUTING: ["COMPLETED"],
  REJECTED_RESUBMIT: ["PENDING_REVIEW"],
  ESCALATED_AUTO: ["L2_APPROVING", "EXECUTING"],
  CLOSED_AUTO_DISMISSED: [],
  COMPLETED: [],
};

const MAX_RESUBMIT = Number(process.env.MAX_RESUBMIT ?? 3);

export class TicketStateTransitionError extends Error {
  public readonly from: TicketStatus;
  public readonly to: TicketStatus;
  constructor(from: TicketStatus, to: TicketStatus, reason?: string) {
    super(
      `非法状态转移：${from} -> ${to}${reason ? `，原因：${reason}` : ""}`
    );
    this.name = "TicketStateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class OptimisticConcurrencyError extends Error {
  public readonly ticketId: string;
  constructor(ticketId: string) {
    super(`工单 ${ticketId} 发生并发冲突，请刷新后重试`);
    this.name = "OptimisticConcurrencyError";
    this.ticketId = ticketId;
  }
}

function _deriveStatusFromEvent(
  from: TicketStatus,
  event: TransitionEvent
): TicketStatus | null {
  const { kind } = event;
  switch (kind) {
    case "L1_ASSIGN":
      return from === "PENDING_REVIEW" ? "L1_APPROVING" : null;
    case "L2_ASSIGN":
      if (from === "PENDING_REVIEW" || from === "L1_APPROVING")
        return "L2_APPROVING";
      if (from === "ESCALATED_AUTO") return "L2_APPROVING";
      return null;
    case "L1_APPROVE":
      if (from === "L1_APPROVING") return "EXECUTING";
      return null;
    case "L2_APPROVE":
      if (from === "L2_APPROVING") return "EXECUTING";
      if (from === "ESCALATED_AUTO") return "EXECUTING";
      return null;
    case "L1_REJECT":
      if (from === "L1_APPROVING") return "REJECTED_RESUBMIT";
      return null;
    case "L2_REJECT":
      if (from === "L2_APPROVING") return "PENDING_REVIEW";
      if (from === "ESCALATED_AUTO") return "PENDING_REVIEW";
      return null;
    case "L1_TIMEOUT":
      if (from === "L1_APPROVING") return "ESCALATED_AUTO";
      return null;
    case "L2_TIMEOUT":
      if (from === "L2_APPROVING") return "CLOSED_AUTO_DISMISSED";
      return null;
    case "PENDING_TIMEOUT":
      if (from === "PENDING_REVIEW") return "ESCALATED_AUTO";
      return null;
    case "EXECUTE_DONE":
      if (from === "EXECUTING") return "COMPLETED";
      return null;
    case "QC_FORCE_L2":
      if (from === "PENDING_REVIEW" || from === "L1_APPROVING")
        return "L2_APPROVING";
      return null;
    case "RESUBMIT":
      if (from === "REJECTED_RESUBMIT") return "PENDING_REVIEW";
      return null;
    case "DISMISS_MAX_RESUBMIT":
      return "CLOSED_AUTO_DISMISSED";
    default:
      return null;
  }
}

function _deriveApprovalAction(
  event: TransitionEvent
): ApprovalAction | null {
  if (event.approvalActionOverride) return event.approvalActionOverride;
  switch (event.kind) {
    case "L1_APPROVE":
    case "L2_APPROVE":
      return "APPROVED";
    case "L1_REJECT":
    case "L2_REJECT":
      return "REJECTED";
    case "L1_TIMEOUT":
    case "PENDING_TIMEOUT":
      return "AUTO_TIMEOUT_ESCALATE";
    case "L2_TIMEOUT":
      return "AUTO_TIMEOUT_DISMISS";
    default:
      return null;
  }
}

export async function transitionTicket(
  tx: Prisma.TransactionClient,
  ticketId: string,
  event: TransitionEvent
): Promise<{
  ticket: any;
  approvalRecord?: any;
  idempotencyKey: string;
}> {
  const prismaTx = tx as any;

  const currentTicket = await prismaTx.exception_tickets.findUnique({
    where: { id: ticketId },
  });
  if (!currentTicket) {
    throw new Error(`工单 ${ticketId} 不存在`);
  }

  const fromStatus = currentTicket.currentStatus as TicketStatus;
  const derivedTo = _deriveStatusFromEvent(fromStatus, event);
  if (!derivedTo) {
    throw new TicketStateTransitionError(
      fromStatus,
      (("UNKNOWN_" + event.kind) as any) as TicketStatus,
      `事件 ${event.kind} 无法从 ${fromStatus} 推导目标状态`
    );
  }
  if (!VALID_TRANSITIONS[fromStatus]?.includes(derivedTo)) {
    throw new TicketStateTransitionError(
      fromStatus,
      derivedTo,
      `不在允许的转移列表中`
    );
  }

  const now = new Date();
  const idempotencyKey =
    ticketId +
    ":" +
    event.kind +
    ":" +
    (event.actorUserId ?? "SYSTEM") +
    ":" +
    Date.now();

  const updateData: any = {
    currentStatus: derivedTo,
    lastStatusChangedAt: now,
    version: { increment: 1 },
  };

  if (derivedTo === "CLOSED_AUTO_DISMISSED" || derivedTo === "COMPLETED") {
    updateData.closedAt = now;
  }
  if (
    derivedTo === "ESCALATED_AUTO" ||
    event.kind === "L1_TIMEOUT" ||
    event.kind === "PENDING_TIMEOUT"
  ) {
    updateData.escalatedAt = now;
  }
  if (event.deadlineAt) updateData.deadlineAt = event.deadlineAt;
  if (derivedTo === "REJECTED_RESUBMIT" || event.kind === "RESUBMIT") {
    if (derivedTo === "REJECTED_RESUBMIT") {
      updateData.resubmitCount = { increment: 1 };
    }
  }

  let updated: any;
  try {
    updated = await prismaTx.exception_tickets.update({
      where: {
        id: ticketId,
        version: currentTicket.version,
      },
      data: updateData,
    });
  } catch (e: any) {
    if (
      e?.code === "P2025" ||
      String(e?.message ?? "").includes("Record to update not found")
    ) {
      throw new OptimisticConcurrencyError(ticketId);
    }
    throw e;
  }

  if (
    derivedTo === "REJECTED_RESUBMIT" &&
    (updated.resubmitCount ?? 0) > MAX_RESUBMIT
  ) {
    const forcedUpdate = await prismaTx.exception_tickets.update({
      where: { id: ticketId, version: updated.version },
      data: {
        currentStatus: "CLOSED_AUTO_DISMISSED",
        lastStatusChangedAt: now,
        closedAt: now,
        version: { increment: 1 },
      },
    });
    updated = forcedUpdate;
  }

  const action = _deriveApprovalAction(event);
  let approvalRecord: any = undefined;
  if (action && event.actorUserId) {
    const level =
      event.level ??
      (event.kind.startsWith("L1") || event.kind === "PENDING_TIMEOUT"
        ? 1
        : event.kind.startsWith("L2") || event.kind === "QC_FORCE_L2"
        ? 2
        : event.kind === "L1_TIMEOUT"
        ? 1
        : event.kind === "L2_TIMEOUT"
        ? 2
        : 1);
    try {
      approvalRecord = await prismaTx.approval_records.create({
        data: {
          ticketId,
          approverUserId: event.actorUserId,
          level,
          action,
          comment: event.comment ?? event.reason ?? null,
          beforeStatus: fromStatus,
          afterStatus: updated.currentStatus,
          idempotencyKey,
        },
      });
    } catch (e: any) {
      if (
        e?.code === "P2002" &&
        String(e?.message ?? "").includes("idempotencyKey")
      ) {
        approvalRecord = await prismaTx.approval_records.findUnique({
          where: { idempotencyKey },
        });
      } else {
        throw e;
      }
    }
  }

  return {
    ticket: updated,
    approvalRecord,
    idempotencyKey,
  };
}
