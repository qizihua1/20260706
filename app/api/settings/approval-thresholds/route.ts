import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";

const PostBodySchema = z
  .object({
    ruleCode: z.string().optional(),
    scope: z.enum(["GLOBAL", "BY_CATEGORY", "BY_SEVERITY"]),
    category: z.enum(["LOGISTICS", "QC"]).optional(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    minAmount: z.coerce.number().min(0),
    maxAmount: z.coerce.number().min(0).optional(),
    approvalLevel: z.union([z.literal(1), z.literal(2), z.coerce.number().int().min(1).max(2)]),
    timeoutMinutes: z.coerce.number().int().min(1),
    qcHoldTimeoutMinutes: z.coerce.number().int().min(1).optional(),
    isEnabled: z.boolean().default(true),
  })
  .refine(
    (d) => {
      if (d.scope === "BY_CATEGORY") return !!d.category;
      if (d.scope === "BY_SEVERITY") return !!d.severity;
      return true;
    },
    (d) => ({
      message: `${d.scope} 作用域需要对应参数`,
    })
  );

export async function GET() {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (!caller.roles.includes(UserRole.ADMIN)) {
      throw new PermissionDeniedError("仅 ADMIN 可访问审批阈值配置");
    }
    const all = await (prisma as any).approval_thresholds.findMany({
      orderBy: [{ scope: "desc" }, { createdAt: "asc" }],
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
    if (!caller.roles.includes(UserRole.ADMIN)) {
      throw new PermissionDeniedError("仅 ADMIN 可修改审批阈值配置");
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
      data.ruleCode ??
      `TH-${data.scope}-${(data.category ?? data.severity ?? "GLOBAL")}-${data.approvalLevel}`;

    const upserted = await (prisma as any).approval_thresholds.upsert({
      where: { ruleCode: finalRuleCode },
      create: {
        ruleCode: finalRuleCode,
        scope: data.scope,
        category: data.category ?? null,
        severity: data.severity ?? null,
        minAmount: data.minAmount,
        maxAmount: data.maxAmount ?? null,
        approvalLevel: Number(data.approvalLevel),
        timeoutMinutes: Number(data.timeoutMinutes),
        qcHoldTimeoutMinutes: data.qcHoldTimeoutMinutes ?? null,
        isEnabled: data.isEnabled,
      },
      update: {
        scope: data.scope,
        category: data.category ?? undefined,
        severity: data.severity ?? undefined,
        minAmount: data.minAmount,
        maxAmount: data.maxAmount ?? null,
        approvalLevel: Number(data.approvalLevel),
        timeoutMinutes: Number(data.timeoutMinutes),
        qcHoldTimeoutMinutes: data.qcHoldTimeoutMinutes ?? null,
        isEnabled: data.isEnabled,
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
    if (!caller.roles.includes(UserRole.ADMIN)) {
      throw new PermissionDeniedError("仅 ADMIN 可删除审批阈值配置");
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
    await (prisma as any).approval_thresholds.delete({ where });
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
