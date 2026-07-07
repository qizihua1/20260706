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
  status: z
    .string()
    .optional()
    .transform((v) =>
      v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined
    ),
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
  urgent: z
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

    if (q.status && q.status.length) {
      // frontend alias names → real TicketStatus enum values (per prisma/schema.prisma L50)
      const ENUM_ALIAS: Record<string, string> = {
        REJECTED: "REJECTED_RESUBMIT",
        CLOSED: "CLOSED_AUTO_DISMISSED",
        ESCALATED: "ESCALATED_AUTO",
        ESCALATED_MANUAL: "ESCALATED_AUTO",
        ESCALATED_AUTO: "ESCALATED_AUTO",
      };
      const VALID_ENUM = new Set([
        "PENDING_REVIEW",
        "L1_APPROVING",
        "L2_APPROVING",
        "EXECUTING",
        "REJECTED_RESUBMIT",
        "COMPLETED",
        "CLOSED_AUTO_DISMISSED",
        "ESCALATED_AUTO",
      ]);
      const mapped = q.status
        .map((s: string) => (ENUM_ALIAS[s] ?? s))
        .filter((s: string) => VALID_ENUM.has(s));
      if (mapped.length) {
        where.currentStatus = mapped.length === 1 ? mapped[0] : { in: mapped };
      }
    }
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
    if (q.deadlineSoon || q.urgent) {
      const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
      where.deadlineAt = { lt: soon, isSet: true };
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
    const _today = new Date();
    const startOfDay = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const PENDING_STATUSES = [
      "PENDING_REVIEW",
      "L1_APPROVING",
      "L2_APPROVING",
      "EXECUTING",
      "ESCALATED_AUTO",
    ];

    const [tickets, matched, groupCount] = await Promise.all([
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
      (prisma as any).exception_tickets.groupBy({
        by: ["currentStatus"],
        _count: true,
      }),
    ]);

    // 构造"待我审批"过滤条件
    let pendingMyApproval = 0;
    if (isAdmin) {
      pendingMyApproval = groupCount.reduce((s: number, r: any) =>
        s + (PENDING_STATUSES.includes(r.currentStatus) ? (r._count as number) : 0), 0);
    } else if (isApproverL1 || isApproverL2) {
      const myWhere: any = { OR: [] as any[] };
      if (isApproverL1) {
        myWhere.OR.push({
          l1AssigneeId: caller.id,
          currentStatus: { in: ["PENDING_REVIEW", "L1_APPROVING"] },
        });
      }
      if (isApproverL2) {
        myWhere.OR.push({
          l2AssigneeId: caller.id,
          currentStatus: { in: ["L2_APPROVING"] },
        });
      }
      pendingMyApproval = await (prisma as any).exception_tickets.count({ where: myWhere });
    }

    const [grandTotal, todayNew, completedForAvg, overdueSoonCount] = await Promise.all([
      (prisma as any).exception_tickets.count(),
      (prisma as any).exception_tickets.count({
        where: { createdAt: { gte: startOfDay, lt: endOfDay } },
      }),
      (prisma as any).exception_tickets.findMany({
        where: {
          currentStatus: "COMPLETED",
          lastStatusChangedAt: { isSet: true },
          createdAt: { isSet: true },
        },
        select: { createdAt: true, lastStatusChangedAt: true },
        take: 2000,
      }),
      (prisma as any).exception_tickets.count({
        where: {
          deadlineAt: { lt: twoHoursLater, isSet: true },
          currentStatus: {
            notIn: ["COMPLETED", "CLOSED_AUTO_DISMISSED"],
          },
        },
      }),
    ]);

    // 平均处理时长（分钟）
    let avgHandleMinutes: number | undefined;
    if (completedForAvg && completedForAvg.length) {
      let sum = 0;
      let n = 0;
      for (const r of completedForAvg) {
        const dur =
          (new Date(r.lastStatusChangedAt).getTime() -
            new Date(r.createdAt).getTime()) /
          60000;
        if (Number.isFinite(dur) && dur >= 0) {
          sum += dur;
          n++;
        }
      }
      if (n > 0) avgHandleMinutes = Math.round((sum / n) * 10) / 10;
    }

    const totalCountsByStatus: Record<string, number> = {};
    for (const c of groupCount) {
      totalCountsByStatus[c.currentStatus] = c._count as number;
    }

    return NextResponse.json({
      ok: true,
      data: {
        items: tickets,
        total: grandTotal,
        matched,
        pendingMyApproval,
        todayNew,
        avgHandleMinutes,
      },
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
