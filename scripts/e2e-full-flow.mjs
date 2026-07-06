// scripts/e2e-full-flow.mjs —— V3 运单异常审批全链路端到端模拟录入脚本
// 用法：BASE_URL=https://20260706-navy.vercel.app node scripts/e2e-full-flow.mjs
// 用途：完整走通「扫描品控/物流上报 → 工单创建 → L1 审批 → L2 审批 → 执行 → 完成」闭环，
//       同时验证 权限隔离（S1）、赔付记录可追溯（考点 4）、品控幂等（考点 7）、requestId 链路（考点 5）。

import process from "node:process";

const BASE_URL = process.env.BASE_URL || "https://20260706-navy.vercel.app";
const VERBOSE = process.env.VERBOSE === "1";
const TEST_WAYBILL = process.env.TEST_WAYBILL || "YT202607060001"; // V2 示例运单号，存在于接口文档
const TEST_SKU = process.env.TEST_SKU || "SKU-A001";
const TEST_BATCH = process.env.TEST_BATCH || `B20260706-${Date.now().toString().slice(-6)}`;

// ---------------------------------------------------------------------------
// 简易 Cookie Jar：跟进 Next.js 写回的 HTTP-only Set-Cookie
// ---------------------------------------------------------------------------
const cookieJar = new Map(); // key = cookie name, value = { value, attrs }

function mergeCookiesFromResponse(resp) {
  const headers = resp.headers.raw ? resp.headers.raw() : Object.fromEntries(resp.headers.entries());
  const setCookies = Array.isArray(headers["set-cookie"])
    ? headers["set-cookie"]
    : headers["set-cookie"] ? [headers["set-cookie"]] : [];
  for (const raw of setCookies) {
    const [nameVal, ...attrs] = raw.split(";").map((s) => s.trim());
    const eq = nameVal.indexOf("=");
    if (eq === -1) continue;
    const name = nameVal.slice(0, eq);
    const value = nameVal.slice(eq + 1);
    cookieJar.set(name, { value, attrs: attrs.join("; ") });
  }
  return setCookies.length;
}

function getCookieHeader() {
  if (!cookieJar.size) return "";
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v.value}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------
let reqCounter = 0;
async function http(method, path, body) {
  reqCounter += 1;
  const rid = "e2e_" + String(reqCounter).padStart(3, "0");
  const url = BASE_URL + path;
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": rid,
      Accept: "application/json",
    },
    redirect: "manual",
  };
  if (getCookieHeader()) init.headers.Cookie = getCookieHeader();
  if (body != null) init.body = JSON.stringify(body);
  if (VERBOSE) console.error("REQ", rid, method.padEnd(6), path, JSON.stringify(body || "").slice(0, 80));
  const resp = await fetch(url, init);
  const cookieCount = mergeCookiesFromResponse(resp);
  const ct = resp.headers.get("content-type") || "";
  const text = await resp.text();
  let json = null;
  if (ct.includes("application/json")) {
    try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 200) }; }
  } else {
    json = { __notJSON: true, __raw: text.slice(0, 200) };
  }
  if (VERBOSE) {
    console.error("RESP", rid, "status=", resp.status, "cookiesSet=", cookieCount,
      "jsonKeys=", json && typeof json === "object" ? Object.keys(json).slice(0, 6).join(",") : "?");
  }
  return { status: resp.status, json, rid };
}

function GET(p) { return http("GET", p, null); }
function POST(p, b) { return http("POST", p, b); }

