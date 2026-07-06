import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";

export type TicketCategory = "LOGISTICS" | "QC";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ThresholdScope = "GLOBAL" | "BY_CATEGORY" | "BY_SEVERITY";

export interface ResolveApprovalLevelParams {
  amount: number;
  category: TicketCategory;
  severity: Severity;
}

export interface ResolveApprovalLevelResult {
  level: 1 | 2;
  ruleCode: string;
  matchedThreshold: any;
  timeoutMinutes: number;
  qcHoldTimeoutMinutes?: number;
  deadlineAt: Date;
}

function _inRange(
  amount: number,
  min: number,
  max: number | null | undefined
): boolean {
  if (amount < min) return false;
  if (max !== null && max !== undefined && amount >= Number(max)) return false;
  return true;
}

export async function resolveApprovalLevel(
  params: ResolveApprovalLevelParams,
  tx: Prisma.TransactionClient = prisma as any
): Promise<ResolveApprovalLevelResult> {
  const { amount, category, severity } = params;

  const allThresholds = await (tx as any).approval_thresholds.findMany({
    where: { isEnabled: true },
    orderBy: [
      {
        scope: "desc",
      },
      { createdAt: "asc" },
    ],
  });

  const priority: ThresholdScope[] = ["BY_SEVERITY", "BY_CATEGORY", "GLOBAL"];

  for (const scope of priority) {
    const candidates = allThresholds.filter((t: any) => t.scope === scope);
    for (const t of candidates) {
      const minAmount = Number(t.minAmount ?? 0);
      const maxAmount = t.maxAmount !== null && t.maxAmount !== undefined
        ? Number(t.maxAmount)
        : null;

      if (scope === "BY_SEVERITY") {
        if (t.severity === severity && _inRange(amount, minAmount, maxAmount)) {
          return _buildResult(t);
        }
      } else if (scope === "BY_CATEGORY") {
        if (t.category === category && _inRange(amount, minAmount, maxAmount)) {
          return _buildResult(t);
        }
      } else if (scope === "GLOBAL") {
        if (_inRange(amount, minAmount, maxAmount)) {
          return _buildResult(t);
        }
      }
    }
  }

  const now = new Date();
  const timeoutMinutes = 1440;
  return {
    level: 1,
    ruleCode: "FALLBACK_DEFAULT_L1",
    matchedThreshold: null,
    timeoutMinutes,
    deadlineAt: new Date(now.getTime() + timeoutMinutes * 60 * 1000),
  };
}

function _buildResult(t: any): ResolveApprovalLevelResult {
  const now = new Date();
  const level = (t.approvalLevel === 2 ? 2 : 1) as 1 | 2;
  const timeoutMinutes = Number(t.timeoutMinutes ?? 1440);
  return {
    level,
    ruleCode: t.ruleCode ?? `RULE-${t.id ?? "UNK"}`,
    matchedThreshold: t,
    timeoutMinutes,
    qcHoldTimeoutMinutes:
      t.qcHoldTimeoutMinutes !== null && t.qcHoldTimeoutMinutes !== undefined
        ? Number(t.qcHoldTimeoutMinutes)
        : undefined,
    deadlineAt: new Date(now.getTime() + timeoutMinutes * 60 * 1000),
  };
}
