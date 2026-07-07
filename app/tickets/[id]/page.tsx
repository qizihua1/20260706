"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { TicketTimeline, TimelineItem } from "@/components/ui/TicketTimeline";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PermissionGate } from "@/components/ui/PermissionGate";
import {
  ArrowLeft, RefreshCw, Clock, AlertTriangle, CheckCircle2, XCircle,
  Zap, DollarSign, Package, User, MapPin, FileText, Image as ImageIcon,
  ShieldAlert, Truck, HandCoins, Warehouse, Copy, Ban, Flame,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatDate, cn } from "@/lib/utils";
import { z } from "zod";

type ExecuteActionKey =
  | "PAY_CUSTOMER" | "RECOVER_VENDOR" | "RESEND_PACKAGE" | "REFUND"
  | "RELEASE_BATCH" | "DESTROY_GOODS" | "RETURN_TO_WAREHOUSE" | "REWORK";

const QC_ACTIONS: { key: ExecuteActionKey; label: string; desc: string; icon: any }[] = [
  { key: "RELEASE_BATCH", label: "解除暂扣", desc: "释放被锁定批次", icon: ShieldAlert },
  { key: "DESTROY_GOODS", label: "销毁货物", desc: "不合格品销毁", icon: Flame },
  { key: "RETURN_TO_WAREHOUSE", label: "退回仓库", desc: "重新入库处理", icon: Warehouse },
  { key: "REWORK", label: "返工处理", desc: "返回加工再质检", icon: Zap },
];
const LOG_ACTIONS: { key: ExecuteActionKey; label: string; desc: string; icon: any }[] = [
  { key: "PAY_CUSTOMER", label: "赔付客户", desc: "直接补偿客户损失", icon: DollarSign },
  { key: "RECOVER_VENDOR", label: "追偿供应商", desc: "向供应商发起追偿", icon: HandCoins },
  { key: "RESEND_PACKAGE", label: "重新发货", desc: "重新安排补发包裹", icon: Truck },
  { key: "REFUND", label: "订单退款", desc: "全额退款给客户", icon: DollarSign },
];

interface TicketDetail {
  id: string;
  ticketNo: string;
  category: "LOGISTICS" | "QC";
  subType: string;
  severity: string;
  currentStatus: string;
  externalCode: string;
  abnormalAmount: number;
  description: string;
  source: "SCAN" | "MANUAL";
  reportedBy: string;
  reportedByUserId: string;
  createdAt: string;
  deadlineAt: string;
  approvalLevelRequired: number;
  l1AssigneeId?: string | null;
  l2AssigneeId?: string | null;
  l1AssigneeName?: string | null;
  l2AssigneeName?: string | null;
  evidenceUrls: string[];
  // Waybill
  waybill?: {
    externalCode: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    totalAmount: number;
    itemsSnapshot?: { name: string; sku?: string; qty: number; price: number }[];
    syncedAt: string;
    syncedFromV2: boolean;
    diffs?: { field: string; old: any; new: any }[];
  } | null;
  // Records
  approvalRecords?: any[];
  statusChanges?: any[];
  compensationRecords?: { id: string; type: string; direction?: string; amount: number; target: string; createdAt: string; remark?: string; approvalRecordId?: string; voucherUrl?: string; paid?: boolean; paidAt?: string; payer?: string }[];
  inventoryRecords?: { id: string; sku: string; qtyChange: number; reason: string; createdAt: string }[];
  scanRecords?: { id: string; batchNo: string; skuCode: string; qty: number; locked: boolean; lockedUntil?: string }[];
}

