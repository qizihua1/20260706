import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";

export async function GET() {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());
    if (!caller || !caller.id) {
      throw new PermissionDeniedError("请先登录");
    }

    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const startOf7DaysAgo = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 6
    );

    const [
      totalTickets,
      pendingTickets,
      overdueTickets,
      completedToday,
      compCustomer,
      compSupplier,
      qcHeldBatches,
      qcPassHeldStats,
      trend7days,
      categoryDistribution,
      topExceptionSubtypes,
    ] = await Promise.all([
      (prisma as any).exception_tickets.count(),
      (prisma as any).exception_tickets.count({
        where: {
          currentStatus: {
            in: [
              "PENDING_REVIEW",
              "L1_APPROVING",
              "L2_APPROVING",
              "EXECUTING",
              "ESCALATED_AUTO",
            ],
          },
        },
      }),
      (prisma as any).exception_tickets.count({
        where: {
          deadlineAt: { lt: today, not: null },
          currentStatus: {
            notIn: ["COMPLETED", "CLOSED_AUTO_DISMISSED"],
          },
        },
      }),
      (prisma as any).exception_tickets.count({
        where: {
          currentStatus: "COMPLETED",
          lastStatusChangedAt: { gte: startOfDay, lt: endOfDay },
        },
      }),
      (prisma as any).compensation_records.aggregate({
        _sum: { amount: true },
        where: { direction: "PAY_TO_CUSTOMER" },
      }),
      (prisma as any).compensation_records.aggregate({
        _sum: { amount: true },
        where: { direction: "RECOVER_FROM_SUPPLIER" },
      }),
      (prisma as any).scan_records.groupBy({
        by: ["batchNo", "skuCode"],
        where: { qcBatchStatus: "LOCKED" },
        _count: true,
      }),
      (prisma as any).scan_records.groupBy({
        by: ["qcResult"],
        where: { createdAt: { gte: startOf7DaysAgo } },
        _count: true,
      }),
      (prisma as any).exception_tickets.findMany({
        where: { createdAt: { gte: startOf7DaysAgo } },
        select: { createdAt: true },
      }),
      (prisma as any).exception_tickets.groupBy({
        by: ["category"],
        where: { createdAt: { gte: startOf7DaysAgo } },
        _count: true,
      }),
      (prisma as any).exception_tickets.groupBy({
        by: ["subType"],
        where: { createdAt: { gte: startOf7DaysAgo } },
        _count: true,
        orderBy: { _count: { subType: "desc" } },
        take: 10,
      }),
    ]);

    let qcPassCount = 0;
    let qcHeldCount = 0;
    for (const row of qcPassHeldStats) {
      if (row.qcResult === "PASSED") qcPassCount += row._count;
      else if (row.qcResult === "HELD") qcHeldCount += row._count;
    }
    const qcTotal = qcPassCount + qcHeldCount;
    const qcPassRate = qcTotal > 0 ? Number(((qcPassCount / qcTotal) * 100).toFixed(2)) : 100;

    const dayMap: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOf7DaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dayMap[key] = 0;
    }
    for (const row of trend7days) {
      const d = new Date(row.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key in dayMap) dayMap[key]++;
    }
    const trend7daysArr = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    const catDistMap: Record<string, number> = { LOGISTICS: 0, QC: 0 };
    for (const row of categoryDistribution) {
      if (row.category in catDistMap) catDistMap[row.category] = row._count;
    }
    const categoryDistributionArr = Object.entries(catDistMap).map(
      ([category, count]) => ({ category, count })
    );

    const topExceptionSubtypesArr = topExceptionSubtypes.map((row: any) => ({
      subType: row.subType,
      count: row._count,
    }));

    return NextResponse.json({
      ok: true,
      stats: {
        totalTickets,
        pendingTickets,
        overdueTickets,
        completedToday,
        compensationTotalCustomerPaid: Number(
          compCustomer?._sum?.amount ?? 0
        ),
        compensationTotalSupplierRecover: Number(
          compSupplier?._sum?.amount ?? 0
        ),
        qcHeldBatches: qcHeldBatches.length,
        qcPassRate,
      },
      trend7days: trend7daysArr,
      categoryDistribution: categoryDistributionArr,
      topExceptionSubtypes: topExceptionSubtypesArr,
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
