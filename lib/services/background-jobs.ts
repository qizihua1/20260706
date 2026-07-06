import { prisma } from "../prisma";
import { transitionTicket, OptimisticConcurrencyError } from "./ticket-state-machine";
import type { TicketStatus } from "./ticket-state-machine";

export type { TicketStatus };

export interface ProcessScheduledTimeoutsResult {
  escalated: number;
  dismissed: number;
  tickets: string[];
}

export interface ProcessDisabledApproversResult {
  reassigned: number;
  tickets: string[];
}

const L2_TIMEOUT_DISMISS_AFTER_MS = 24 * 60 * 60 * 1000;

export async function processScheduledTimeouts(): Promise<ProcessScheduledTimeoutsResult> {
  const now = new Date();
  const escalatedTickets: string[] = [];
  const dismissedTickets: string[] = [];
  let escalated = 0;
  let dismissed = 0;

  const timeoutCandidates = await prisma.exception_tickets.findMany({
    where: {
      currentStatus: {
        in: [
          "PENDING_REVIEW",
          "L1_APPROVING",
          "L2_APPROVING",
        ] as TicketStatus[],
      },
      deadlineAt: {
        lt: now,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const ticket of timeoutCandidates) {
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        const fresh = await tx.exception_tickets.findUnique({
          where: { id: ticket.id },
        });
        if (!fresh) return;
        if (fresh.deadlineAt && fresh.deadlineAt.getTime() > now.getTime())
          return;

        const status = fresh.currentStatus as TicketStatus;
        if (status === "PENDING_REVIEW") {
          try {
            const r = await transitionTicket(tx, fresh.id, {
              kind: "PENDING_TIMEOUT",
              reason: "待审核超时，自动升级 L2",
              comment: "系统：待审核超时自动升级",
              level: 1,
            });
            escalated++;
            escalatedTickets.push(fresh.id);
            if (r.ticket.currentStatus === "ESCALATED_AUTO") {
              await transitionTicket(tx, fresh.id, {
                kind: "L2_ASSIGN",
                reason: "自动升级后进入 L2",
                comment: "系统：自动转入 L2 审批",
                level: 2,
              });
            }
          } catch (e) {
            if (e instanceof OptimisticConcurrencyError) return;
            throw e;
          }
        } else if (status === "L1_APPROVING") {
          try {
            const r = await transitionTicket(tx, fresh.id, {
              kind: "L1_TIMEOUT",
              reason: "L1 审批超时，自动升级 L2",
              comment: "系统：L1 审批超时自动升级",
              level: 1,
            });
            escalated++;
            escalatedTickets.push(fresh.id);
            if (r.ticket.currentStatus === "ESCALATED_AUTO") {
              await transitionTicket(tx, fresh.id, {
                kind: "L2_ASSIGN",
                reason: "L1 超时升级到 L2",
                comment: "系统：L1 超时后转入 L2 审批",
                level: 2,
              });
            }
          } catch (e) {
            if (e instanceof OptimisticConcurrencyError) return;
            throw e;
          }
        } else if (status === "L2_APPROVING") {
          const deadline = fresh.deadlineAt
            ? new Date(fresh.deadlineAt).getTime()
            : 0;
          if (now.getTime() - deadline >= L2_TIMEOUT_DISMISS_AFTER_MS) {
            try {
              await transitionTicket(tx, fresh.id, {
                kind: "L2_TIMEOUT",
                reason: "L2 审批超时超过 24h，自动关闭",
                comment: "系统：L2 超时自动驳回关闭",
                level: 2,
              });
              dismissed++;
              dismissedTickets.push(fresh.id);
            } catch (e) {
              if (e instanceof OptimisticConcurrencyError) return;
              throw e;
            }
          }
        }
      });
    } catch (e: any) {
      console.error(`[processScheduledTimeouts] 处理工单 ${ticket.id} 失败:`, e?.message ?? e);
    }
  }

  const qcHoldCandidates = await prisma.exception_tickets.findMany({
    where: {
      category: "QC",
      currentStatus: {
        in: ["PENDING_REVIEW", "L1_APPROVING"] as TicketStatus[],
      },
      approvalRuleSnapshot: { not: PrismaJsonNullWorkaround() },
    },
  });

  for (const ticket of qcHoldCandidates) {
    try {
      const snapshot: any = (ticket as any).approvalRuleSnapshot ?? {};
      const holdMinutes = snapshot.qcHoldTimeoutMinutes ?? null;
      if (!holdMinutes) continue;
      const reportedAt = new Date(ticket.reportedAt).getTime();
      const holdDeadline = reportedAt + Number(holdMinutes) * 60 * 1000;
      if (now.getTime() < holdDeadline) continue;

      await (prisma as any).$transaction(async (tx: any) => {
        const fresh = await tx.exception_tickets.findUnique({
          where: { id: ticket.id },
        });
        if (!fresh) return;
        if (
          fresh.currentStatus !== "PENDING_REVIEW" &&
          fresh.currentStatus !== "L1_APPROVING"
        )
          return;
        try {
          await transitionTicket(tx, fresh.id, {
            kind: "QC_FORCE_L2",
            reason: `品控 HOLD 超过 ${holdMinutes} 分钟，强制升级 L2`,
            comment: `系统：品控 HOLD 超时（${holdMinutes}min）强制转 L2`,
            level: 2,
          });
          escalated++;
          escalatedTickets.push(fresh.id);
        } catch (e) {
          if (e instanceof OptimisticConcurrencyError) return;
          throw e;
        }
      });
    } catch (e: any) {
      console.error(`[processScheduledTimeouts] QC HOLD 工单 ${ticket.id} 处理失败:`, e?.message ?? e);
    }
  }

  return {
    escalated,
    dismissed,
    tickets: Array.from(new Set([...escalatedTickets, ...dismissedTickets])),
  };
}