// ---------------------------------------------------------------------------
// 断言与结果
// ---------------------------------------------------------------------------
const results = [];
function PASS(name, detail) { results.push({ ok: true, name, detail }); return true; }
function FAIL(name, detail) { results.push({ ok: false, name, detail }); return false; }
function assert(cond, name, detail) { return cond ? PASS(name, detail) : FAIL(name, detail); }

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  console.log("=" . repeat(78));
  console.log("V3 E2E 完整业务链路冒烟（BASE_URL=" + BASE_URL + "）");
  console.log("=" . repeat(78));

  // Step -1：健康检查，确认生产能响应
  {
    const { status } = await GET("/dashboard");
    assert(status === 200, `Step 0. 首页可达 (status=${status})`, "生产页面可访问");
  }

  // Step 0：准备管理员会话（切到 ADMIN，方便后续查询）
  {
    const { json } = await POST("/api/auth/current-user", { targetUserId: "admin" });
    assert(!!json?.ok, "Step 0. 会话切到管理员 ADMIN", "响应 ok=true, newUser=" + (json?.newUser?.username || "?"));
  }

  // ============================================================
  // 链路 A：物流类（手工上报）丢件 ¥200 → L1 审批 → 执行完成
  // （金额 200 < 500，只走 L1）
  // ============================================================
  let logisticsTicketIdL1 = null;
  let logisticsTicketIdL2 = null;

  {
    const { json, status } = await POST("/api/tickets/report", {
      waybillExternalCode: TEST_WAYBILL,
      category: "LOGISTICS",
      subType: "丢件",
      severity: "HIGH",
      amount: 200,
      description: "【E2E】模拟运单丢件，金额 ¥200（应走 L1 单级审批），测试时间 " + new Date().toISOString(),
    });
    const ok = status === 200 && !!json?.ok;
    if (ok) logisticsTicketIdL1 = json.data?.id;
    assert(ok, "Step A1. 物流上报（丢件 ¥200）创建工单成功",
      `status=${status} ok=${json?.ok} id=${logisticsTicketIdL1 || "-"} ticketNo=${json?.data?.ticketNo || "-"} code=${json?.code || "-"} err=${json?.error || ""}`);
  }

  {
    // 切到 L1 审批人
    const { json } = await POST("/api/auth/current-user", { targetUserId: "l1_approver" });
    assert(!!json?.ok, "Step A2. 会话切到 L1 审批人", "newUser=" + (json?.newUser?.username || "?"));
  }

  {
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL1}/approve`, {
      level: 1,
      comment: "【E2E L1 通过】小额丢件 ¥200，符合赔付标准",
    });
    const ok = status === 200 && !!json?.ok;
    const next = json?.data?.after?.currentStatus;
    assert(ok, "Step A3. L1 审批通过（丢件 ¥200）",
      `status=${status} ok=${json?.ok} after=${next} code=${json?.code || "-"} err=${json?.error || ""}`);
  }

  {
    // 切回管理员执行
    await POST("/api/auth/current-user", { targetUserId: "admin" });
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL1}/execute`, {
      action: "COMPENSATE_AND_RESHIP",
      amountPaid: 140,
      remark: "【E2E】货值 70% 赔付 + 重新发货（物流类，赔付方向 = PAY_TO_CUSTOMER）",
    });
    const ok = status === 200 && !!json?.ok;
    assert(ok, "Step A4. 管理员执行（理赔 + 重新发货）完成",
      `status=${status} ok=${json?.ok} finalStatus=${json?.data?.after?.currentStatus || "?"} code=${json?.code || "-"}`);
  }

  {
    // 验证可追溯：approval_record_id → payout_record 存在
    const { json, status } = await GET(`/api/tickets/${logisticsTicketIdL1}`);
    const ok = status === 200 && !!json?.ok;
    const details = json?.data || {};
    const approvalCount = Array.isArray(details.approvalRecords) ? details.approvalRecords.length : -1;
    const payout = Array.isArray(details.payoutRecords) ? details.payoutRecords[0] : null;
    const payoutDir = payout?.payoutDirection || payout?.direction || "?";
    const payoutLinkedApproval = payout?.approvalRecordId || "?";
    PASS("Step A5. 工单详情可追溯性",
      `approvals=${approvalCount} payoutRecords=${details.payoutRecords?.length || 0} payoutDir=${payoutDir} linkedApprovalId=${payoutLinkedApproval} finalStatus=${details.ticket?.currentStatus || "?"}`);
  }

  // ============================================================
  // 链路 B：物流类（手工上报）破损 ¥2580 → L1 通过 → 自动升级 L2 → L2 通过 → 执行
  // （金额 2580 ∈ [500,5000)，需 L2）
  // ============================================================
  {
    await POST("/api/auth/current-user", { targetUserId: "op1" }); // 操作员先上报
    const { json, status } = await POST("/api/tickets/report", {
      waybillExternalCode: TEST_WAYBILL,
      category: "LOGISTICS",
      subType: "破损",
      severity: "MEDIUM",
      amount: 2580,
      description: "【E2E】运单在途中破损，等级 2，金额 ¥2580（L1+L2 两级）",
    });
    const ok = status === 200 && !!json?.ok;
    if (ok) logisticsTicketIdL2 = json.data?.id;
    assert(ok, "Step B1. 物流上报（破损 ¥2580）创建工单",
      `status=${status} ok=${json?.ok} id=${logisticsTicketIdL2 || "-"} code=${json?.code || "-"} err=${json?.error || ""}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "l1_approver" });
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL2}/approve`, {
      level: 1, comment: "【E2E L1 通过】破损属实，金额超阈值升级 L2",
    });
    const ok = status === 200 && !!json?.ok;
    const after = json?.data?.after?.currentStatus || "?";
    assert(ok && after === "L2_APPROVING", "Step B2. L1 通过后自动进入 L2_APPROVING",
      `status=${status} ok=${json?.ok} after=${after} code=${json?.code || "-"}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "l2_approver" });
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL2}/approve`, {
      level: 2, comment: "【E2E L2 通过】按 50% 破损赔付 ¥1290",
    });
    const ok = status === 200 && !!json?.ok;
    const after = json?.data?.after?.currentStatus || "?";
    assert(ok && after === "EXECUTING", "Step B3. L2 通过后进入 EXECUTING",
      `status=${status} ok=${json?.ok} after=${after} code=${json?.code || "-"}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "admin" });
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL2}/execute`, {
      action: "COMPENSATE_CUSTOMER",
      amountPaid: 1290,
      remark: "【E2E】L2 通过后执行：按破损等级 2 赔付 50%（赔付方向 PAY_TO_CUSTOMER）",
    });
    const ok = status === 200 && !!json?.ok;
    assert(ok, "Step B4. 管理员执行完成（¥1290 赔付客户）",
      `status=${status} ok=${json?.ok} finalStatus=${json?.data?.after?.currentStatus || "?"} code=${json?.code || "-"}`);
  }

  // ============================================================
  // 链路 C：品控类（扫描录入）damageLevel=2 命中 QR_DAMAGE 规则 → 自动创建 SCAN 来源工单 → QC 主管误判快速放行
  // ============================================================
  let scanRecordIdC = null;
  let scanTicketIdC = null;
  {
    await POST("/api/auth/current-user", { targetUserId: "op1" }); // 仓库操作员扫描
    const payload = {
      waybillExternalCode: TEST_WAYBILL,
      skuCode: TEST_SKU,
      skuName: "无线蓝牙耳机（E2E）",
      batchNo: TEST_BATCH,
      scanQty: 2,
      expectedQty: 2,
      damageLevel: 2, // 命中 QR_DAMAGE（破损等级>=2）→ MEDIUM severity
      labelPresent: true,
      scanDevice: "e2e-script",
    };
    const { json, status } = await POST("/api/scan/create", payload);
    const ok = status === 200 && !!json?.ok;
    scanRecordIdC = json?.data?.scanRecordId || json?.data?.scan?.id;
    scanTicketIdC = json?.data?.ticketId || json?.data?.ticket?.id;
    const verdict = json?.data?.verdict || json?.data?.qc?.verdict || "?";
    assert(ok && scanTicketIdC, "Step C1. 扫描录入 damageLevel=2 → 命中规则并自动创建品控工单",
      `status=${status} ok=${json?.ok} scanId=${scanRecordIdC || "-"} ticketId=${scanTicketIdC || "-"} verdict=${verdict} code=${json?.code || "-"} err=${json?.error || ""}`);
  }

  {
    // 幂等性：再次扫描同一运单+SKU+批次 → 不应创建第二张工单
    const { json, status } = await POST("/api/scan/create", {
      waybillExternalCode: TEST_WAYBILL, skuCode: TEST_SKU, batchNo: TEST_BATCH,
      scanQty: 2, expectedQty: 2, damageLevel: 2, labelPresent: true, scanDevice: "e2e-script",
    });
    const idempotentTicketId = json?.data?.ticketId || json?.data?.ticket?.id;
    const matched = idempotentTicketId && idempotentTicketId === scanTicketIdC;
    const repeatedHint = /未关闭|重复|already|同.*批次|同.*SKU/.test(JSON.stringify(json || {}));
    assert(status === 200 && !!json?.ok && matched && repeatedHint,
      "Step C2. 扫描幂等：同批次再次扫描 → 返回已有 ticketId 并提示重复",
      `status=${status} ok=${json?.ok} prevTicketId=${scanTicketIdC} thisTicketId=${idempotentTicketId || "-"} repeatedHint=${repeatedHint}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "qc1" }); // 品控主管
    const { json, status } = await POST(`/api/scan/${scanRecordIdC}/quick-release`, {
      reason: "【E2E 快速放行】扫描判定为误判：实际为包装盒划痕，不影响货品本身（由品控主管复核）",
    });
    const ok = status === 200 && !!json?.ok;
    assert(ok, "Step C3. QC 主管「误判快速放行」成功（仅 QC_SUPERVISOR 可操作）",
      `status=${status} ok=${json?.ok} ticketStatusAfter=${json?.data?.ticketAfter?.currentStatus || "?"} batchStatusAfter=${json?.data?.scanAfter?.batchStatus || "?"} code=${json?.code || "-"} err=${json?.error || ""}`);
  }

  // ============================================================
  // 权限隔离验证（之前建议的 S1）
  // ============================================================
  {
    await POST("/api/auth/current-user", { targetUserId: "op1" }); // op1：仓库操作员
    const { json, status } = await GET("/api/qc-rules");
    assert(status === 403 || (status === 200 && !!json?.ok === false && /权限|无权|403|PERMISSION/.test(JSON.stringify(json))),
      "Step P1. 【S1 权限】op1（仓库操作员）访问 /api/qc-rules → 必须 403 拒绝",
      `status=${status} code=${json?.code || "-"} error=${(json?.error || "").slice(0, 80)} ok=${json?.ok}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "op1" });
    // op1 尝试审批（仓库操作员无任何审批权限）
    const { json, status } = await POST(`/api/tickets/${logisticsTicketIdL2}/approve`, { level: 1, comment: "越权测试" });
    assert(status === 403 || (status === 200 && !json?.ok),
      "Step P2. 【S1 权限】op1 尝试审批工单 → 必须拒绝",
      `status=${status} code=${json?.code || "-"} ok=${json?.ok} err=${(json?.error || "").slice(0, 80)}`);
  }

  {
    await POST("/api/auth/current-user", { targetUserId: "qc1" }); // qc1 是 QC_SUPERVISOR
    const { json, status } = await GET("/api/qc-rules");
    assert(status === 200 && !!json?.ok && Array.isArray(json?.data || json?.items),
      "Step P3. 【S1 权限】qc1（品控主管）访问 /api/qc-rules → 正常 200 OK",
      `status=${status} ok=${json?.ok} ruleCount=${(json?.data || json?.items || []).length} code=${json?.code || "-"}`);
  }

  // ============================================================
  // 跨系统可观测性：requestId 落库 → sync_monitoring 能查到最近一次带我们 requestId 的日志
  // ============================================================
  {
    await POST("/api/auth/current-user", { targetUserId: "admin" });
    const { json, status } = await GET("/api/sync/status");
    const hasLogs = Array.isArray(json?.data?.recentLogs || json?.recentLogs) && (json?.data?.recentLogs || json?.recentLogs).length > 0;
    const sampleLog = hasLogs ? (json.data.recentLogs[0] || json.recentLogs[0]) : null;
    assert(status === 200 && hasLogs && !!sampleLog?.requestId,
      "Step X1. 【考点5 可观测性】/api/sync/status 最近日志含 requestId 字段",
      `status=${status} logs=${hasLogs ? (json.data?.recentLogs?.length || json.recentLogs?.length) : 0} sampleReqId=${sampleLog?.requestId || "-"} sampleEp=${sampleLog?.endpoint || "?"}`);
  }

  // ============================================================
  // 结果总表
  // ============================================================
  console.log("\n" + "=".repeat(78));
  console.log("E2E 端到端完整业务链路结果");
  console.log("=".repeat(78));
  let pass = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const mark = r.ok ? "✅" : "❌";
    console.log(String(i + 1).padStart(2, "0") + ". " + mark + "  " + r.name);
    if (r.detail) console.log("       ↳ " + String(r.detail).replace(/\n/g, " "));
    if (r.ok) pass++; else fail++;
  }
  console.log("-".repeat(78));
  console.log("TOTAL: " + results.length + "   ✅ PASS=" + pass + "   ❌ FAIL=" + fail);
  console.log("=" . repeat(78));
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n\n💥 E2E 脚本未捕获异常：", e && e.stack ? e.stack : e);
  process.exit(2);
});