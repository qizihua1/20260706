import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, UserRole, isQcSupervisor, hasAnyRole } from "@/lib/auth/user-context";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  category: z.string().optional(),
  subType: z.string().optional(),
  severity: z.string().optional(),
  source: z.string().optional(),
  keyword: z.string().optional(),
  assigneeId: z.string().optional(),
  reporterId: z.string().optional(),
  deadlineSoon: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export async function GET(req: NextRequest) {
  try {
    const reqId = requestId();
    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
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
    const q = parsed.data;

    const caller = await resolveCurrentUser(headers());
    const isAdmin = caller.roles.includes(UserRole.ADMIN);
    const isApproverL1 = caller.roles.includes(UserRole.APPROVER_L1);
    const isApproverL2 = caller.roles.includes(UserRole.APPROVER_L2);
    const isOperator = caller.roles.includes(UserRole.WAREHOUSE_OPERATOR);
    const isQcSuper = isQcSupervisor(caller);

    const where: any = {};
    const OR: any[] = [];

    if (isAdmin) {
      // no restriction
    } else if (isQcSuper) {
      where.OR = [{ category: "QC" }, { reportedByUserId: caller.id }];
    } else if (isApproverL1 || isApproverL2) {
      const assigneeOr: any[] = [];
      if (isApproverL1) assigneeOr.push({ l1AssigneeId: caller.id });
      if (isApproverL2) assigneeOr.push({ l2AssigneeId: caller.id });
      assigneeOr.push({ reportedByUserId: caller.id });
      where.OR = assigneeOr;
    } else if (isOperator) {
      where.reportedByUserId = caller.id;
    } else {
      throw new PermissionDeniedError("当前用户无工单列表访问权限");
    }

    if (q.status) where.currentStatus = q.status;
    if (q.category) where.category = q.category;
    if (q.subType) where.subType = q.subType;
    if (q.severity) where.severity = q.severity;
    if (q.source) where.source = q.source;
    if (q.assigneeId) {
      where.OR = [
        ...(where.OR ?? []),
        { l1AssigneeId: q.assigneeId },
        { l2AssigneeId: q.assigneeId },
      ];
    }
    if (q.reporterId) where.reportedByUserId = q.reporterId;
    if (q.deadlineSoon) {
      const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
      where.deadlineAt = { lt: soon, not: null };
    }

    if (q.keyword) {
      const kw = `%${q.keyword}%`;
      const snapshotSubquery = (prisma as any).waybill_snapshots
        .findMany({
          where: {
            OR: [
              { externalCode: { contains: q.keyword } },
              { waybillId: { contains: q.keyword } },
              { recipientName: { contains: q.keyword } },
            ],
          },
          select: { id: true },
        })
        .then((rows: any[]) => rows.map((r) => r.id));

      const snapshotIds = await snapshotSubquery;
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          {
            OR: [
              { ticketNo: { contains: q.keyword } },
              { waybillSnapshotId: { in: snapshotIds } },
            ],
          },
        ];
        delete where.OR;
      } else {
        where.OR = [
          { ticketNo: { contains: q.keyword } },
          { waybillSnapshotId: { in: snapshotIds } },
        ];
      }
    }

    const skip = (q.page - 1) * q.pageSize;

    const [tickets, total] = await Promise.all([
      (prisma as any).exception_tickets.findMany({
        where,
        include: {
          waybillSnapshot: {
            select: {
              id: true,
              waybillId: true,
              externalCode: true,
              recipientName: true,
              recipientPhone: true,
              totalAmount: true,
            },
          },
          reporter: {
            select: { id: true, username: true, displayName: true },
          },
          l1Assignee: {
            select: { id: true, username: true, displayName: true },
          },
          l2Assignee: {
            select: { id: true, username: true, displayName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: q.pageSize,
      }),
      (prisma as any).exception_tickets.count({ where }),
    ]);

    const allCountPromise = (prisma as any).exception_tickets.groupBy({
      by: ["currentStatus"],
      _count: true,
    });
    const overdueSoonCount = await (prisma as any).exception_tickets.count({
      where: {
        deadlineAt: {
          lt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          not: null,
        },
        currentStatus: {
          notIn: ["COMPLETED", "CLOSED_AUTO_DISMISSED"],
        },
      },
    });
    const allCount = await allCountPromise;

    const totalCountsByStatus: Record<string, number> = {};
    for (const c of allCount) {
      totalCountsByStatus[c.currentStatus] = c._count;
    }

    return NextResponse.json({
      ok: true,
      data: tickets,
      total,
      page: q.page,
      pageSize: q.pageSize,
      stats: {
        totalCountsByStatus,
        overdueImminent: overdueSoonCount,
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
