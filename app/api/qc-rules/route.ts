import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole, isQcSupervisor } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";

// ============================================================
// 品控规则 API（供 /qc-rules 前端页直接调用）
// 路径：GET / POST /api/qc-rules
// 注意：历史遗留的 /api/settings/qc-rules 仍保留以防引用。
// 这里做「前端字段名 → 后端 Prisma 字段名」的双向适配层：
//   前端                 后端
//   name              →  ruleName
//   triggerConditions →  triggerCondition (JSON)
//   enabled           →  isEnabled
//   defaultApprovalLevel → routeToApprovalLevel (1|2)
//   category          →  QcRuleCategory enum 映射（SIZE_DEVIATION→SPEC_MISMATCH 等）
// ============================================================

const FRONT_TO_BACK_CATEGORY: Record<string, string> = {
  QTY_DIFF: "QTY_DIFF",
  SIZE_DEVIATION: "SPEC_MISMATCH",
  DAMAGE_LEVEL: "DAMAGE",
  LABEL_MISSING: "LABEL_ERROR",
  EXPIRY_NEAR: "BATCH_ERROR",
  CUSTOM: "BATCH_ERROR",
  // 后端原生 5 个值直接透传，方便兼容
  DAMAGE: "DAMAGE",
  SPEC_MISMATCH: "SPEC_MISMATCH",
  LABEL_ERROR: "LABEL_ERROR",
  BATCH_ERROR: "BATCH_ERROR",
};
const BACK_TO_FRONT_CATEGORY: Record<string, string> = {
  QTY_DIFF: "QTY_DIFF",
  DAMAGE: "DAMAGE_LEVEL",
  SPEC_MISMATCH: "SIZE_DEVIATION",
  LABEL_ERROR: "LABEL_MISSING",
  BATCH_ERROR: "EXPIRY_NEAR",
};

// 入站校验（宽松接受前端字段名；category/severity 枚举允许合法 string 再映射）
const PostBodySchema = z.object({
  id: z.string().optional(),
  ruleCode: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),            // 前端
  ruleName: z.string().trim().min(1).optional(),        // 后端（兜底）
  category: z.string().optional(),
  triggerConditions: z.record(z.any()).optional(),      // 前端
  triggerCondition: z.record(z.any()).optional(),       // 后端（兜底）
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  autoCreateTicket: z.boolean().default(true),
  defaultApprovalLevel: z
    .union([z.literal(1), z.literal(2), z.coerce.number().int().min(1).max(2)])
    .optional(),                                          // 前端
  routeToApprovalLevel: z
    .union([z.literal(1), z.literal(2), z.coerce.number().int().min(1).max(2)])
    .optional(),                                          // 后端（兜底）
  enabled: z.boolean().optional(),                        // 前端
  isEnabled: z.boolean().optional(),                      // 后端（兜底）
  sortOrder: z.coerce.number().int().default(0),
});

/** 后端 DB 行 → 前端 QcRule 字段名 */
function toFront(row: any) {
  return {
    id: String(row.id),
    ruleCode: String(row.ruleCode),
    name: String(row.ruleName ?? ""),
    category: BACK_TO_FRONT_CATEGORY[String(row.category)] ?? String(row.category),
    triggerConditions: row.triggerCondition && typeof row.triggerCondition === "object"
      ? row.triggerCondition
      : typeof row.triggerCondition === "string"
        ? (() => { try { return JSON.parse(row.triggerCondition); } catch { return {}; } })()
        : {},
    severity: String(row.severity),
    autoCreateTicket: !!row.autoCreateTicket,
    defaultApprovalLevel: Number(row.routeToApprovalLevel) === 1 ? 1 : 2,
    enabled: !!row.isEnabled,
    sortOrder: Number(row.sortOrder) || 0,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  };
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可访问品控规则配置");
    }
    const rows = await (prisma as any).qc_rules.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({
      ok: true,
      data: rows.map(toFront),
      total: rows.length,
      requestId: requestId(),
    });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可修改品控规则配置");
    }
    const body = await req.json().catch(() => ({}));
    const parsed = PostBodySchema.safeParse(body ?? {});
    const reqId = requestId();
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
    const d = parsed.data;
    const ruleName = d.ruleName ?? d.name;
    if (!ruleName) {
      return NextResponse.json(
        { ok: false, error: "需提供规则名称（name / ruleName）", code: "BAD_PARAM", requestId: reqId },
        { status: 400 }
      );
    }
    const backCategory = FRONT_TO_BACK_CATEGORY[String(d.category ?? "QTY_DIFF").toUpperCase()]
      ?? FRONT_TO_BACK_CATEGORY.QTY_DIFF;
    const finalRuleCode = d.ruleCode?.trim() || `QR-${backCategory}-${Date.now()}`;
    const finalRouteLevel = Number(d.routeToApprovalLevel ?? d.defaultApprovalLevel ?? 2);
    const finalIsEnabled = typeof d.isEnabled === "boolean" ? d.isEnabled : (typeof d.enabled === "boolean" ? d.enabled : true);
    const finalTrigger = d.triggerCondition ?? d.triggerConditions ?? {};

    // id 有值且不是 "__new__" → 按 id 更新；否则按 ruleCode upsert
    const hasRealId = !!d.id && d.id !== "__new__" && String(d.id).length > 0;

    let result: any;
    if (hasRealId) {
      // 按 id 更新，ruleCode/ruleName 等可同步更新
      result = await (prisma as any).qc_rules.update({
        where: { id: d.id },
        data: {
          ruleCode: finalRuleCode,
          ruleName,
          category: backCategory,
          triggerCondition: finalTrigger,
          severity: d.severity,
          autoCreateTicket: d.autoCreateTicket,
          routeToApprovalLevel: finalRouteLevel,
          isEnabled: finalIsEnabled,
          sortOrder: Number(d.sortOrder) || 0,
        },
      });
    } else {
      result = await (prisma as any).qc_rules.upsert({
        where: { ruleCode: finalRuleCode },
        create: {
          ruleCode: finalRuleCode,
          ruleName,
          category: backCategory,
          triggerCondition: finalTrigger,
          severity: d.severity,
          autoCreateTicket: d.autoCreateTicket,
          routeToApprovalLevel: finalRouteLevel,
          isEnabled: finalIsEnabled,
          sortOrder: Number(d.sortOrder) || 0,
        },
        update: {
          ruleName,
          category: backCategory,
          triggerCondition: finalTrigger,
          severity: d.severity,
          autoCreateTicket: d.autoCreateTicket,
          routeToApprovalLevel: finalRouteLevel,
          isEnabled: finalIsEnabled,
          sortOrder: Number(d.sortOrder) || 0,
        },
      });
    }
    return NextResponse.json({
      ok: true,
      data: toFront(result),
      requestId: reqId,
    });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
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
        requestId: (err as any).ticketId ?? reqId,
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
  // Prisma 记录不存在（DELETE/UPDATE 找不到）→ 404
  const isNotFound =
    err &&
    (err.code === "P2025" ||
      String(err.message ?? "").includes("Record to update not found") ||
      String(err.message ?? "").includes("Record to delete does not exist"));
  if (isNotFound) {
    return NextResponse.json(
      { ok: false, error: "目标记录不存在", code: "NOT_FOUND", requestId: reqId },
      { status: 404 }
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