function PrismaJsonNullWorkaround(): any {
  return undefined as any;
}

export async function processDisabledApproversReassignment(): Promise<ProcessDisabledApproversResult> {
  const reassignedTickets: string[] = [];
  let reassigned = 0;

  const disabledApprovers = await prisma.users.findMany({
    where: {
      isActive: false,
      roles: {
        hasSome: ["APPROVER_L1", "APPROVER_L2", "ADMIN"],
      },
    },
  });

  const disabledIds = disabledApprovers.map((u) => u.id);
  if (disabledIds.length === 0) {
    return { reassigned: 0, tickets: [] };
  }

  const affectedTickets = await prisma.exception_tickets.findMany({
    where: {
      currentStatus: {
        in: ["L1_APPROVING", "L2_APPROVING"] as TicketStatus[],
      },
      OR: [
        { l1AssigneeId: { in: disabledIds } },
        { l2AssigneeId: { in: disabledIds } },
      ],
    },
  });

  const activeL1 = await prisma.users.findMany({
    where: { isActive: true, roles: { hasSome: ["APPROVER_L1", "ADMIN"] } },
  });
  const activeL2 = await prisma.users.findMany({
    where: { isActive: true, roles: { hasSome: ["APPROVER_L2", "ADMIN"] } },
  });
  const adminUsers = await prisma.users.findMany({
    where: { isActive: true, roles: { has: "ADMIN" } },
  });

  const fallbackL1 =
    activeL1[0]?.id ?? adminUsers[0]?.id ?? null;
  const fallbackL2 =
    activeL2[0]?.id ?? activeL1[0]?.id ?? adminUsers[0]?.id ?? null;

  for (const ticket of affectedTickets) {
    try {
      const updateData: any = {};
      let changed = false;

      if (
        ticket.l1AssigneeId &&
        disabledIds.includes(ticket.l1AssigneeId) &&
        fallbackL1
      ) {
        updateData.l1AssigneeId = fallbackL1;
        changed = true;
      }
      if (
        ticket.l2AssigneeId &&
        disabledIds.includes(ticket.l2AssigneeId) &&
        fallbackL2
      ) {
        updateData.l2AssigneeId = fallbackL2;
        changed = true;
      }

      if (changed) {
        await prisma.exception_tickets.update({
          where: { id: ticket.id },
          data: updateData,
        });
        reassigned++;
        reassignedTickets.push(ticket.id);
      }
    } catch (e: any) {
      console.error(`[processDisabledApproversReassignment] 改派工单 ${ticket.id} 失败:`, e?.message ?? e);
    }
  }

  return {
    reassigned,
    tickets: reassignedTickets,
  };
}
