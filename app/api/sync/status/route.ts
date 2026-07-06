import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requestId } from "@/lib/utils";
import { V2ApiError, v2Client } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";

export async function GET() {
  try {
    const reqId = requestId();

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [lastLog, totalCalls, successCalls, latestLogs, statsByCategory] =
      await Promise.all([
        (prisma as any).sync_logs.findFirst({
          where: { direction: "CALL_V2" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        (prisma as any).sync_logs.count({
          where: { direction: "CALL_V2", createdAt: { gte: twentyFourHoursAgo } },
        }),
        (prisma as any).sync_logs.count({
          where: {
            direction: "CALL_V2",
            createdAt: { gte: twentyFourHoursAgo },
            errorCategory: null,
          },
        }),
        (prisma as any).sync_logs.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            direction: true,
            interfaceName: true,
            createdAt: true,
            errorCategory: true,
            errorMessage: true,
            durationMs: true,
            requestId: true,
            responseStatusCode: true,
          },
        }),
        (prisma as any).sync_logs.groupBy({
          by: ["errorCategory"],
          where: {
            direction: "CALL_V2",
            createdAt: { gte: twentyFourHoursAgo },
            errorCategory: { not: null },
          },
          _count: true,
        }),
      ]);

    const successRate =
      totalCalls > 0
        ? Number(((successCalls / totalCalls) * 100).toFixed(2))
        : 100;

    const stats: Record<string, number> = {};
    for (const row of statsByCategory) {
      if (row.errorCategory) {
        stats[row.errorCategory] = row._count;
      }
    }

    let v2ServiceStatus: {
      lastReachableAt: Date | null;
      currentlyReachable: boolean;
    } = { lastReachableAt: null, currentlyReachable: false };

    try {
      const probeStart = Date.now();
      const probe = await v2Client.listShipments(
        { pageSize: 1 },
        { noLog: true }
      );
      v2ServiceStatus = {
        lastReachableAt: probe.syncedAt,
        currentlyReachable: true,
      };
    } catch {
      const lastSuccess = await (prisma as any).sync_logs.findFirst({
        where: { direction: "CALL_V2", errorCategory: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      v2ServiceStatus = {
        lastReachableAt: lastSuccess?.createdAt ?? null,
        currentlyReachable: false,
      };
    }

    return NextResponse.json({
      ok: true,
      lastSyncAt: lastLog?.createdAt ?? null,
      successRate,
      totalCalls24h: totalCalls,
      latestLogs,
      stats: { byErrorCategory: stats },
      v2ServiceStatus,
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