function useCountdown(deadlineAt: string | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadlineAt) return { text: "-", color: "text-gray-500", ms: 0 };
  const ms = new Date(deadlineAt).getTime() - now;
  const abs = Math.abs(Math.floor(ms / 1000));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  let text = "";
  if (ms < 0) text = `已超时 ${h}h${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  else text = `${h}h${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  let color = "text-gray-700";
  if (ms < 0) color = "text-red-600 font-bold";
  else if (ms <= 30 * 60 * 1000) color = "text-red-600 font-bold animate-pulse";
  else if (ms <= 120 * 60 * 1000) color = "text-orange-600 font-semibold";
  return { text, color, ms };
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const ticketId = params.id;

  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [rejectSuggestion, setRejectSuggestion] = useState("");

  const [executeAction, setExecuteAction] = useState<ExecuteActionKey | "">("");
  const [payoutAmount, setPayoutAmount] = useState<number | "">(0);
  const [executeLoading, setExecuteLoading] = useState(false);

  const countdown = useCountdown(ticket?.deadlineAt);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      const json = await res.json();
      if (json.ok) {
        setTicket(json.data);
        if (payoutAmount === 0 && json.data?.abnormalAmount) {
          setPayoutAmount(json.data.abnormalAmount);
        }
      } else {
        toast.error(json.error ?? "加载失败");
      }
    } catch (e: any) {
      toast.error(e.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [ticketId]);

  const handleSyncWaybill = async () => {
    if (!ticket) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync/waybill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalCode: ticket.externalCode, force: true }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("运单信息已刷新");
        setTicket((t) => t ? ({ ...t, waybill: json.data }) : t);
      } else toast.error(json.error ?? "同步失败");
    } catch (e: any) {
      toast.error(e.message ?? "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const buildTimeline = useMemo((): TimelineItem[] => {
    const list: TimelineItem[] = [];
    if (!ticket) return [];
    if (ticket.createdAt) {
      list.push({
        id: "create",
        type: "create",
        title: "工单创建",
        actor: ticket.reportedBy,
        timestamp: ticket.createdAt,
        comment: `来源：${ticket.source === "SCAN" ? "品控扫描" : "手动上报"}`,
      });
    }
    (ticket.statusChanges ?? []).forEach((c) => {
      list.push({
        id: `sc-${c.id ?? Math.random()}`,
        type: "status_change",
        title: `状态变更：${c.fromStatus ?? "-"} → ${c.toStatus}`,
        actor: c.actorName ?? c.actorId,
        comment: c.reason,
        timestamp: c.createdAt ?? new Date(),
      });
    });
    (ticket.approvalRecords ?? []).forEach((a) => {
      const isL2 = a.level === 2 || a.approvalLevel === 2;
      const decision = a.decision ?? a.action ?? "approve";
      const approved = decision === "APPROVED" || decision === "approve" || decision === "APPROVE";
      const rejected = decision === "REJECTED" || decision === "reject";
      const escalated = decision === "ESCALATED" || decision === "escalate";
      let type: TimelineItem["type"] = "note";
      if (escalated) type = "escalate";
      else if (approved) type = isL2 ? "l2_approve" : "l1_approve";
      else if (rejected) type = isL2 ? "l2_reject" : "l1_reject";
      list.push({
        id: `ar-${a.id ?? Math.random()}`,
        type,
        title: `${isL2 ? "L2" : "L1"}审批${approved ? "通过" : rejected ? "驳回" : escalated ? "升级" : ""}`,
        actor: a.approverName ?? a.approverId ?? a.actorName,
        action: decision,
        comment: a.comment ?? a.note,
        timestamp: a.createdAt ?? new Date(),
        meta: a.amount !== undefined ? { amount: formatMoney(a.amount) } : undefined,
      });
    });
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [ticket]);

  const handleApprove = async (note?: string) => {
    const res = await fetch(`/api/tickets/${ticketId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: ticket?.currentStatus === "L2_APPROVING" ? 2 : 1, comment: note }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("审批已通过");
      load();
    } else {
      toast.error(json.error ?? "失败");
      throw new Error(json.error);
    }
  };
  const handleReject = async (note?: string) => {
    if (!rejectSuggestion.trim() && !note) {
      toast.error("请填写修改建议");
      throw new Error("no suggestion");
    }
    const res = await fetch(`/api/tickets/${ticketId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: ticket?.currentStatus === "L2_APPROVING" ? 2 : 1,
        comment: note,
        suggestion: rejectSuggestion,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("已驳回");
      setRejectSuggestion("");
      load();
    } else {
      toast.error(json.error ?? "失败");
      throw new Error(json.error);
    }
  };
  const handleEscalate = async (note?: string) => {
    const res = await fetch(`/api/tickets/${ticketId}/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: note }),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("已升级");
      load();
    } else {
      toast.error(json.error ?? "失败");
      throw new Error(json.error);
    }
  };

  const handleExecute = async () => {
    if (!executeAction) { toast.error("请选择执行动作"); return; }
    const amt = Number(payoutAmount);
    if (isNaN(amt) || amt < 0) { toast.error("请输入有效的金额"); return; }
    setExecuteLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: executeAction, payoutAmount: amt }),
      });
      const json = await res.json();
      if (json.ok) { toast.success("已执行，工单关闭"); load(); setExecuteAction(""); }
      else { toast.error(json.error ?? "执行失败"); }
    } catch (e: any) { toast.error(e.message ?? "执行失败"); }
    finally { setExecuteLoading(false); }
  };

  if (loading && !ticket) {
    return (
      <div className="space-y-5">
        <div className="h-24 bg-white rounded-xl border border-cyan-100 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-56 bg-white rounded-xl border border-cyan-100 animate-pulse" />
            ))}
          </div>
          <div className="lg:col-span-2 space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 bg-white rounded-xl border border-cyan-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) return <div className="p-10 text-center text-gray-400">工单不存在</div>;

  const isApproving = ticket.currentStatus === "L1_APPROVING" || ticket.currentStatus === "L2_APPROVING" || ticket.currentStatus === "PENDING_REVIEW" || ticket.currentStatus === "ESCALATED_AUTO";
  const isExecuting = ticket.currentStatus === "EXECUTING";
  const actionList = ticket.category === "QC" ? QC_ACTIONS : LOG_ACTIONS;

  return (
    <div>
      <PageHeader
        title={<div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-bold text-gray-900">{ticket.ticketNo}</span>
          <StatusBadge status={ticket.currentStatus} category={ticket.category} urgentDot={countdown.ms <= 120 * 60 * 1000} />
          <SeverityBadge severity={ticket.severity} />
        </div>}
        subtitle={`${ticket.category === "QC" ? "品控异常" : "物流异常"} · ${ticket.subType} · ${ticket.source === "SCAN" ? "品控扫描来源" : "手动上报来源"}`}
        breadcrumbs={[
          { label: "工单管理", href: "/tickets" },
          { label: ticket.ticketNo },
        ]}
        actions={
          <>
            <Link href="/tickets" className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> 返回列表
            </Link>
            <button onClick={load} disabled={loading} className="btn-primary flex items-center gap-2">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> 刷新
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        <div className="lg:col-span-7 space-y-5">
          {/* 运单信息卡 */}
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-teal-600" />
                <h3 className="text-lg font-bold text-gray-900">运单信息</h3>
              </div>
              <button onClick={handleSyncWaybill} disabled={syncing} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} /> 从 V2 刷新
              </button>
            </div>
            {ticket.waybill?.syncedFromV2 ? (
              <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                ✅ 实时获取自 V2 · 更新于 <b>{formatDate(ticket.waybill.syncedAt)}</b>
              </div>
            ) : (
              <div className="mb-4 p-3 rounded-lg bg-orange-50 border border-orange-200 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-orange-800">
                    ⚠️ 使用本地缓存 · 同步于 {ticket.waybill?.syncedAt ?? "-"}
                  </div>
                  <button onClick={handleSyncWaybill} disabled={syncing} className="text-xs mt-1 text-orange-700 underline font-semibold hover:text-orange-800 disabled:opacity-50">
                    点击刷新，对比差异 →</button>
                </div>
              </div>
            )}
            {ticket.waybill?.diffs && ticket.waybill.diffs.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
              <div className="text-xs font-semibold text-yellow-800 mb-2 px-3 pt-2">🔀 本次刷新差异高亮：</div>
              <ul className="text-xs space-y-1 px-3 pb-2">
                {ticket.waybill.diffs.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-yellow-800">
                  <span className="font-mono bg-yellow-100 px-1 rounded">{d.field}</span>
                  <span className="text-gray-500 line-through">{JSON.stringify(d.old)}</span>
                  <span>→</span>
                  <span className="font-semibold bg-green-100 px-1 rounded">{JSON.stringify(d.new)}</span>
                  </li>
                ))}
              </ul>
            </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-100">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><User className="w-3.5 h-3.5" /> 收件人</div>
                <div className="font-semibold text-gray-900">
                  {ticket.waybill?.receiverName ?? "-"}
                  <span className="ml-2 text-gray-500 font-normal text-sm">{ticket.waybill?.receiverPhone}</span>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><DollarSign className="w-3.5 h-3.5" /> 运单总金额</div>
                <div className="text-xl font-bold text-green-700">{formatMoney(ticket.waybill?.totalAmount ?? 0)}</div>
              </div>
              <div className="sm:col-span-2 p-4 rounded-xl bg-gray-50 border border-gray-100">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1"><MapPin className="w-3.5 h-3.5" /> 收件地址</div>
                <div className="text-sm text-gray-800">{ticket.waybill?.receiverAddress ?? "-"}</div>
              </div>
            </div>

            {ticket.waybill?.itemsSnapshot && ticket.waybill.itemsSnapshot.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">📦 物品清单 (itemsSnapshot)</div>
                <div className="overflow-hidden rounded-lg border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-teal-700">商品名</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-teal-700">SKU</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-teal-700">数量</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-teal-700">单价</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-teal-700">小计</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {ticket.waybill.itemsSnapshot.map((it, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-800">{it.name}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{it.sku ?? "-"}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{it.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatMoney(it.price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">{formatMoney(it.qty * it.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* 工单基础信息 */}
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-5 h-5 text-teal-600" />
              <h3 className="text-lg font-bold text-gray-900">工单基础信息</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">异常类别</div>
                <div className="font-semibold text-gray-800">{ticket.category === "QC" ? "品控" : "物流"}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">子类型</div>
                <div className="font-semibold text-gray-800">{ticket.subType}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">上报人</div>
                <div className="font-semibold text-gray-800">{ticket.reportedBy}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">上报时间</div>
                <div className="font-semibold text-gray-800 text-xs">{formatDate(ticket.createdAt)}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">来源</div>
                <div className="font-semibold text-gray-800">{ticket.source}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">要求等级</div>
                <div className="font-semibold text-gray-800">L{ticket.approvalLevelRequired}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">L1 审批人</div>
                <div className="font-semibold text-gray-800 text-xs">{ticket.l1AssigneeName ?? "-"}</div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="text-xs text-gray-500 mb-0.5">L2 审批人</div>
                <div className="font-semibold text-gray-800 text-xs">{ticket.l2AssigneeName ?? "-"}</div>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-xs font-semibold text-gray-500 mb-1.5">📝 异常描述</div>
              <div className="p-4 rounded-lg bg-gradient-to-br from-cyan-50/60 to-teal-50/60 border border-cyan-100 text-sm text-gray-700 whitespace-pre-wrap">
                {ticket.description}
              </div>
            </div>
            {ticket.evidenceUrls && ticket.evidenceUrls.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" /> 证据链接 ({ticket.evidenceUrls.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ticket.evidenceUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-teal-50 hover:border-teal-200 transition-colors text-sm text-gray-700 group">
                      <ImageIcon className="w-4 h-4 text-gray-400 group-hover:text-teal-600 shrink-0" />
                      <span className="truncate font-mono text-xs">{url}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 时间轴 */}
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-teal-600" />
                <h3 className="text-lg font-bold text-gray-900">审批 / 状态时间轴</h3>
              </div>
              <span className="text-xs text-gray-400">共 {buildTimeline.length} 条记录</span>
            </div>
            <TicketTimeline items={buildTimeline} />
          </div>
        </div>

        {/* 右列 35% */}
        <div className="lg:col-span-3 space-y-5">
          {/* 待操作卡片 */}
          {isApproving && (
            <PermissionGate requireApproveLevel={ticket.currentStatus === "L2_APPROVING" || ticket.currentStatus === "ESCALATED_AUTO" ? 2 : 1}>
              <div className="bg-white rounded-xl border-2 border-orange-300 shadow-lg shadow-orange-100 p-6 sticky top-24">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-gray-900">等待你的审批</div>
                      <div className="text-xs text-gray-500">{ticket.currentStatus === "L2_APPROVING" || ticket.currentStatus === "ESCALATED_AUTO" ? "L2 级别" : "L1 级别"}</div>
                    </div>
                  </div>
                </div>
                <div className={cn("p-3 rounded-lg mb-4 text-center font-mono text-xl", countdown.color)}>
                  <Clock className="w-4 h-4 inline mr-1" />
                  <span>{countdown.text}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button onClick={() => setApproveOpen(true)} className="px-3 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold shadow-sm flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5" /> 通过
                  </button>
                  <button onClick={() => setRejectOpen(true)} className="px-3 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-white font-bold shadow-sm flex items-center justify-center gap-1.5">
                    <XCircle className="w-5 h-5" /> 驳回
                  </button>
                </div>
                <button onClick={() => setEscalateOpen(true)} className="w-full px-3 py-2.5 rounded-xl border-2 border-red-200 bg-red-50 text-red-700 text-sm font-bold hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5">
                  <Flame className="w-4 h-4" /> 手动升级（ESCALATE）
                </button>
              </div>
            </PermissionGate>
          )}

          {/* 执行联动卡片 */}
          {isExecuting && (
            <PermissionGate requireRoles={["WAREHOUSE_OPERATOR" as any, "APPROVER_L2" as any, "ADMIN" as any]}>
              <div className="bg-white rounded-xl border-2 border-purple-300 shadow-lg shadow-purple-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-fuchsia-500 flex items-center justify-center text-white">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-gray-900">执行联动</div>
                  <div className="text-xs text-gray-500">
                    类型：{ticket.category === "QC" ? "品控处理" : "物流赔付"}
                  </div>
                </div>
              </div>
              <div className="space-y-2 mb-4">
                {actionList.map(a => {
                  const Icon = a.icon;
                  const active = executeAction === a.key;
                  return (
                    <label key={a.key} className={cn("flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all",
                      active ? "border-purple-500 bg-purple-50 shadow-sm" : "border-gray-200 bg-white hover:bg-gray-50")}>
                      <input
                        type="radio"
                        name="executeAction"
                        checked={active}
                        onChange={() => setExecuteAction(a.key)}
                        className="mt-1 accent-purple-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className={cn("w-4 h-4", active ? "text-purple-600" : "text-gray-400")} />
                          <span className="font-semibold text-gray-900 text-sm">{a.label}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{a.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">赔付 / 关联金额 (元)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">¥</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full pl-8 pr-3 py-2.5 rounded-lg border-2 border-purple-200 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200 font-mono font-bold bg-purple-50/50"
                  />
                </div>
                <div className="mt-1 text-[10px] text-gray-400">工单异常金额：{formatMoney(ticket.abnormalAmount)}</div>
              </div>
              <button
                onClick={handleExecute}
                disabled={executeLoading || !executeAction}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 text-white font-bold shadow-lg shadow-purple-200 disabled:opacity-60 transition-all flex items-center justify-center gap-2"
              >
                {executeLoading ? (
                  <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : <Zap className="w-5 h-5" />}
                执行并关闭工单
              </button>
              </div>
            </PermissionGate>
          )}

          {/* 赔付与库存联动日志 */}
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
              <HandCoins className="w-4 h-4 text-teal-600" />
              <h3 className="font-bold text-gray-900 text-sm">赔付与库存联动日志</h3>
            </div>
            {(ticket.compensationRecords?.length ?? 0) + (ticket.inventoryRecords?.length ?? 0) === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">暂无联动记录</div>
            ) : (
              <div className="space-y-2 text-xs">
                {ticket.compensationRecords?.map(c => (
                  <div key={c.id} className="p-2.5 rounded-lg bg-red-50 border border-red-100 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-red-700">
                        {String(c.type || c.direction || (c.amount && Number(c.amount) < 0 ? "供应商追偿" : "赔付客户"))}
                      </div>
                      <div className="text-gray-500 mt-0.5">{c.target || "-"} · {formatDate(c.createdAt, false)}</div>
                      {c.remark ? <div className="text-gray-400 mt-0.5 text-[11px]">备注：{c.remark}</div> : null}
                    </div>
                    <div className="font-mono font-bold text-red-700">{formatMoney(c.amount)}</div>
                  </div>
                ))}
                {ticket.inventoryRecords?.map(inv => (
                  <div key={inv.id} className="p-2.5 rounded-lg bg-blue-50 border border-blue-100 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-blue-700">{inv.reason}</div>
                      <div className="text-gray-500 mt-0.5 font-mono">{inv.sku} · {formatDate(inv.createdAt, false)}</div>
                    </div>
                    <div className={cn("font-mono font-bold", inv.qtyChange < 0 ? "text-red-600" : "text-green-600")}>
                      {inv.qtyChange > 0 ? "+" : ""}{inv.qtyChange}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 关联扫描记录 */}
          {ticket.category === "QC" && (
            <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
                <ShieldAlert className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-gray-900 text-sm">关联扫描记录</h3>
              </div>
              {!ticket.scanRecords || ticket.scanRecords.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">无关联扫描记录</div>
              ) : (
                <div className="space-y-2 text-xs">
                  {ticket.scanRecords?.map(s => (
                  <div key={s.id} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono font-semibold text-gray-800">批次：{s.batchNo}</span>
                      {s.locked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-bold animate-pulse">
                          <Ban className="w-3 h-3" /> LOCKED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 font-bold">
                          <CheckCircle2 className="w-3 h-3" /> 已解锁
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-gray-500">
                      <span>SKU：{s.skuCode} × {s.qty}</span>
                      {s.lockedUntil && <span>解锁时间：{formatDate(s.lockedUntil, false)}</span>}
                    </div>
                  </div>
                ))}
                </div>
              )}
            </div>
          )}

          {/* 金额汇总 */}
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-500">异常金额</span>
              <span className="font-mono font-bold text-xl text-teal-700">{formatMoney(ticket.abnormalAmount)}</span>
            </div>
            <Copy className="w-full h-px bg-gray-100 my-3" />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-400 mb-0.5">客户赔付</div>
                <div className="font-semibold text-gray-800">
                  {formatMoney(
                    (ticket.compensationRecords ?? []).filter(c => {
                      const key = String(c?.type || c?.direction || "");
                      return key.includes("CUSTOMER") || key.includes("赔付") || key.includes("PAY") || key.startsWith("PAY_TO");
                    }).reduce((s: number, c: any) => s + Number(c?.amount ?? 0), 0)
                  )}
                </div>
              </div>
              <div>
                <div className="text-gray-400 mb-0.5">供应商追偿</div>
                <div className="font-semibold text-gray-800">
                  {formatMoney(
                    (ticket.compensationRecords ?? []).filter(c => {
                      const key = String(c?.type || c?.direction || "");
                      return key.includes("VENDOR") || key.includes("追偿") || key.includes("RECOVER") || key.includes("SUPPLIER");
                    }).reduce((s: number, c: any) => s + Number(c?.amount ?? 0), 0)
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={approveOpen} onOpenChange={setApproveOpen}
        variant="success"
        title="确认审批通过？"
        description={`工单 ${ticket.ticketNo} 将进入下一环节（或执行阶段）`}
        confirmText="通过审批"
        requireNote
        noteLabel="审批意见（可选）"
        notePlaceholder="请输入审批意见..."
        onConfirm={handleApprove}
      />
      <ConfirmDialog
        open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setRejectSuggestion(""); }}
        variant="warning"
        title="确认驳回工单？"
        description="工单将退回给上报人，需其修改后重新提交。请务必填写修改建议。"
        confirmText="确认驳回"
        requireNote
        noteLabel="驳回原因 + 修改建议"
        notePlaceholder="请详细说明驳回原因及需要修改的内容..."
        onConfirm={(note) => handleReject(note)}
      >
        <div className="px-6 pb-2">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            给上报人的修改建议 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={rejectSuggestion}
            onChange={(e) => setRejectSuggestion(e.target.value)}
            rows={3}
            placeholder="例如：请补充破损照片、修正异常金额..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300 focus:border-yellow-400 resize-none"
          />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={escalateOpen} onOpenChange={setEscalateOpen}
        variant="danger"
        title="确认手动升级？"
        description="工单将升级至 L2 审批人处理，可能触发超时流程。"
        confirmText="确认升级"
        requireNote
        noteLabel="升级原因"
        notePlaceholder="请说明升级原因..."
        onConfirm={handleEscalate}
      />
    </div>
  );
}
