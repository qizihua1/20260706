import { prisma } from "../prisma";
import type { Prisma } from "@prisma/client";
import type { Severity } from "./approval-rule-engine";

export type QcRuleCategory =
  | "QTY_DIFF"
  | "DAMAGE"
  | "SPEC_MISMATCH"
  | "LABEL_ERROR"
  | "BATCH_ERROR";
export type { Severity };

export interface EvaluateQcCheckParams {
  skuCode: string;
  skuName?: string;
  scanQty: number;
  expectedQty?: number;
  specA?: number;
  specB?: number;
  damageLevel?: number;
  labelPresent?: boolean;
  batchNo?: string;
  batchExpireDate?: Date;
  today?: Date;
}

export interface QcHitRule {
  id: string;
  ruleCode: string;
  ruleName: string;
  category: QcRuleCategory;
  severity: Severity;
  detail: string;
  matchedCondition: any;
}

export interface EvaluateQcCheckResult {
  passed: boolean;
  hitRule: QcHitRule | null;
  shouldAutoCreateTicket: boolean;
  routeToApprovalLevel: number;
  qcRuleHitDetail: {
    matchedCondition: any;
    computedValues: Record<string, any>;
  } | null;
}

export async function evaluateQcCheck(
  params: EvaluateQcCheckParams,
  tx: Prisma.TransactionClient = prisma as any
): Promise<EvaluateQcCheckResult> {
  const today = params.today ?? new Date();

  const rules = await (tx as any).qc_rules.findMany({
    where: { isEnabled: true },
    orderBy: { sortOrder: "asc" },
  });

  const computedValues: Record<string, any> = {
    skuCode: params.skuCode,
    skuName: params.skuName,
    scanQty: params.scanQty,
    expectedQty: params.expectedQty,
    specA: params.specA,
    specB: params.specB,
    damageLevel: params.damageLevel,
    labelPresent: params.labelPresent,
    batchNo: params.batchNo,
    batchExpireDate: params.batchExpireDate,
    today,
  };

  for (const rule of rules) {
    const cond: any = rule.triggerCondition || {};
    const category: QcRuleCategory = rule.category;
    let matched = false;
    let detail = "";

    if (category === "QTY_DIFF") {
      const expected = params.expectedQty ?? 0;
      const scan = params.scanQty ?? 0;
      const denom = Math.max(expected, 1);
      const qtyDiffPct = (Math.abs(expected - scan) / denom) * 100;
      const threshold = Number(cond.qtyDiffPctGte ?? 5);
      computedValues.qtyDiffPct = qtyDiffPct;
      computedValues.qtyDiffPctGte = threshold;
      if (qtyDiffPct >= threshold) {
        matched = true;
        detail = `数量差异 ${qtyDiffPct.toFixed(1)}% >= ${threshold}%`;
      }
    } else if (category === "DAMAGE") {
      const damageLevel = params.damageLevel ?? 0;
      const threshold = Number(cond.damageLevelGte ?? 2);
      computedValues.damageLevelGte = threshold;
      if (damageLevel >= threshold) {
        matched = true;
        detail = `破损等级 ${damageLevel} >= ${threshold}`;
      }
    } else if (category === "SPEC_MISMATCH") {
      const specA = params.specA ?? 0;
      const specB = params.specB ?? 0;
      const diff = Math.abs(specA - specB);
      const threshold = Number(cond.specDeviationMm ?? 2);
      computedValues.specDeviationMm = diff;
      computedValues.specDeviationMmThreshold = threshold;
      if (diff >= threshold) {
        matched = true;
        detail = `规格偏差 ${diff}mm >= ${threshold}mm`;
      }
    } else if (category === "LABEL_ERROR") {
      computedValues.labelPresent = params.labelPresent;
      if (params.labelPresent === false) {
        matched = true;
        detail = "标签缺失（labelPresent=false）";
      }
    } else if (category === "BATCH_ERROR") {
      if (params.batchExpireDate) {
        const daysLeftGte = Number(cond.expireDaysLeftGte ?? 7);
        const diffMs = params.batchExpireDate.getTime() - today.getTime();
        const daysLeft = diffMs / (24 * 3600 * 1000);
        computedValues.expireDaysLeft = daysLeft;
        computedValues.expireDaysLeftGte = daysLeftGte;
        if (daysLeft < daysLeftGte) {
          matched = true;
          detail = `效期剩余 ${daysLeft.toFixed(1)} 天 < ${daysLeftGte} 天阈值`;
        }
      }
    }

    if (matched) {
      return {
        passed: false,
        hitRule: {
          id: rule.id,
          ruleCode: rule.ruleCode,
          ruleName: rule.ruleName,
          category,
          severity: rule.severity,
          detail,
          matchedCondition: cond,
        },
        shouldAutoCreateTicket: Boolean(rule.autoCreateTicket),
        routeToApprovalLevel: Number(rule.routeToApprovalLevel ?? 2),
        qcRuleHitDetail: {
          matchedCondition: cond,
          computedValues,
        },
      };
    }
  }

  return {
    passed: true,
    hitRule: null,
    shouldAutoCreateTicket: false,
    routeToApprovalLevel: 1,
    qcRuleHitDetail: {
      matchedCondition: null,
      computedValues,
    },
  };
}
