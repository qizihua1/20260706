import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser } from "@/lib/auth/user-context";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import {
  syncWaybillFromV2,
  WaybillSyncError,
} from "@/lib/services/data-sync-service";

const PostBodySchema = z
  .object({
    waybillId: z.string().optional(),
    externalCode: z.string().optional(),
  })
  .refine(
    (d) => d.waybillId || d.externalCode,
    "必须提供 waybillId 或 externalCode"
  );

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
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
    const caller = await resolveCurrentUser(headers());

    const snapshot = await syncWaybillFromV2(
      {
        waybillId: parsed.data.waybillId,
        externalCode: parsed.data.externalCode,
        callerUserId: caller.id,
        forceRefresh: true,
      },
      prisma as any
    );
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          error: "未找到运单",
          code: "WAYBILL_NOT_FOUND",
          requestId: reqId,
        },
        { status: 404 }
      );
    }

    const source =
      snapshot.syncRequestId && snapshot.syncedAt
        ? "v2-realtime"
        : "local-fallback";

    return NextResponse.json({
      ok: true,
      waybillSnapshot: snapshot,
      source,
    });
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
  if (err instanceof WaybillSyncError) {
    const statusMap: Record<string, number> = {
      BAD_PARAM: 400,
      NOT_FOUND: 404,
      V2_FAILED_USE_FALLBACK: 502,
      V2_FAILED_NO_LOCAL: 502,
    };
    const status = statusMap[err.reason] ?? 502;
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "WAYBILL_SYNC_" + err.reason,
        requestId: reqId,
      },
      { status }
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
