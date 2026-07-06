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

const TriggerConditionSchema = z.object({
  qtyDiffPctGte: z.coerce.number().min(0).optional(),
  damageLevelGte: z.coerce.number().int().min(0).max(5).optional(),
  specDeviationMm: z.coerce.number().min(0).optional(),
  labelMissing: z.boolean().optional(),
  expireDaysLeftGte: z.coerce.number().int().min(0).optional(),
});

const PostBodySchema = z.object({
  ruleCode: z.string().optional(),
  ruleName: z.string().min(1),
  category: z.enum([
    "QTY_DIFF",
    "DAMAGE",
    "SPEC_MISMATCH",
    "LABEL_ERROR",
    "BATCH_ERROR",
  ]),
  triggerCondition: TriggerConditionSchema.default({}),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  autoCreateTicket: z.boolean().default(true),
  routeToApprovalLevel: z
    .union([z.literal(1), z.literal(2), z.coerce.number().int().min(1).max(2)])
    .default(2),
  isEnabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export async function GET() {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可访问品控规则配置");
    }
    const all = await (prisma as any).qc_rules.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ ok: true, data: all });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可修改品控规则配置");
    }
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
    const data = parsed.data;
    const finalRuleCode =
      data.ruleCode ?? `QR-${data.category}-${Date.now()}`;

    const upserted = await (prisma as any).qc_rules.upsert({
      where: { ruleCode: finalRuleCode },
      create: {
        ruleCode: finalRuleCode,
        ruleName: data.ruleName,
        category: data.category,
        triggerCondition: data.triggerCondition,
        severity: data.severity,
        autoCreateTicket: data.autoCreateTicket,
        routeToApprovalLevel: Number(data.routeToApprovalLevel),
        isEnabled: data.isEnabled,
        sortOrder: Number(data.sortOrder),
      },
      update: {
        ruleName: data.ruleName,
        category: data.category,
        triggerCondition: data.triggerCondition,
        severity: data.severity,
        autoCreateTicket: data.autoCreateTicket,
        routeToApprovalLevel: Number(data.routeToApprovalLevel),
        isEnabled: data.isEnabled,
        sortOrder: Number(data.sortOrder),
      },
    });

    return NextResponse.json({ ok: true, data: upserted });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

export async function PUT(req: NextRequest) {
  return POST(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可删除品控规则配置");
    }
    const body = await req.json();
    const { ruleCode, id } = body ?? {};
    if (!ruleCode && !id) {
      return NextResponse.json(
        {
          ok: false,
          error: "需提供 ruleCode 或 id",
          code: "BAD_PARAM",
          requestId: reqId,
        },
        { status: 400 }
      );
    }
    const where: any = {};
    if (id) where.id = id;
    else where.ruleCode = ruleCode;
    await (prisma as any).qc_rules.delete({ where });
    return NextResponse.json({ ok: true });
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
