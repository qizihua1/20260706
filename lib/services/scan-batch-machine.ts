import type { Prisma } from "@prisma/client";

export type QcBatchStatus =
  | "FREE"
  | "LOCKED"
  | "RELEASED"
  | "RETURNED_SUPPLIER"
  | "DOWNGRADED"
  | "SCRAPPED";

export const VALID_BATCH_TRANSITIONS: Record<QcBatchStatus, QcBatchStatus[]> = {
  FREE: ["LOCKED", "RELEASED"],
  LOCKED: ["RELEASED", "RETURNED_SUPPLIER", "DOWNGRADED", "SCRAPPED"],
  RELEASED: [],
  RETURNED_SUPPLIER: [],
  DOWNGRADED: [],
  SCRAPPED: [],
};

export class QcBatchStateError extends Error {
  public readonly from?: QcBatchStatus;
  public readonly to: QcBatchStatus;
  constructor(
    to: QcBatchStatus,
    from?: QcBatchStatus,
    reason?: string
  ) {
    super(
      `批次状态转移失败：${from ?? "?"} -> ${to}${
        reason ? `，原因：${reason}` : ""
      }`
    );
    this.name = "QcBatchStateError";
    this.from = from;
    this.to = to;
  }
}

export interface UpdateBatchStatusParams {
  batchNo: string;
  skuCode: string;
  toStatus: QcBatchStatus;
  reason?: string;
  ticketId?: string;
  qcSupervisorReleaseNote?: string;
  qcSupervisorReleaseByUserId?: string;
}

export async function updateBatchStatus(
  tx: Prisma.TransactionClient,
  params: UpdateBatchStatusParams
): Promise<any[]> {
  const prismaTx = tx as any;
  const {
    batchNo,
    skuCode,
    toStatus,
    reason,
    ticketId,
    qcSupervisorReleaseNote,
    qcSupervisorReleaseByUserId,
  } = params;

  const records = await prismaTx.scan_records.findMany({
    where: { batchNo, skuCode },
    orderBy: { createdAt: "desc" },
  });
  if (records.length === 0) {
    return [];
  }

  const currentStatus = records[0].qcBatchStatus as QcBatchStatus;
  if (currentStatus === toStatus) {
    return records;
  }

  const allowed = VALID_BATCH_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new QcBatchStateError(toStatus, currentStatus, "转移不被允许");
  }

  const allIds = records.map((r: any) => r.id);
  await prismaTx.scan_records.updateMany({
    where: { id: { in: allIds } },
    data: {
      qcBatchStatus: toStatus,
      ticketId: ticketId ?? undefined,
      holdReason: reason ?? undefined,
    },
  });

  if (
    toStatus === "RELEASED" &&
    (qcSupervisorReleaseNote || qcSupervisorReleaseByUserId)
  ) {
    const firstId = records[0].id;
    await prismaTx.scan_records.update({
      where: { id: firstId },
      data: {
        qcSupervisorReleaseNote: qcSupervisorReleaseNote ?? null,
        qcSupervisorReleaseByUserId: qcSupervisorReleaseByUserId ?? null,
      },
    });
  }

  const updatedRecords = await prismaTx.scan_records.findMany({
    where: { id: { in: allIds } },
    orderBy: { createdAt: "desc" },
  });
  return updatedRecords;
}
