"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import {
  FileWarning,
  PackageSearch,
  PackageOpen,
  Truck,
  AlertTriangle,
  Ban,
  Clock,
  MapPin,
  ImagePlus,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  DollarSign,
  User,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney, cn } from "@/lib/utils";

const SUB_TYPES = [
  { key: "丢失", label: "丢件", icon: PackageOpen, color: "text-red-600 bg-red-50 border-red-200 hover:border-red-300" },
  { key: "破损", label: "破损", icon: PackageSearch, color: "text-orange-600 bg-orange-50 border-orange-200 hover:border-orange-300" },
  { key: "拒收", label: "拒收", icon: Ban, color: "text-yellow-600 bg-yellow-50 border-yellow-200 hover:border-yellow-300" },
  { key: "超时未签收", label: "超时未签收", icon: Clock, color: "text-purple-600 bg-purple-50 border-purple-200 hover:border-purple-300" },
  { key: "地址错误", label: "地址错误", icon: MapPin, color: "text-blue-600 bg-blue-50 border-blue-200 hover:border-blue-300" },
];

interface WaybillData {
  externalCode: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  totalAmount?: number;
  items?: { name: string; sku: string; qty: number; price: number }[];
  syncedAt?: string;
}

export default function ReportPage() {
  const router = useRouter();
  const [externalCode, setExternalCode] = useState("");
  const [blurUsed, setBlurUsed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [waybill, setWaybill] = useState<WaybillData | null>(null);
  const [waybillError, setWaybillError] = useState<string | null>(null);

  const [form, setForm] = useState({
    category: "LOGISTICS",
    subType: "丢失",
    severity: "MEDIUM",
    description: "",
    evidenceUrls: ["", "", "", "", ""],
    abnormalAmount: 0 as number | "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [conflictTicket, setConflictTicket] = useState<{ id: string; ticketNo: string } | null>(null);

  const handleSyncWaybill = async (code?: string) => {
    const targetCode = (code ?? externalCode).trim();
    if (!targetCode) return;
    setBlurUsed(true);
    setSyncing(true);
    setWaybillError(null);
    setWaybill(null);
    try {
      const res = await fetch("/api/sync/waybill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalCode: targetCode }),
      });
      const json = await res.json();
      if (json.ok) {
        setWaybill(json.data);
        if (json.data?.totalAmount && !form.abnormalAmount) {
          setForm({ ...form, abnormalAmount: json.data.totalAmount });
        }
        toast.success("运单信息已同步");
      } else {
        setWaybillError(json.error ?? "运单不存在或无法同步");
        toast.error(json.error ?? "运单同步失败");
      }
    } catch (e: any) {
      setWaybillError(e.message ?? "网络错误");
      toast.error(e.message ?? "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async () => {
    if (!externalCode.trim()) {
      toast.error("请填写运单号");
      return;
    }
    if (!blurUsed || !waybill) {
      toast.error("请先同步运单信息（失焦运单号自动触发）");
      return;
    }
    if (!form.subType) {
      toast.error("请选择异常子类型");
      return;
    }
    if (!form.description.trim()) {
      toast.error("请填写异常描述");
      return;
    }
    const urls = form.evidenceUrls.filter((u) => u.trim());
    if (urls.length > 5) {
      toast.error("图片证据最多 5 张");
      return;
    }
    setSubmitting(true);
    setConflictTicket(null);
    try {
      const res = await fetch("/api/tickets/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalCode: externalCode.trim(),
          category: form.category,
          subType: form.subType,
          severity: form.severity,
          description: form.description.trim(),
          evidenceUrls: urls,
          abnormalAmount: Number(form.abnormalAmount) || 0,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("工单已提交，进入审批流程");
        router.push(`/tickets/${json.data.id}`);
      } else if (res.status === 409 || json.code === "CONFLICT") {
        toast.warning(json.error ?? "该运单已有进行中工单");
        setConflictTicket(json.data);
      } else {
        toast.error(json.error ?? "提交失败");
      }
    } catch (e: any) {
      toast.error(e.message ?? "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="异常工单上报"
        subtitle="模块一 · 物流异常录入，自动拉取运单信息"
        icon={<FileWarning className="w-6 h-6" />}
        actions={
          <Link
            href="/tickets"
            className="px-4 py-2 rounded-lg border border-cyan-100 bg-white text-sm font-medium text-teal-600 hover:bg-teal-50 flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            查看所有工单
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200 flex items-center justify-center">
                <Truck className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">运单信息</h3>
                <p className="text-xs text-gray-500">输入运单号后自动从 V2 拉取详情</p>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                运单号 (externalCode)
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <PackageSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={externalCode}
                    onChange={(e) => {
                      setExternalCode(e.target.value);
                      if (blurUsed) setWaybill(null);
                    }}
                    onBlur={() => !syncing && externalCode.trim() && !waybill && handleSyncWaybill()}
                    placeholder="输入运单号，失焦自动查询"
                    className={cn(
                      "w-full pl-10 pr-4 py-2.5 border-2 rounded-lg text-sm focus:outline-none focus:ring-2 transition-colors",
                      waybillError
                        ? "border-red-300 bg-red-50/50 focus:ring-red-200 focus:border-red-400"
                        : waybill
                        ? "border-green-300 bg-green-50/30 focus:ring-green-200 focus:border-green-400"
                        : "border-cyan-100 bg-gray-50 focus:bg-white focus:ring-primary/30 focus:border-primary"
                    )}
                  />
                </div>
                <button
                  onClick={() => handleSyncWaybill()}
                  disabled={syncing || !externalCode.trim()}
                  className="px-4 rounded-lg border border-cyan-200 bg-gradient-to-br from-cyan-50 to-teal-50 text-teal-700 text-sm font-semibold hover:from-cyan-100 hover:to-teal-100 disabled:opacity-50 flex items-center gap-2"
                >
                  {syncing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  同步
                </button>
              </div>
              {waybillError && (
                <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  {waybillError}
                </div>
              )}
              {waybill && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  运单已同步，更新于 {waybill.syncedAt ?? "刚刚"}
                </div>
              )}
            </div>

            {waybill && (
              <div className="p-5 rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-green-200/50">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-800">
                    ✅ 实时获取自 V2 · 更新于 {waybill.syncedAt ?? "刚刚"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="p-3 rounded-lg bg-white/80 border border-green-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                      <User className="w-3.5 h-3.5" /> 收件人
                    </div>
                    <div className="text-sm font-semibold text-gray-800">
                      {waybill.receiverName ?? "-"}
                      {waybill.receiverPhone && (
                        <span className="text-gray-500 font-normal ml-2">
                          {waybill.receiverPhone}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/80 border border-green-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                      <DollarSign className="w-3.5 h-3.5" /> 运单总金额
                    </div>
                    <div className="text-lg font-bold text-teal-700">
                      {formatMoney(waybill.totalAmount ?? 0)}
                    </div>
                  </div>
                  <div className="sm:col-span-2 p-3 rounded-lg bg-white/80 border border-green-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                      <MapPin className="w-3.5 h-3.5" /> 收件地址
                    </div>
                    <div className="text-sm text-gray-700">
                      {waybill.receiverAddress ?? "-"}
                    </div>
                  </div>
                </div>
                {waybill.items && waybill.items.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">物品清单</div>
                    <div className="overflow-hidden rounded-lg border border-green-100">
                      <table className="w-full text-sm">
                        <thead className="bg-green-100/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-green-800">商品</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-green-800">SKU</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-green-800">数量</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-green-800">单价</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-green-100 bg-white/60">
                          {waybill.items.map((it, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 text-gray-700">{it.name}</td>
                              <td className="px-3 py-2 font-mono text-xs text-gray-600">{it.sku}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{it.qty}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{formatMoney(it.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">异常信息</h3>
                <p className="text-xs text-gray-500">类别、子类型、严重度、描述</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  异常类别
                </label>
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-50 border border-teal-200">
                  <Truck className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-semibold text-teal-700">物流异常 (LOGISTICS)</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  严重度
                </label>
                <select
                  value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="LOW">低 (LOW)</option>
                  <option value="MEDIUM">中 (MEDIUM)</option>
                  <option value="HIGH">高 (HIGH)</option>
                  <option value="CRITICAL">严重 (CRITICAL)</option>
                </select>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                异常子类型
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {SUB_TYPES.map((s) => {
                  const Icon = s.icon;
                  const active = form.subType === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setForm({ ...form, subType: s.key })}
                      className={cn(
                        "p-3 rounded-xl border transition-all text-left",
                        active
                          ? `${s.color} ring-2 ring-offset-1 shadow-sm`
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      <Icon className={cn("w-5 h-5 mb-1.5", active ? "" : "text-gray-400")} />
                      <div className={cn("text-sm font-semibold", active ? "" : "text-gray-700")}>
                        {s.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                异常描述
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                placeholder="请详细描述异常发生的情况，包括时间、地点、现场情况等..."
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
              <div className="text-right text-xs text-gray-400 mt-1">
                {form.description.length} / 1000
              </div>
            </div>

            <div className="mb-5">
              <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-2">
                <ImagePlus className="w-4 h-4 text-gray-400" /> 图片证据 URL
                <span className="text-xs font-normal text-gray-400">（最多 5 条）</span>
              </label>
              <div className="space-y-2">
                {form.evidenceUrls.map((url, i) => (
                  <input
                    key={i}
                    type="url"
                    value={url}
                    onChange={(e) => {
                      const arr = [...form.evidenceUrls];
                      arr[i] = e.target.value;
                      setForm({ ...form, evidenceUrls: arr });
                    }}
                    placeholder={`图片链接 #${i + 1}${i === 0 ? " (推荐)" : " (可选)"}`}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-1.5">
                <DollarSign className="w-4 h-4 text-gray-400" /> 异常金额 (元)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">¥</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.abnormalAmount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      abnormalAmount: e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                  placeholder="默认取运单总金额，可修改"
                  className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-mono text-lg"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pb-6">
            {conflictTicket && (
              <Link
                href={`/tickets/${conflictTicket.id}`}
                className="px-6 py-3 rounded-xl border-2 border-orange-300 bg-orange-50 text-orange-700 font-bold shadow-sm hover:bg-orange-100 transition-colors flex items-center gap-2"
              >
                <AlertTriangle className="w-5 h-5" />
                查看已有工单 {conflictTicket.ticketNo} →
              </Link>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-primary to-teal-500 hover:from-primaryDark hover:to-teal-600 text-white font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-60 flex items-center gap-2 text-lg"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              {submitting ? "提交中..." : "提交上报"}
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6 sticky top-24">
            <div className="flex items-center gap-2 mb-5 pb-4 border-b border-gray-100">
              <FileWarning className="w-5 h-5 text-teal-600" />
              <h3 className="font-bold text-gray-900">上报预览</h3>
            </div>
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">运单号</span>
                <span className="font-mono font-bold text-gray-800">
                  {externalCode || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">类别</span>
                <span className="font-semibold text-teal-700">{form.category}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">子类型</span>
                <span className="font-semibold text-gray-800">{form.subType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">严重度</span>
                <SeverityBadge severity={form.severity} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">证据数</span>
                <span className="font-semibold text-gray-800">
                  {form.evidenceUrls.filter((u) => u.trim()).length} / 5
                </span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-gray-600 font-medium">异常金额</span>
                <span className="text-xl font-bold text-teal-700">
                  {formatMoney(Number(form.abnormalAmount) || 0)}
                </span>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200">
              <div className="text-xs font-semibold text-teal-800 mb-2">📋 上报流程</div>
              <ol className="space-y-1.5 text-xs text-teal-700">
                <li>1. 提交后自动创建工单，状态 PENDING_REVIEW</li>
                <li>2. 规则引擎自动判定 L1/L2 审批等级</li>
                <li>3. 审批通过进入执行赔付</li>
                <li>4. 执行完成自动联动 V2 系统与库存</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
