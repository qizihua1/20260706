import type { Prisma } from "@prisma/client";
import { updateBatchStatus } from "./scan-batch-machine";
import { transitionTicket } from "./ticket-state-machine";

export type CompensationDirection = "PAY_TO_CUSTOMER" | "RECOVER_FROM_SUPPLIER";
export type PaymentStatus = "PENDING" | "PAID" | "RECEIVED" | "CANCELLED";
export type InventoryReason =
  | "QC_REJECT_RETURN_SUPPLIER"
  | "QC_RELEASE"
  | "QC_DOWNGRADE_SALE"
  | "LOGISTICS_LOST_RESHIP"
  | "LOGISTICS_RETURN_STOCK"
  | "LOGISTICS_RESHIP_NEW"
  | "MANUAL_ADJUST"
  | "REPURCHASE_IN";

export type ExecuteAction =
  | "QC_RELEASE"
  | "QC_RETURN_SUPPLIER"
  | "QC_REPURCHASE"
  | "QC_DOWNGRADE"
  | "LOGISTICS_COMPENSATE_ONLY"
  | "LOGISTICS_RESHIP"
  | "LOGISTICS_RETURN_RESHIP"
  | "LOGISTICS_ADDRESS_FIX_RESHIP";

export interface ReshipmentSku {
  skuCode: string;
  skuName?: string;
  qty: number;
}

export interface ExecuteApprovalActionsParams {
  ticket: any;
  approvalRecord: any;
  executeAction: ExecuteAction;
  payoutAmount?: number;
  reshipmentSku?: ReshipmentSku[];
  remark?: string;
  inventoryBatchNo?: string;
  inventorySkuCode?: string;
  qcSupervisorReleaseNote?: string;
  qcSupervisorReleaseByUserId?: string;
}

export interface ExecuteApprovalActionsResult {
  ok: true;
  compensation?: any;
  inventoryChanges: any[];
  finalTicket: any;
}

function _compensationDirection(
  action: ExecuteAction,
  payoutAmount: number | undefined
): CompensationDirection | null {
  if (payoutAmount === undefined || payoutAmount <= 0) return null;
  switch (action) {
    case "QC_RELEASE":
    case "QC_RETURN_SUPPLIER":
    case "QC_REPURCHASE":
    case "QC_DOWNGRADE":
      return "RECOVER_FROM_SUPPLIER";
    case "LOGISTICS_COMPENSATE_ONLY":
    case "LOGISTICS_RESHIP":
      return "PAY_TO_CUSTOMER";
    case "LOGISTICS_RETURN_RESHIP":
    case "LOGISTICS_ADDRESS_FIX_RESHIP":
      return payoutAmount > 0 ? "PAY_TO_CUSTOMER" : null;
  }
}

function _resolveBatchAndSku(
  params: ExecuteApprovalActionsParams
): { batchNo: string | null; skuCode: string | null; items: any[] } {
  if (params.inventoryBatchNo || params.inventorySkuCode) {
    return {
      batchNo: params.inventoryBatchNo ?? null,
      skuCode: params.inventorySkuCode ?? null,
      items: [],
    };
  }
  const items: any[] = [];
  if (params.reshipmentSku && params.reshipmentSku.length > 0) {
    for (const s of params.reshipmentSku) {
      items.push({ skuCode: s.skuCode, skuName: s.skuName, qty: s.qty });
    }
  }
  return { batchNo: null, skuCode: null, items };
}

