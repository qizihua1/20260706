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

// DELETE /api/qc-rules/:id
// 与 /api/settings/qc-rules DELETE（按 body 传 id/ruleCode）不同，
// 这里按 URL path param `id` 删除，对应前端 handleDelete(`/api/qc-rules/${id}`)
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (
      !caller.roles.includes(UserRole.ADMIN) &&
      !isQcSupervisor(caller)
    ) {
      throw new PermissionDeniedError("仅 ADMIN / QC_SUPERVISOR 可删除品控规则配置");
    }
    const id = z.string().min(1).safeParse(params?.id);
    if (!id.success) {
      return NextResponse.json(
        { ok: false, error: "路径参数 id 不能为空", code: "BAD_PARAM", requestId: reqId },
        { status: 400 }
      );
    }
    await (prisma as any).qc_rules.delete({ where: { id: id.data } });
    return NextResponse.json({ ok: true, requestId: reqId });
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
  const isNotFound =
    err &&
    (err.code === "P2025" ||
      String(err.message ?? "").includes("Record to delete does not exist") ||
      String(err.message ?? "").includes("Record to update not found"));
  if (isNotFound) {
    return NextResponse.json(
      { ok: false, error: "目标规则不存在或已删除", code: "NOT_FOUND", requestId: reqId },
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
