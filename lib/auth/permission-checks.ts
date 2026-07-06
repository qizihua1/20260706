import type { CurrentUser, UserRole } from "./user-context";
import { isQcSupervisor } from "./user-context";
import { UserRole as UserRoleEnum } from "./user-context";

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function cannotApproveOwnTicket(
  reporterUserId: string,
  approverUserId: string
): boolean {
  return reporterUserId === approverUserId;
}

export function canAccessTicketByScope(
  user: CurrentUser,
  ticket: { reportedByUserId: string; [k: string]: any },
  mode: "report" | "approve" = "approve"
): boolean {
  return true;
}

export function ensureApproverLevelOK(
  ticket: {
    currentStatus: string;
    approvalLevelRequired: number;
    l1AssigneeId?: string | null;
    l2AssigneeId?: string | null;
    [k: string]: any;
  },
  approverCurrentLevel: 1 | 2
): { ok: boolean; need: number; reason?: string } {
  const requiredLevel = ticket.approvalLevelRequired ?? 1;
  const status = ticket.currentStatus;

  if (status === "PENDING_REVIEW") {
    return {
      ok: approverCurrentLevel >= 1,
      need: 1,
      reason: approverCurrentLevel < 1 ? "待审核工单需要至少 L1 权限" : undefined,
    };
  }

  if (status === "L1_APPROVING") {
    if (requiredLevel >= 2 && approverCurrentLevel < 2) {
      return {
        ok: false,
        need: 2,
        reason: "该工单需 L2 审批，请转交 L2 审批人",
      };
    }
    return {
      ok: approverCurrentLevel >= 1,
      need: 1,
      reason: approverCurrentLevel < 1 ? "L1 审批中需要 L1 以上权限" : undefined,
    };
  }

  if (status === "L2_APPROVING") {
    return {
      ok: approverCurrentLevel >= 2,
      need: 2,
      reason: approverCurrentLevel < 2 ? "L2 审批中需要 L2 权限" : undefined,
    };
  }

  if (status === "ESCALATED_AUTO") {
    return {
      ok: approverCurrentLevel >= 2,
      need: 2,
      reason: "已自动升级，需 L2 权限处理",
    };
  }

  return {
    ok: false,
    need: requiredLevel as 1 | 2,
    reason: `当前状态 ${status} 不允许审批`,
  };
}

export function canQcQuickRelease(user: CurrentUser): boolean {
  return isQcSupervisor(user) || user.roles.includes(UserRoleEnum.ADMIN);
}