export async function executeApprovalActionsInTx(
  outerTx: Prisma.TransactionClient,
  params: ExecuteApprovalActionsParams
): Promise<ExecuteApprovalActionsResult> {
  const prismaTx = outerTx as any;
  const { ticket, approvalRecord, executeAction, payoutAmount, remark } =
    params;

  const direction = _compensationDirection(executeAction, payoutAmount);
  const now = new Date();
  const operatorUserId = approvalRecord?.approverUserId ?? undefined;

  let compensation: any = undefined;
  if (direction && payoutAmount && payoutAmount > 0) {
    const existingComp = await prismaTx.compensation_records.findUnique({
      where: { approvalRecordId: approvalRecord.id },
    });
    if (!existingComp) {
      try {
        compensation = await prismaTx.compensation_records.create({
          data: {
            ticketId: ticket.id,
            approvalRecordId: approvalRecord.id,
            direction,
            amount: payoutAmount,
            currency: "CNY",
            paymentStatus: "PENDING",
            remark: remark ?? null,
            triggeredByUserId: operatorUserId ?? null,
          },
        });
      } catch (e: any) {
        if (
          e?.code === "P2002" &&
          String(e?.message ?? "").includes("approvalRecordId")
        ) {
          compensation = await prismaTx.compensation_records.findUnique({
            where: { approvalRecordId: approvalRecord.id },
          });
        } else {
          throw e;
        }
      }
    } else {
      compensation = existingComp;
    }
  }

  const inventoryChanges: any[] = [];
  const { batchNo, skuCode, items } = _resolveBatchAndSku(params);
  const primarySkuCode =
    skuCode ?? items[0]?.skuCode ?? (ticket as any)?.skuCode ?? null;
  const primaryBatchNo =
    batchNo ?? (ticket as any)?.qcBatchLockId ?? (ticket as any)?.batchNo ?? null;

  async function _ensureInventoryRecord(
    data: {
      skuCode: string;
      skuName?: string;
      batchNo?: string;
      changeQty: number;
      reason: InventoryReason;
      uom?: string;
      warehouseCode?: string;
      remark?: string;
    }
  ) {
    const existing = await prismaTx.inventory_records.findFirst({
      where: {
        approvalRecordId: approvalRecord.id,
        skuCode: data.skuCode,
        reason: data.reason as any,
      },
    });
    if (existing) {
      inventoryChanges.push(existing);
      return existing;
    }
    const created = await prismaTx.inventory_records.create({
      data: {
        ticketId: ticket.id,
        approvalRecordId: approvalRecord.id,
        skuCode: data.skuCode,
        skuName: data.skuName ?? null,
        batchNo: data.batchNo ?? null,
        changeQty: data.changeQty,
        uom: data.uom ?? "件",
        reason: data.reason as any,
        warehouseCode: data.warehouseCode ?? null,
        operatorUserId: operatorUserId ?? null,
        remark: (data.remark ?? remark) ?? null,
      },
    });
    inventoryChanges.push(created);
    return created;
  }

  switch (executeAction) {
    case "QC_RELEASE": {
      if (primaryBatchNo && primarySkuCode) {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "RELEASED",
          reason: remark ?? "审批通过-品控放行",
          ticketId: ticket.id,
          qcSupervisorReleaseNote: params.qcSupervisorReleaseNote,
          qcSupervisorReleaseByUserId: params.qcSupervisorReleaseByUserId,
        });
      }
      break;
    }
    case "QC_RETURN_SUPPLIER": {
      if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: primaryBatchNo ?? undefined,
          changeQty: -1,
          reason: "QC_REJECT_RETURN_SUPPLIER",
          remark: remark ?? "品控异常退供应商",
        });
      }
      if (primaryBatchNo && primarySkuCode) {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "RETURNED_SUPPLIER",
          reason: remark ?? "品控退回供应商",
          ticketId: ticket.id,
        });
      }
      break;
    }
    case "QC_REPURCHASE": {
      if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: primaryBatchNo ?? undefined,
          changeQty: -1,
          reason: "QC_REJECT_RETURN_SUPPLIER",
          remark: remark ?? "重采：原批次扣减",
        });
        const newBatchNo =
          primaryBatchNo ? `${primaryBatchNo}-R${Date.now().toString().slice(-6)}` : `R${Date.now()}`;
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: newBatchNo,
          changeQty: 1,
          reason: "REPURCHASE_IN",
          remark: remark ?? "重采：新批次入库",
        });
      }
      if (primaryBatchNo && primarySkuCode) {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "RETURNED_SUPPLIER",
          reason: remark ?? "原批次退回待重采",
          ticketId: ticket.id,
        });
      }
      break;
    }
    case "QC_DOWNGRADE": {
      if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: primaryBatchNo ?? undefined,
          changeQty: 0,
          reason: "QC_DOWNGRADE_SALE",
          remark: remark ?? "品控降级特卖（仅记录）",
        });
      }
      if (primaryBatchNo && primarySkuCode) {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "DOWNGRADED",
          reason: remark ?? "品控降级处理",
          ticketId: ticket.id,
        });
      }
      break;
    }
    case "LOGISTICS_COMPENSATE_ONLY": {
      break;
    }
    case "LOGISTICS_RESHIP": {
      if (items.length > 0) {
        for (const it of items) {
          await _ensureInventoryRecord({
            skuCode: it.skuCode,
            skuName: it.skuName,
            batchNo: primaryBatchNo ?? undefined,
            changeQty: -Math.max(1, it.qty),
            reason: "LOGISTICS_LOST_RESHIP",
            remark: remark ?? "物流丢件扣减",
          });
          await _ensureInventoryRecord({
            skuCode: it.skuCode,
            skuName: it.skuName,
            changeQty: -Math.max(1, it.qty),
            reason: "LOGISTICS_RESHIP_NEW",
            remark: remark ?? "补发扣减",
          });
        }
      } else if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: primaryBatchNo ?? undefined,
          changeQty: -1,
          reason: "LOGISTICS_LOST_RESHIP",
          remark: remark ?? "物流丢件",
        });
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          changeQty: -1,
          reason: "LOGISTICS_RESHIP_NEW",
          remark: remark ?? "物流补发",
        });
      }
      break;
    }
    case "LOGISTICS_RETURN_RESHIP": {
      if (items.length > 0) {
        for (const it of items) {
          await _ensureInventoryRecord({
            skuCode: it.skuCode,
            skuName: it.skuName,
            batchNo: primaryBatchNo ?? undefined,
            changeQty: 1,
            reason: "LOGISTICS_RETURN_STOCK",
            remark: remark ?? "退货回库",
          });
          await _ensureInventoryRecord({
            skuCode: it.skuCode,
            skuName: it.skuName,
            changeQty: -Math.max(1, it.qty),
            reason: "LOGISTICS_RESHIP_NEW",
            remark: remark ?? "重新发货扣减",
          });
        }
      } else if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          batchNo: primaryBatchNo ?? undefined,
          changeQty: 1,
          reason: "LOGISTICS_RETURN_STOCK",
          remark: remark ?? "退货回库",
        });
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          changeQty: -1,
          reason: "LOGISTICS_RESHIP_NEW",
          remark: remark ?? "重发扣减",
        });
      }
      break;
    }
    case "LOGISTICS_ADDRESS_FIX_RESHIP": {
      if (items.length > 0) {
        for (const it of items) {
          await _ensureInventoryRecord({
            skuCode: it.skuCode,
            skuName: it.skuName,
            changeQty: -Math.max(1, it.qty),
            reason: "LOGISTICS_RESHIP_NEW",
            remark: remark ?? "地址修正重发扣减",
          });
        }
      } else if (primarySkuCode) {
        await _ensureInventoryRecord({
          skuCode: primarySkuCode,
          changeQty: -1,
          reason: "LOGISTICS_RESHIP_NEW",
          remark: remark ?? "地址修正重发扣减",
        });
      }
      break;
    }
  }

  const category: "LOGISTICS" | "QC" = ticket.category;
  if (category === "QC" && primaryBatchNo && primarySkuCode) {
    const currentScanRecords = await prismaTx.scan_records.findMany({
      where: { batchNo: primaryBatchNo, skuCode: primarySkuCode },
      take: 1,
    });
    if (
      currentScanRecords.length > 0 &&
      currentScanRecords[0].qcBatchStatus === "LOCKED"
    ) {
      if (
        executeAction === "QC_RETURN_SUPPLIER" ||
        executeAction === "QC_REPURCHASE"
      ) {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "RETURNED_SUPPLIER",
          ticketId: ticket.id,
          reason: remark,
        });
      } else if (executeAction === "QC_DOWNGRADE") {
        await updateBatchStatus(prismaTx, {
          batchNo: primaryBatchNo,
          skuCode: primarySkuCode,
          toStatus: "DOWNGRADED",
          ticketId: ticket.id,
          reason: remark,
        });
      }
    }
  }

  const transitionResult = await transitionTicket(prismaTx, ticket.id, {
    kind: "EXECUTE_DONE",
    actorUserId: operatorUserId,
    comment: remark ?? "执行联动完成",
  });

  return {
    ok: true,
    compensation,
    inventoryChanges,
    finalTicket: transitionResult.ticket,
  };
}
