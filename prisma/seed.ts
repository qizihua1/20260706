import { PrismaClient,
  UserRole,
  SyncDirection,
  ErrorCategory,
  TicketSource,
  TicketCategory,
  Severity,
  TicketStatus,
  ApprovalAction,
  CompensationDirection,
  PaymentStatus,
  InventoryReason,
  QcResult,
  QcBatchStatus,
  QcRuleCategory,
  ThresholdScope,
} from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function uid() {
  return crypto.randomUUID();
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad(n: number, len: number = 4) {
  return String(n).padStart(len, "0");
}

const LOGISTICS_SUBTYPES = [
  "丢件",
  "破损",
  "拒收",
  "超时未签收",
  "地址错误",
];

const QC_SUBTYPES = [
  "数量不符",
  "外观破损",
  "规格不符",
  "标签错误",
  "批次异常",
];

const STORE_NAMES = [
  "官方旗舰店",
  "华东仓储中心",
  "华南直营仓",
  "华北总仓",
  "西南分拨中心",
];

const SKU_CODES = Array.from({ length: 30 }, (_, i) => `SKU${pad(1000 + i, 4)}`);
const SKU_NAMES: Record<string, string> = {};
SKU_CODES.forEach((c, i) => {
  SKU_NAMES[c] = `商品${pad(i + 1, 3)}号`;
});

const RECIPIENT_FIRST = ["张", "李", "王", "刘", "陈", "杨", "赵", "黄", "周", "吴"];
const RECIPIENT_LAST = ["伟", "芳", "娜", "敏", "静", "磊", "洋", "艳", "勇", "军"];

function recipient() {
  return pick(RECIPIENT_FIRST) + pick(RECIPIENT_LAST) + (Math.random() > 0.5 ? pick(RECIPIENT_LAST) : "");
}

function phone() {
  return "1" + rand(3, 9) + String(rand(100000000, 999999999));
}

function address() {
  const cities = ["上海市浦东新区", "广州市天河区", "北京市朝阳区", "深圳市南山区", "杭州市西湖区"];
  return `${pick(cities)}xx路${rand(1, 999)}号xx小区${rand(1, 30)}栋${rand(1, 300)}室`;
}

function generateTicketNo(dateOffset: number, seq: number) {
  const d = new Date();
  d.setDate(d.getDate() - dateOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `T${y}${m}${day}-${pad(seq, 4)}`;
}

async function main() {
  console.log("🌱 Seeding V3 System 测试数据...");

  console.log("  👥 创建 5 个用户...");
  const usersData = [
    { username: "op1", displayName: "仓库操作员-小王", roles: [UserRole.WAREHOUSE_OPERATOR] },
    { username: "qc1", displayName: "品控主管-老李", roles: [UserRole.QC_SUPERVISOR] },
    { username: "l1_approver", displayName: "一级审批-张主管", roles: [UserRole.APPROVER_L1] },
    { username: "l2_approver", displayName: "二级审批-王经理", roles: [UserRole.APPROVER_L2] },
    { username: "admin", displayName: "系统管理员", roles: [UserRole.ADMIN, UserRole.APPROVER_L1, UserRole.APPROVER_L2] },
  ];
  const userIds: Record<string, string> = {};
  for (const u of usersData) {
    try {
      const created = await prisma.users.create({
        data: {
          username: u.username,
          displayName: u.displayName,
          roles: u.roles,
          email: `${u.username}@example.com`,
        },
      });
      userIds[u.username] = created.id;
    } catch (e) {
      console.warn(`    ⚠️ 创建用户失败: ${u.username}`, (e as Error).message);
    }
  }
  const opId = userIds["op1"];
  const qcId = userIds["qc1"];
  const l1Id = userIds["l1_approver"];
  const l2Id = userIds["l2_approver"];
  const adminId = userIds["admin"];

  console.log("  📋 创建审批分级规则...");
  const thresholds = [
    { ruleCode: "THR_GLOBAL_L1", scope: ThresholdScope.GLOBAL, minAmount: 0, maxAmount: 500, approvalLevel: 1, timeoutMinutes: 60 * 24 },
    { ruleCode: "THR_GLOBAL_L2_MID", scope: ThresholdScope.GLOBAL, minAmount: 500, maxAmount: 5000, approvalLevel: 2, timeoutMinutes: 60 * 48 },
    { ruleCode: "THR_GLOBAL_L2_HIGH", scope: ThresholdScope.GLOBAL, minAmount: 5000, maxAmount: null, approvalLevel: 2, timeoutMinutes: 60 * 24, qcHoldTimeoutMinutes: 60 * 4 },
  ];
  for (const t of thresholds) {
    try {
      await prisma.approval_thresholds.create({ data: t });
    } catch (e) {
      console.warn(`    ⚠️ 创建审批阈值失败: ${t.ruleCode}`, (e as Error).message);
    }
  }

  console.log("  🧪 创建品控规则...");
  const qcRulesData = [
    { ruleCode: "QR_QTY_DIFF", ruleName: "数量差异>=5%", category: QcRuleCategory.QTY_DIFF, triggerCondition: { qtyDiffPctGte: 5 }, severity: Severity.HIGH, routeToApprovalLevel: 2 },
    { ruleCode: "QR_DAMAGE", ruleName: "破损等级>=2", category: QcRuleCategory.DAMAGE, triggerCondition: { damageLevelGte: 2 }, severity: Severity.MEDIUM, routeToApprovalLevel: 1 },
    { ruleCode: "QR_LABEL_ERROR", ruleName: "标签错误", category: QcRuleCategory.LABEL_ERROR, triggerCondition: {}, severity: Severity.LOW, routeToApprovalLevel: 1 },
    { ruleCode: "QR_BATCH_ERROR", ruleName: "批次异常", category: QcRuleCategory.BATCH_ERROR, triggerCondition: {}, severity: Severity.CRITICAL, routeToApprovalLevel: 2 },
    { ruleCode: "QR_SPEC_MISMATCH", ruleName: "规格偏差>=2mm", category: QcRuleCategory.SPEC_MISMATCH, triggerCondition: { specDeviationMm: 2 }, severity: Severity.MEDIUM, routeToApprovalLevel: 1 },
  ];
  const qcRuleIds: Record<string, string> = {};
  for (const r of qcRulesData) {
    try {
      const created = await prisma.qc_rules.create({ data: r });
      qcRuleIds[r.ruleCode] = created.id;
    } catch (e) {
      console.warn(`    ⚠️ 创建品控规则失败: ${r.ruleCode}`, (e as Error).message);
    }
  }

  console.log("  📦 创建 40 张运单快照（说明：真实环境下由 V2 接口拉取）...");
  const waybillSnapshotIds: string[] = [];
  const waybillIds: string[] = [];
  for (let i = 0; i < 40; i++) {
    const waybillId = "SH" + pad(100000 + i, 6);
    waybillIds.push(waybillId);
    const itemCount = rand(1, 5);
    const items: any[] = [];
    let total = 0;
    for (let j = 0; j < itemCount; j++) {
      const sku = pick(SKU_CODES);
      const price = rand(10, 500);
      const qty = rand(1, 20);
      total += price * qty;
      items.push({
        id: uid(),
        shipmentId: waybillId,
        skuCode: sku,
        skuName: SKU_NAMES[sku],
        quantity: qty,
        unitPrice: price,
        subtotal: price * qty,
      });
    }
    try {
      const created = await prisma.waybill_snapshots.create({
        data: {
          waybillId,
          externalCode: "EXT" + pad(9000 + i, 5),
          storeName: pick(STORE_NAMES),
          recipientName: recipient(),
          recipientPhone: phone(),
          recipientAddress: address(),
          v2Status: pick(["PENDING", "SHIPPED", "DELIVERED", "EXCEPTION", "RETURNING"]),
          totalAmount: total,
          itemsSnapshot: items,
          sourceUrl: `https://code20200605.vercel.app/shipments/${waybillId}`,
          syncedAt: new Date(Date.now() - rand(0, 7) * 86400000),
          syncRequestId: uid(),
        },
      });
      waybillSnapshotIds.push(created.id);
    } catch (e) {
      console.warn(`    ⚠️ 创建运单快照失败: ${waybillId}`, (e as Error).message);
    }
  }

  console.log("  🎫 创建 200 张异常工单...");
  const ticketIds: string[] = [];
  const statuses = Object.values(TicketStatus);
  for (let i = 0; i < 200; i++) {
    const isLogistics = i % 2 === 0;
    const category = isLogistics ? TicketCategory.LOGISTICS : TicketCategory.QC;
    const subType = isLogistics ? pick(LOGISTICS_SUBTYPES) : pick(QC_SUBTYPES);
    const sev = pick([Severity.LOW, Severity.MEDIUM, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL]);
    const status = pick(statuses);
    const amount = sev === Severity.CRITICAL
      ? rand(5000, 50000)
      : sev === Severity.HIGH
      ? rand(500, 10000)
      : sev === Severity.MEDIUM
      ? rand(100, 3000)
      : rand(10, 1000);
    const approvalLevel = amount >= 500 ? 2 : 1;
    const wbIdx = i % waybillSnapshotIds.length;
    const wbSnapshotId = waybillSnapshotIds[wbIdx];
    const wbId = waybillIds[wbIdx];
    const reporterId = isLogistics ? opId : qcId;
    const daysAgo = rand(0, 14);
    const reportedAt = new Date(Date.now() - daysAgo * 86400000 - rand(0, 86400) * 1000);

    let l1Assignee: string | undefined = undefined;
    let l2Assignee: string | undefined = undefined;
    let deadlineAt: Date | undefined = undefined;
    let escalatedAt: Date | undefined = undefined;
    let closedAt: Date | undefined = undefined;

    if (status === TicketStatus.L1_APPROVING || status === TicketStatus.REJECTED_RESUBMIT || status === TicketStatus.EXECUTING) {
      l1Assignee = l1Id;
      deadlineAt = new Date(reportedAt.getTime() + 24 * 3600 * 1000);
    }
    if (status === TicketStatus.L2_APPROVING || approvalLevel === 2) {
      l1Assignee = l1Id;
      l2Assignee = l2Id;
      deadlineAt = new Date(reportedAt.getTime() + 48 * 3600 * 1000);
    }
    if (status === TicketStatus.ESCALATED_AUTO) {
      escalatedAt = new Date(reportedAt.getTime() + 25 * 3600 * 1000);
      l2Assignee = l2Id;
    }
    if (status === TicketStatus.COMPLETED || status === TicketStatus.CLOSED_AUTO_DISMISSED) {
      closedAt = new Date(reportedAt.getTime() + rand(1, 5) * 86400000);
    }

    const resubmitCount = status === TicketStatus.REJECTED_RESUBMIT ? rand(1, 3) : 0;

    try {
      const created = await prisma.exception_tickets.create({
        data: {
          ticketNo: generateTicketNo(daysAgo, i + 1),
          source: pick([TicketSource.SCAN_TRIGGER, TicketSource.SCAN_TRIGGER, TicketSource.MANUAL_REPORT]),
          category,
          subType,
          severity: sev,
          currentStatus: status,
          waybillSnapshotId: wbSnapshotId,
          relatedWaybillId: wbId,
          reportedByUserId: reporterId,
          reportedAt,
          description: `${subType}工单，运单${wbId}，金额¥${amount}，请处理。`,
          evidenceUrls: Math.random() > 0.5 ? [`https://img.example.com/ev${i}_1.jpg`, `https://img.example.com/ev${i}_2.jpg`] : undefined,
          amount,
          approvalLevelRequired: approvalLevel,
          l1AssigneeId: l1Assignee,
          l2AssigneeId: l2Assignee,
          resubmitCount,
          lastStatusChangedAt: new Date(reportedAt.getTime() + rand(10, 3600) * 1000),
          deadlineAt,
          escalatedAt,
          closedAt,
          approvalRuleSnapshot: { rule: "GLOBAL", minAmount: 0, maxAmount: 5000, level: approvalLevel },
          qcBatchLockId: !isLogistics && Math.random() > 0.5 ? "BATCH-LOCK-" + pad(i, 5) : undefined,
        },
      });
      ticketIds.push(created.id);
    } catch (e) {
      console.warn(`    ⚠️ 创建工单失败 #${i + 1}`, (e as Error).message);
    }
  }

  console.log("  🔍 创建 400+ 条扫描记录...");
  const qcRuleIdList = Object.values(qcRuleIds);
  let scanSeq = 1;
  for (let i = 0; i < ticketIds.length; i++) {
    const ticket = ticketIds[i];
    const wbIdx = i % waybillSnapshotIds.length;
    const wbSnapshotId = waybillSnapshotIds[wbIdx];
    const wbId = waybillIds[wbIdx];
    const scansPerTicket = rand(2, 4);
    for (let s = 0; s < scansPerTicket; s++) {
      const sku = pick(SKU_CODES);
      const batchNo = "B" + pad(rand(1, 40), 3) + pad(rand(0, 99), 2);
      const qcResult = Math.random() > 0.4 ? QcResult.PASSED : QcResult.HELD;
      const hitRule = qcResult === QcResult.HELD ? pick(qcRuleIdList) : undefined;
      const batchStatus =
        qcResult === QcResult.PASSED
          ? pick([QcBatchStatus.FREE, QcBatchStatus.RELEASED])
          : pick([QcBatchStatus.LOCKED, QcBatchStatus.LOCKED, QcBatchStatus.RETURNED_SUPPLIER, QcBatchStatus.DOWNGRADED]);
      try {
        await prisma.scan_records.create({
          data: {
            scanNo: "SC" + pad(scanSeq++, 6),
            waybillSnapshotId: wbSnapshotId,
            relatedWaybillId: wbId,
            skuCode: sku,
            skuName: SKU_NAMES[sku],
            batchNo,
            scanQty: rand(1, 10),
            scannedByUserId: Math.random() > 0.3 ? opId : undefined,
            scanDevice: pick(["PDA-001", "PDA-002", "FIXED-SCANNER-A3"]),
            qcResult,
            qcRuleHitId: hitRule,
            qcRuleHitDetail: hitRule ? { ruleId: hitRule, matchedFields: ["skuCode", "batchNo"], evidence: { sku, batchNo } } : undefined,
            qcBatchStatus: batchStatus,
            holdReason: qcResult === QcResult.HELD ? `品控暂扣：${pick(["数量不符", "外观破损", "标签错误"])}` : undefined,
            ticketId: qcResult === QcResult.HELD || Math.random() > 0.5 ? ticket : undefined,
            qcSupervisorReleaseNote: batchStatus === QcBatchStatus.RELEASED && qcResult === QcResult.HELD ? "主管复核后快速放行：客户急单" : undefined,
            qcSupervisorReleaseByUserId: batchStatus === QcBatchStatus.RELEASED && qcResult === QcResult.HELD ? qcId : undefined,
          },
        });
      } catch (e) {
        console.warn(`    ⚠️ 创建扫描记录失败 T${i}-S${s}`, (e as Error).message);
      }
    }
  }
  while (scanSeq <= 420) {
    const wbIdx = scanSeq % waybillSnapshotIds.length;
    const wbSnapshotId = waybillSnapshotIds[wbIdx];
    const wbId = waybillIds[wbIdx];
    const sku = pick(SKU_CODES);
    try {
      await prisma.scan_records.create({
        data: {
          scanNo: "SC" + pad(scanSeq++, 6),
          waybillSnapshotId: wbSnapshotId,
          relatedWaybillId: wbId,
          skuCode: sku,
          skuName: SKU_NAMES[sku],
          batchNo: "B" + pad(rand(1, 40), 3) + pad(rand(0, 99), 2),
          scanQty: rand(1, 5),
          scannedByUserId: opId,
          scanDevice: "PDA-001",
          qcResult: QcResult.PASSED,
          qcBatchStatus: QcBatchStatus.FREE,
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建额外扫描失败`, (e as Error).message);
      scanSeq++;
    }
  }

  console.log("  ✅ 创建 100+ 条审批记录...");
  let approvalSeq = 0;
  const beforeStatusMap: Record<string, string> = {
    APPROVED: "L1_APPROVING",
    REJECTED: "L2_APPROVING",
    ESCALATED: "L1_APPROVING",
  };
  const afterStatusMap: Record<string, string> = {
    APPROVED: "EXECUTING",
    REJECTED: "REJECTED_RESUBMIT",
    ESCALATED: "L2_APPROVING",
  };
  for (let i = 0; i < ticketIds.length; i++) {
    if (i % 2 !== 0) continue;
    const ticketId = ticketIds[i];
    const actions = [
      { action: ApprovalAction.APPROVED, p: 0.55 },
      { action: ApprovalAction.REJECTED, p: 0.25 },
      { action: ApprovalAction.ESCALATED, p: 0.1 },
      { action: ApprovalAction.QUICK_RELEASE_QC, p: 0.1 },
    ];
    let r = Math.random();
    let action: ApprovalAction = ApprovalAction.APPROVED;
    let cum = 0;
    for (const a of actions) { cum += a.p; if (r <= cum) { action = a.action; break; } }
    const level = action === ApprovalAction.QUICK_RELEASE_QC ? 1 : (i % 3 === 0 ? 2 : 1);
    const approver = level === 2 ? l2Id : l1Id;
    const before = action === ApprovalAction.QUICK_RELEASE_QC ? "L1_APPROVING" : (beforeStatusMap[action] ?? "PENDING_REVIEW");
    const after = action === ApprovalAction.QUICK_RELEASE_QC ? "COMPLETED" : (afterStatusMap[action] ?? "EXECUTING");
    approvalSeq++;
    try {
      await prisma.approval_records.create({
        data: {
          ticketId,
          approverUserId: approver,
          level,
          action,
          comment: action === ApprovalAction.REJECTED
            ? "材料不足，请补充照片和描述。"
            : action === ApprovalAction.APPROVED
            ? "同意，按流程执行。"
            : action === ApprovalAction.ESCALATED
            ? "金额较高，升级至L2审批。"
            : "品控快速放行。",
          beforeStatus: before,
          afterStatus: after,
          conflictDetected: Math.random() < 0.08,
          detectedReason: Math.random() < 0.08 ? "检测到并发修改，版本冲突。" : undefined,
          idempotencyKey: "IDEMPOT-" + pad(approvalSeq, 6) + "-" + uid().slice(0, 8),
          createdAt: new Date(Date.now() - rand(0, 10) * 86400000),
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建审批记录失败`, (e as Error).message);
    }
  }
  for (let i = 0; i < 20; i++) {
    approvalSeq++;
    try {
      await prisma.approval_records.create({
        data: {
          ticketId: pick(ticketIds),
          approverUserId: l2Id,
          level: 2,
          action: i < 10 ? ApprovalAction.AUTO_TIMEOUT_ESCALATE : ApprovalAction.AUTO_TIMEOUT_DISMISS,
          comment: i < 10 ? "超时未处理，自动升级" : "超时自动关闭",
          beforeStatus: "L1_APPROVING",
          afterStatus: i < 10 ? "ESCALATED_AUTO" : "CLOSED_AUTO_DISMISSED",
          idempotencyKey: "AUTO-" + pad(approvalSeq, 6),
          createdAt: new Date(Date.now() - rand(3, 14) * 86400000),
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建自动审批记录失败`, (e as Error).message);
    }
  }

  console.log("  💰 创建 60+ 条赔付记录...");
  const approvalRecords = await prisma.approval_records.findMany({ take: 80 });
  for (let i = 0; i < 70; i++) {
    const ticketId = pick(ticketIds);
    const approval = approvalRecords[i % approvalRecords.length];
    const direction = i % 2 === 0 ? CompensationDirection.PAY_TO_CUSTOMER : CompensationDirection.RECOVER_FROM_SUPPLIER;
    const statusesArr = [PaymentStatus.PAID, PaymentStatus.PENDING, PaymentStatus.RECEIVED, PaymentStatus.CANCELLED];
    try {
      await prisma.compensation_records.create({
        data: {
          ticketId,
          approvalRecordId: approval.id,
          direction,
          amount: rand(50, 8000),
          paymentStatus: pick(statusesArr),
          paymentMethod: pick(["银行转账", "支付宝", "微信", "内部抵扣"]),
          voucherNo: direction === CompensationDirection.PAY_TO_CUSTOMER ? "PAY" + pad(10000 + i, 5) : "RCV" + pad(20000 + i, 5),
          remark: direction === CompensationDirection.PAY_TO_CUSTOMER ? "赔付客户" : "向供应商追偿",
          triggeredByUserId: pick([l1Id, l2Id, adminId]),
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建赔付记录失败 #${i}`, (e as Error).message);
    }
  }

  console.log("  📊 创建 120+ 条库存变动记录...");
  const invReasons = Object.values(InventoryReason);
  for (let i = 0; i < 130; i++) {
    const ticketId = pick(ticketIds);
    const approval = approvalRecords[i % approvalRecords.length];
    const sku = pick(SKU_CODES);
    const reason = pick(invReasons);
    const negativeReasons: InventoryReason[] = [InventoryReason.QC_REJECT_RETURN_SUPPLIER, InventoryReason.LOGISTICS_RETURN_STOCK, InventoryReason.LOGISTICS_LOST_RESHIP, InventoryReason.MANUAL_ADJUST];
    const changeQty = negativeReasons.includes(reason)
      ? -rand(1, 30)
      : rand(1, 30);
    const before = rand(50, 2000);
    try {
      await prisma.inventory_records.create({
        data: {
          ticketId,
          approvalRecordId: Math.random() > 0.3 ? approval.id : undefined,
          skuCode: sku,
          skuName: SKU_NAMES[sku],
          batchNo: "B" + pad(rand(1, 40), 3) + pad(rand(0, 99), 2),
          changeQty,
          reason,
          beforeStockQty: before,
          afterStockQty: before + changeQty,
          warehouseCode: pick(["WH-SH-01", "WH-GZ-02", "WH-BJ-03", "WH-SZ-04"]),
          operatorUserId: opId,
          remark: `库存变动：${reason}`,
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建库存记录失败 #${i}`, (e as Error).message);
    }
  }

  console.log("  📡 创建 60+ 条同步日志...");
  const interfaceNames = [
    "GET /api/v2/shipments/list",
    "POST /api/v2/shipments/sync",
    "POST /api/v3/webhook/waybill-status",
    "GET /api/v2/shipments/:id/items",
    "POST /api/v2/shipments/:id/remark",
  ];
  const errors: (ErrorCategory | null)[] = [
    null, null, null, null, null,
    ErrorCategory.NETWORK_TIMEOUT,
    ErrorCategory.AUTH,
    ErrorCategory.NOT_FOUND,
    ErrorCategory.BAD_PARAM,
    ErrorCategory.V2_SERVER_ERROR,
    ErrorCategory.UNKNOWN,
  ];
  for (let i = 0; i < 65; i++) {
    const dir = i % 3 === 0 ? SyncDirection.RECEIVE_WEBHOOK : SyncDirection.CALL_V2;
    const iface = pick(interfaceNames);
    const err = pick(errors);
    const reqBody = JSON.stringify({ waybillId: "SH" + pad(100000 + (i % 40), 6), ts: Date.now() - i * 1000 });
    const reqHash = crypto.createHash("sha256").update(reqBody).digest("hex");
    const respBody = err ? JSON.stringify({ error: err, message: "mock error" }) : JSON.stringify({ code: 0, data: { ok: true } });
    const respHash = crypto.createHash("sha256").update(respBody).digest("hex");
    try {
      await prisma.sync_logs.create({
        data: {
          direction: dir,
          interfaceName: iface,
          httpMethod: iface.startsWith("GET") ? "GET" : "POST",
          requestUrl: "https://code20200605.vercel.app" + iface.split(" ")[1],
          requestBodySha256: reqHash,
          responseStatusCode: err ? (err === ErrorCategory.NETWORK_TIMEOUT ? undefined : pick([400, 401, 404, 500, 502])) : 200,
          responseBodySha256: respHash,
          requestId: uid(),
          durationMs: err === ErrorCategory.NETWORK_TIMEOUT ? rand(20000, 30000) : rand(20, 1500),
          errorCategory: err ?? undefined,
          errorMessage: err ? `模拟错误：${err}` : undefined,
          retryAttempt: err && Math.random() > 0.5 ? rand(1, 3) : 0,
          callerUserId: dir === SyncDirection.CALL_V2 ? adminId : undefined,
        },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建同步日志失败 #${i}`, (e as Error).message);
    }
  }

  console.log("  🛡️ 创建角色权限基础 RBAC...");
  const perms = [
    ["WAREHOUSE_OPERATOR", "scan:create"],
    ["WAREHOUSE_OPERATOR", "waybill:view"],
    ["WAREHOUSE_OPERATOR", "ticket:create"],
    ["QC_SUPERVISOR", "qc:release"],
    ["QC_SUPERVISOR", "scan:view"],
    ["QC_SUPERVISOR", "ticket:view"],
    ["APPROVER_L1", "approval:l1"],
    ["APPROVER_L1", "ticket:view"],
    ["APPROVER_L2", "approval:l2"],
    ["APPROVER_L2", "compensation:create"],
    ["ADMIN", "*"],
  ];
  for (const [role, permission] of perms) {
    try {
      await prisma.roles_permissions.create({
        data: { role, permission, description: `${role} -> ${permission}` },
      });
    } catch (e) {
      console.warn(`    ⚠️ 创建权限失败: ${role}/${permission}`, (e as Error).message);
    }
  }

  console.log("✅ Seeding 完成！");
  const stats = {
    users: await prisma.users.count(),
    waybill_snapshots: await prisma.waybill_snapshots.count(),
    exception_tickets: await prisma.exception_tickets.count(),
    scan_records: await prisma.scan_records.count(),
    approval_records: await prisma.approval_records.count(),
    compensation_records: await prisma.compensation_records.count(),
    inventory_records: await prisma.inventory_records.count(),
    sync_logs: await prisma.sync_logs.count(),
    qc_rules: await prisma.qc_rules.count(),
    approval_thresholds: await prisma.approval_thresholds.count(),
    roles_permissions: await prisma.roles_permissions.count(),
  };
  console.table(stats);
}

main()
  .catch((e) => {
    console.error("❌ Seeding 失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
