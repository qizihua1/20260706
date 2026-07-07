import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentUser,
  UserRole,
  hasAnyRole,
} from "@/lib/auth/user-context";

/**
 * 【管理员专用】工单数据清理接口
 * 仅 ADMIN 可调用。用于演示场景下清理过多的历史种子工单，
 * 保留白名单（用户的2条真实工单）+ 最近 N 条新工单作为演示样本。
 *
 * POST /api/admin/prune-tickets
 *   {
 *     "keepRecent": 28,          // 除白名单外再保留最近多少条（默认28，总保留≈30）
 *     "dryRun": true             // 可选，true 只预览不删除
 *   }
 */

// 永远不删除的工单号（用户的2条真实工单 + 关键冒烟测用例）
const PROTECTED_TICKET_NOS = new Set([
  "T20260707-8978", // 用户真实工单1
  "T20260707-3811", // 用户真实工单2
  "T20260707-2002", // 冒烟测：L2→COMPLETED 成功闭环
  "T20260706-2249", // 冒烟测：QC 外观破损 L1
]);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const h = headers();
    const caller = await resolveCurrentUser(h);
    if (!hasAnyRole(caller, [UserRole.ADMIN])) {
      return NextResponse.json(
        { ok: false, error: "权限不足：仅管理员可清理数据" },
        { status: 403 }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const keepRecent = Number(body?.keepRecent ?? 28);
    const dryRun = Boolean(body?.dryRun ?? false);

    // ---------- 第一步：计算哪些工单要删除 ----------
    const allTickets = await prisma.exception_tickets.findMany({
      select: { id: true, ticketNo: true, createdAt: true, currentStatus: true },
      orderBy: [{ createdAt: "desc" }],
    });
    const totalBefore = allTickets.length;

    const protectedIds = new Set<string>();
    const recentIds = new Set<string>();

    for (const t of allTickets) {
      if (PROTECTED_TICKET_NOS.has(t.ticketNo)) protectedIds.add(t.id);
    }
    // 保留最近 keepRecent 条（不算已在白名单中的）
    let recentTaken = 0;
    for (const t of allTickets) {
      if (protectedIds.has(t.id)) continue;
      if (recentTaken < keepRecent) {
        recentIds.add(t.id);
        recentTaken++;
      }
    }
    const keepAllIds = new Set([...protectedIds, ...recentIds]);
    const deleteIds: string[] = allTickets
      .filter((t) => !keepAllIds.has(t.id))
      .map((t) => t.id);

    const summary: any = {
      totalTicketsBefore: totalBefore,
      protectedCount: protectedIds.size,
      recentKeptCount: recentIds.size,
      willDeleteCount: deleteIds.length,
      willKeepCount: totalBefore - deleteIds.length,
      dryRun,
      steps: {} as any,
    };

    if (dryRun) {
      summary.preview = {
        protectedTicketNos: allTickets
          .filter((t) => protectedIds.has(t.id))
          .map((t) => t.ticketNo),
        recentKeptTicketNos: allTickets
          .filter((t) => recentIds.has(t.id))
          .slice(0, 20)
          .map((t) => t.ticketNo),
        deleteTicketNosSample: allTickets
          .filter((t) => deleteIds.includes(t.id))
          .slice(0, 10)
          .map((t) => t.ticketNo),
      };
      return NextResponse.json({ ok: true, summary });
    }

    if (deleteIds.length === 0) {
      return NextResponse.json({ ok: true, summary, note: "无可删除工单" });
    }

    // ---------- 第二步：按外键顺序删除（事务内） ----------
    const txResult = await prisma.$transaction(async (tx: any) => {
      // 1. inventory_records（有 ticketId FK + approvalRecordId FK → 先清）
      const inv = await tx.inventory_records.deleteMany({
        where: { ticketId: { in: deleteIds } },
      });
      summary.steps.inventoryRecordsDeleted = inv.count;

      // 2. compensation_records（有 ticketId FK + approvalRecordId UNIQUE FK → 次清）
      const cmp = await tx.compensation_records.deleteMany({
        where: { ticketId: { in: deleteIds } },
      });
      summary.steps.compensationRecordsDeleted = cmp.count;

      // 3. approval_records（有 ticketId FK → 再清）
      const apr = await tx.approval_records.deleteMany({
        where: { ticketId: { in: deleteIds } },
      });
      summary.steps.approvalRecordsDeleted = apr.count;

      // 4. scan_records 的 ticketId 断开关联（保留 scan 本身，因为它还引用 waybill_snapshot）
      const scn = await tx.scan_records.updateMany({
        where: { ticketId: { in: deleteIds } },
        data: { ticketId: null },
      });
      summary.steps.scanRecordsDisconnected = scn.count;

      // 5. 主表 exception_tickets
      const tkt = await tx.exception_tickets.deleteMany({
        where: { id: { in: deleteIds } },
      });
      summary.steps.ticketsDeleted = tkt.count;

      // 6. 清理孤立的 waybill_snapshots（没有任何 ticket/scan 引用了）
      const wbInUse = new Set<string>();
      (
        await tx.exception_tickets.findMany({
          select: { waybillSnapshotId: true },
          distinct: ["waybillSnapshotId"],
        })
      ).forEach((r: any) => wbInUse.add(r.waybillSnapshotId));
      (
        await tx.scan_records.findMany({
          select: { waybillSnapshotId: true },
          distinct: ["waybillSnapshotId"],
        })
      ).forEach((r: any) => wbInUse.add(r.waybillSnapshotId));

      const allWb = await tx.waybill_snapshots.findMany({
        select: { id: true },
      });
      const orphanWbIds: string[] = allWb
        .filter((r: any) => !wbInUse.has(r.id))
        .map((r: any) => r.id);
      let wbDeleted = 0;
      if (orphanWbIds.length > 0) {
        // 防止一次性删过多，分批
        const batchSize = 500;
        for (let i = 0; i < orphanWbIds.length; i += batchSize) {
          const batch = orphanWbIds.slice(i, i + batchSize);
          const res = await tx.waybill_snapshots.deleteMany({
            where: { id: { in: batch } },
          });
          wbDeleted += res.count;
        }
      }
      summary.steps.orphanWaybillSnapshotsDeleted = wbDeleted;

      return summary.steps;
    });

    const totalAfter = await prisma.exception_tickets.count();
    summary.totalTicketsAfter = totalAfter;
    summary.steps = txResult;

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "未知错误", stack: String(e?.stack ?? "") },
      { status: 500 }
    );
  }
}
