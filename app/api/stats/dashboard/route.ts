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

    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const [
      totalTickets,
      pendingTickets,
      overdueTickets,
      urgentTickets,
      completedToday,
      compCustomer,
      compSupplier,
      qcHeldBatches,
      qcPassHeldStats,
      trend7days,
      trend7daysCompleted,
      categoryDistribution,
      topExceptionSubtypes,
      urgentTop10Raw,
      recentCompletedRaw,
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
              "ESCALATED_MANUAL",
            ],
          },
        },
      }),
      (prisma as any).exception_tickets.count({
        where: {
          deadlineAt: { lt: today, isSet: true },
          currentStatus: {
            notIn: ["COMPLETED", "CLOSED_AUTO_DISMISSED"],
          },
        },
      }),
      (prisma as any).exception_tickets.count({
        where: {
          deadlineAt: { lt: twoHoursLater, isSet: true },
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
      (prisma as any).exception_tickets.findMany({
        where: {
          currentStatus: "COMPLETED",
          lastStatusChangedAt: { gte: startOf7DaysAgo, isSet: true },
        },
        select: { lastStatusChangedAt: true },
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
      (prisma as any).exception_tickets.findMany({
        where: {
          deadlineAt: { lt: twoHoursLater, isSet: true },
          currentStatus: {
            notIn: ["COMPLETED", "CLOSED_AUTO_DISMISSED"],
          },
        },
        orderBy: [{ deadlineAt: "asc" }],
        take: 10,
        include: {
          reporter: { select: { displayName: true, username: true } },
        },
      }),
      (prisma as any).exception_tickets.findMany({
        where: { currentStatus: "COMPLETED", lastStatusChangedAt: { isSet: true } },
        orderBy: [{ lastStatusChangedAt: "desc" }],
        take: 10,
        include: {
          compensationRecords: { select: { amount: true, direction: true } },
        },
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
    const completedDayMap: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOf7DaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dayMap[key] = 0;
      completedDayMap[key] = 0;
    }
    for (const row of trend7days) {
      const d = new Date(row.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key in dayMap) dayMap[key]++;
    }
    for (const row of trend7daysCompleted) {
      const d = new Date(row.lastStatusChangedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key in completedDayMap) completedDayMap[key]++;
    }
    const trend7daysArr = Object.entries(dayMap).map(([date, count]) => ({
      date,
      count,
      completed: completedDayMap[date] ?? 0,
    }));

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

    const urgentTop10 = (urgentTop10Raw ?? []).map((t: any) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      subType: t.subType,
      severity: t.severity,
      deadlineAt: t.deadlineAt,
      reportedBy:
        t.reporter?.displayName || t.reporter?.username || t.reportedBy || "-",
    }));

    const recentCompleted = (recentCompletedRaw ?? []).map((t: any) => {
      let amount = 0;
      if (Array.isArray(t.compensationRecords)) {
        for (const c of t.compensationRecords) {
          const dir = String(c?.direction ?? "");
          const isPayout =
            dir.startsWith("PAY") ||
            dir.includes("CUSTOMER") ||
            dir.includes("赔付") ||
            dir.includes("客户");
          if (isPayout) amount += Number(c?.amount ?? 0);
        }
      }
      return {
        id: t.id,
        ticketNo: t.ticketNo,
        subType: t.subType,
        completedAt: t.lastStatusChangedAt,
        amount,
      };
    });

    return NextResponse.json({
      ok: true,
      data: {
        totalTickets,
        pendingTickets,
        urgentTickets,
        todayCompleted: completedToday,
        customerPayoutTotal: Number(
          compCustomer?._sum?.amount ?? 0
        ),
        vendorRecoveryTotal: Number(
          compSupplier?._sum?.amount ?? 0
        ),
        qcHeldBatches: qcHeldBatches.length,
        qcPassRate,
        overdueTickets,
        trend7Days: trend7daysArr,
        categoryDistribution: categoryDistributionArr,
        topExceptionSubtypes: topExceptionSubtypesArr,
        topSubTypes: topExceptionSubtypesArr,
        urgentTop10,
        recentCompleted,
      },
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
  // #region debug-point sys-error-500: expose raw err via response header for diagnosis in prod
  const raw = `${err?.name ?? "Error"}: ${err?.message ?? String(err)}`;
  const stack = (err?.stack ?? "").toString().slice(0, 300);
  const debugHeader = encodeURIComponent(`${raw}\n${stack}`).slice(0, 8000);
  // #endregion
  return NextResponse.json(
    {
      ok: false,
      error: isDev ? err?.message ?? String(err) : "系统错误",
      code: "INTERNAL_ERROR",
      requestId: reqId,
    },
    { status: 500, headers: { "x-debug-err": debugHeader } }
  );
}
