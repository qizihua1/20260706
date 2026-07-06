import { prisma } from "../prisma";
import { v2Client, V2ApiError } from "../v2-api-client";
import type { Prisma } from "@prisma/client";

export interface SyncWaybillFromV2Params {
  waybillId?: string;
  externalCode?: string;
  callerUserId?: string;
  forceRefresh?: boolean;
}

export class WaybillSyncError extends Error {
  public readonly reason:
    | "V2_FAILED_NO_LOCAL"
    | "V2_FAILED_USE_FALLBACK"
    | "NOT_FOUND"
    | "BAD_PARAM";
  constructor(
    message: string,
    reason:
      | "V2_FAILED_NO_LOCAL"
      | "V2_FAILED_USE_FALLBACK"
      | "NOT_FOUND"
      | "BAD_PARAM"
  ) {
    super(message);
    this.name = "WaybillSyncError";
    this.reason = reason;
  }
}

export async function syncWaybillFromV2(
  params: SyncWaybillFromV2Params,
  tx: Prisma.TransactionClient = prisma as any
): Promise<any> {
  const prismaTx = tx as any;
  const { waybillId, externalCode, callerUserId, forceRefresh } = params;

  if (!waybillId && !externalCode) {
    throw new WaybillSyncError(
      "必须提供 waybillId 或 externalCode",
      "BAD_PARAM"
    );
  }

  const getParams = waybillId
    ? { id: waybillId }
    : { externalCode: externalCode! };

  const where: any = {};
  if (waybillId) where.waybillId = waybillId;
  else if (externalCode) where.externalCode = externalCode;

  if (!forceRefresh) {
    const existing = await prismaTx.waybill_snapshots.findFirst({ where });
    if (
      existing &&
      existing.syncedAt &&
      Date.now() - new Date(existing.syncedAt).getTime() < 5 * 60 * 1000
    ) {
      return existing;
    }
  }

  let v2Result: {
    shipment: any;
    exists: boolean;
    requestId: string;
    source: "v2-realtime" | "local-fallback";
  };

  try {
    v2Result = await v2Client.getShipment(getParams, {
      callerUserId,
    });
  } catch (e: any) {
    const fallbackSnapshot = await prismaTx.waybill_snapshots.findFirst({
      where,
    });
    if (fallbackSnapshot) {
      return fallbackSnapshot;
    }
    throw new WaybillSyncError(
      `V2 查询失败${e?.message ? `：${e.message}` : ""}，且本地无快照无法降级`,
      "V2_FAILED_NO_LOCAL"
    );
  }

  if (!v2Result.exists) {
    if (v2Result.source === "local-fallback") {
      const fallbackSnapshot = await prismaTx.waybill_snapshots.findFirst({
        where,
      });
      if (fallbackSnapshot) {
        return fallbackSnapshot;
      }
    }
    throw new WaybillSyncError("V2 和本地均未找到该运单", "NOT_FOUND");
  }

  const shipment = v2Result.shipment;
  const now = new Date();

  const upsertWaybillId = waybillId ?? shipment.id;
  if (!upsertWaybillId) {
    throw new WaybillSyncError("运单 ID 缺失", "BAD_PARAM");
  }

  let totalAmountNum = 0;
  const items = shipment.items ?? [];
  for (const it of items) {
    if (typeof it === "object" && it && typeof it.quantity === "number") {
      totalAmountNum += it.quantity;
    }
  }

  const upserted = await prismaTx.waybill_snapshots.upsert({
    where: { waybillId: upsertWaybillId },
    create: {
      waybillId: upsertWaybillId,
      externalCode: shipment.externalCode ?? externalCode ?? null,
      storeName: shipment.storeName ?? null,
      recipientName: shipment.recipientName ?? null,
      recipientPhone: shipment.recipientPhone ?? null,
      recipientAddress: shipment.recipientAddress ?? null,
      v2Status: shipment.status ?? null,
      totalAmount: totalAmountNum,
      itemsSnapshot: items,
      syncedAt: now,
      syncRequestId: v2Result.requestId,
    },
    update: {
      externalCode: shipment.externalCode ?? externalCode ?? undefined,
      storeName: shipment.storeName ?? undefined,
      recipientName: shipment.recipientName ?? undefined,
      recipientPhone: shipment.recipientPhone ?? undefined,
      recipientAddress: shipment.recipientAddress ?? undefined,
      v2Status: shipment.status ?? undefined,
      totalAmount: totalAmountNum,
      itemsSnapshot: items,
      syncedAt: now,
      syncRequestId: v2Result.requestId,
    },
  });

  return upserted;
}

export async function markV2ExceptionStatus(
  ticket: any,
  hasException: boolean
): Promise<void> {
  if (!ticket) return;
  const waybillId = ticket.relatedWaybillId ?? null;
  const externalCode = ticket.externalCode ?? null;
  const severity = ticket.severity ?? undefined;
  const idOrExternalCode = waybillId ?? externalCode;
  if (!idOrExternalCode) {
    return;
  }
  try {
    await v2Client.markWaybillException(
      {
        idOrExternalCode,
        hasException,
        exceptionType: ticket.category === "QC" ? "qc" : "logistics",
        ticketId: ticket.ticketNo ?? ticket.id,
        severity,
        remark: `工单 ${ticket.ticketNo ?? ticket.id} 状态同步：${
          hasException ? "标记异常" : "解除异常"
        }`,
      },
      {
        callerUserId: ticket.reportedByUserId ?? undefined,
      }
    );
  } catch (e: any) {
    console.warn(
      `[markV2ExceptionStatus] 回写 V2 失败（降级忽略）：ticket=${
        ticket.id
      } err=${e?.message ?? String(e)}`
    );
  }
}
