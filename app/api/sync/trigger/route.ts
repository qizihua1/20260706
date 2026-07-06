import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError, v2Client } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import {
  processScheduledTimeouts,
  processDisabledApproversReassignment,
} from "@/lib/services/background-jobs";
import { syncWaybillFromV2 } from "@/lib/services/data-sync-service";

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (!caller.roles.includes(UserRole.ADMIN)) {
      throw new PermissionDeniedError("仅 ADMIN 可手动触发同步");
    }

    const [timeoutResults, reassignmentResults] = await Promise.all([
      processScheduledTimeouts(),
      processDisabledApproversReassignment(),
    ]);

    let syncedCount = 0;
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const list = await v2Client.listShipments(
        { pageSize: 100, page: 1 },
        { callerUserId: caller.id }
      );
      const items = list.data ?? [];
      for (const shipment of items) {
        try {
          await syncWaybillFromV2(
            {
              waybillId: shipment.id,
              externalCode: shipment.externalCode,
              callerUserId: caller.id,
              forceRefresh: true,
            },
            prisma as any
          );
          syncedCount++;
        } catch {
          // ignore individual failures
        }
      }
    } catch {
      // ignore batch fetch failure
    }

    return NextResponse.json({
      ok: true,
      timeoutResults,
      reassignmentResults,
      syncedCount,
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
