"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PermissionGate } from "@/components/ui/PermissionGate";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Package,
  ShieldAlert,
  Unlock,
  Loader2,
  RefreshCw,
  CalendarDays,
  Ruler,
  Tag,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, cn } from "@/lib/utils";

interface ScanResult {
  scanRecordId: string;
  passed: boolean;
  duplicate: boolean;
  qcRuleHitDetail?: {
    ruleCode: string;
    ruleName: string;
    triggerConditions: { field: string; actual: any; threshold: any; op: string }[];
    basis: string;
    severity: string;
  } | null;
  autoCreatedTicketNo?: string | null;
  autoCreatedTicketId?: string | null;
  batchLocked?: boolean;
  summary: string;
  data: any;
}

export default function ScanPage() {
  const [form, setForm] = useState({
    externalCode: "",
    skuCode: "",
    batchNo: "",
    quantity: 1,
    labelIntact: true,
    damageLevel: 0,
    sizeDeviationMm: 0,
    expiryDate: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [quickReleaseOpen, setQuickReleaseOpen] = useState(false);
  const [quickReleaseLoading, setQuickReleaseLoading] = useState(false);

  const handleScan = async () => {
    if (!form.externalCode.trim()) {
      toast.error("请输入运单号");
      return;
    }
    if (!form.skuCode.trim()) {
      toast.error("请输入 SKU 编号");
      return;
    }
    if (!form.batchNo.trim()) {
      toast.error("请输入批次号");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/scan/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.ok) {
        setResult(json.data);
        if (json.data.duplicate) {
          toast.warning("该批次已存在未关闭品控工单");
        } else if (json.data.passed) {
          toast.success("品控通过");
        } else {
          toast.error(`品控暂扣：${json.data.qcRuleHitDetail?.ruleName ?? "命中规则"}`);
        }
      } else {
        toast.error(json.error ?? "扫描失败");
      }
    } catch (e: any) {
      toast.error(e.message ?? "扫描失败");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRelease = async (note?: string) => {
    if (!result) return;
    setQuickReleaseLoading(true);
    try {
      const res = await fetch(`/api/scan/${result.scanRecordId}/quick-release`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已放行，工单已关闭");
        setResult({ ...result, passed: true, summary: "已通过主管快速放行" });
      } else {
        toast.error(json.error ?? "放行失败");
        throw new Error(json.error ?? "放行失败");
      }
    } finally {
      setQuickReleaseLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="扫描品控"
        subtitle="扫描枪模拟录入 · 品控规则实时判定"
        actions={
          <button
            onClick={() => {
              setForm({
                externalCode: "",
                skuCode: "",
                batchNo: "",
                quantity: 1,
                labelIntact: true,
                damageLevel: 0,
                sizeDeviationMm: 0,
                expiryDate: "",
              });
              setResult(null);
            }}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            重置表单
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200 flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">扫描录入</h3>
              <p className="text-xs text-gray-500">请扫描或输入相关信息</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                运单号 (externalCode)
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <div className="relative">
                <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={form.externalCode}
                  onChange={(e) => setForm({ ...form, externalCode: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder="如：SF123456789"
                  className="w-full pl-10 pr-4 py-2.5 border-2 border-cyan-100 rounded-lg text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-gray-50 focus:bg-white transition-colors"
                  autoFocus
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  SKU 编号
                  <span className="text-red-500 ml-0.5">*</span>
                </label>
                <div className="relative">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={form.skuCode}
                    onChange={(e) => setForm({ ...form, skuCode: e.target.value })}
                    placeholder="SKU-XXX"
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  批次号
                  <span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  value={form.batchNo}
                  onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
                  placeholder="BATCH-2026..."
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                扫描数量
              </label>
              <input
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5 mb-3 text-sm font-semibold text-gray-700">
                <Info className="w-4 h-4 text-teal-600" />
                额外品控信息
              </div>
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-gray-800">标签是否完整</div>
                    <div className="text-xs text-gray-500">外箱标签、运单标签完整度</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.labelIntact}
                      onChange={(e) => setForm({ ...form, labelIntact: e.target.checked })}
                      className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {form.labelIntact ? "完整" : "不完整"}
                    </span>
                  </div>
                </label>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700">破损等级 (0-5)</label>
                    <span className="text-sm font-bold text-orange-600">{form.damageLevel}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    value={form.damageLevel}
                    onChange={(e) => setForm({ ...form, damageLevel: parseInt(e.target.value) })}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>0 完好</span>
                    <span>3 中度</span>
                    <span>5 严重</span>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                    <Ruler className="w-4 h-4 text-gray-400" /> 尺寸偏差 (mm)
                  </label>
                  <input
                    type="number"
                    value={form.sizeDeviationMm}
                    onChange={(e) => setForm({ ...form, sizeDeviationMm: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                    <CalendarDays className="w-4 h-4 text-gray-400" /> 效期日期
                  </label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleScan}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-teal-500 hover:from-primaryDark hover:to-teal-600 text-white font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-lg"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ScanLine className="w-5 h-5" />
              )}
              {loading ? "扫描判定中..." : "开始扫描"}
            </button>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6 min-h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">判定结果</h3>
                  <p className="text-xs text-gray-500">品控规则引擎实时判定</p>
                </div>
              </div>
              {result && (
                <span className="text-xs text-gray-400">
                  扫描ID：{result.scanRecordId?.slice(0, 12)}...
                </span>
              )}
            </div>

            {result?.duplicate && (
              <div className="mb-5 p-4 rounded-xl bg-orange-50 border border-orange-200 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-bold text-orange-800">重复扫描提示</div>
                  <div className="text-sm text-orange-700 mt-0.5">
                    该批次已存在未关闭品控工单，请在工单管理中查看详情
                  </div>
                </div>
              </div>
            )}

            {!loading && !result && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200 flex items-center justify-center mb-4">
                  <ScanLine className="w-12 h-12 text-teal-300" />
                </div>
                <h4 className="text-lg font-semibold text-gray-700 mb-1">等待扫描</h4>
                <p className="text-sm text-gray-400 max-w-sm">
                  请在左侧录入运单号、SKU 与批次信息，点击「开始扫描」进行品控判定
                </p>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full border-4 border-cyan-100" />
                  <Loader2 className="w-24 h-24 text-primary absolute inset-0 animate-spin p-4" />
                </div>
                <p className="mt-6 text-lg font-semibold text-gray-700">品控引擎判定中...</p>
                <p className="mt-1 text-sm text-gray-400">正在匹配 {20}+ 条品控规则</p>
              </div>
            )}

            {!loading && result && result.passed && (
              <div className="space-y-4">
                <div className="p-8 rounded-2xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 text-center">
                  <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-200 mb-4">
                    <CheckCircle2 className="w-12 h-12 text-white" />
                  </div>
                  <h4 className="text-2xl font-bold text-green-700">品控通过</h4>
                  <p className="text-green-600 mt-2">{result.summary ?? "所有规则校验通过"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-1">运单号</div>
                    <div className="text-sm font-mono font-bold text-gray-800">{form.externalCode}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-1">批次号</div>
                    <div className="text-sm font-mono font-bold text-gray-800">{form.batchNo}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-1">扫描数量</div>
                    <div className="text-sm font-bold text-gray-800">{form.quantity} 件</div>
                  </div>
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-1">判定时间</div>
                    <div className="text-sm font-bold text-gray-800">{formatDate(new Date())}</div>
                  </div>
                </div>
              </div>
            )}

            {!loading && result && !result.passed && (
              <div className="space-y-4">
                <div className="p-6 rounded-2xl bg-gradient-to-br from-red-50 to-rose-50 border border-red-200 relative overflow-hidden">
                  {result.batchLocked && (
                    <div className="absolute top-3 right-3 px-3 py-1 rounded-full bg-red-600 text-white text-xs font-bold shadow-lg flex items-center gap-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3" /> 该批次已锁定
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    <div className="w-20 h-20 shrink-0 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center shadow-lg shadow-red-200">
                      <XCircle className="w-12 h-12 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-2xl font-bold text-red-700">品控暂扣</h4>
                      <p className="text-red-600 mt-1">{result.summary}</p>
                      {result.autoCreatedTicketNo && (
                        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-red-200 shadow-sm">
                          <span className="text-xs text-gray-500">自动创建工单：</span>
                          <Link
                            href={`/tickets/${result.autoCreatedTicketId}`}
                            className="text-sm font-bold text-red-700 hover:text-red-800 hover:underline"
                          >
                            {result.autoCreatedTicketNo} →
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {result.qcRuleHitDetail && (
                  <div className="p-5 rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-orange-600" />
                        <span className="font-bold text-orange-800">命中规则详情</span>
                      </div>
                      <SeverityBadge severity={result.qcRuleHitDetail.severity} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <div className="p-3 rounded-lg bg-white border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">规则编号</div>
                        <div className="font-mono text-sm font-bold text-gray-800">
                          {result.qcRuleHitDetail.ruleCode}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-white border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">规则名称</div>
                        <div className="text-sm font-bold text-gray-800">
                          {result.qcRuleHitDetail.ruleName}
                        </div>
                      </div>
                    </div>
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-gray-600 mb-2">触发条件明细</div>
                      <div className="space-y-2">
                        {result.qcRuleHitDetail.triggerConditions?.map((c, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-orange-100 text-sm"
                          >
                            <span className="text-gray-600">
                              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
                                {c.field}
                              </code>
                              <span className="mx-2 text-gray-400">{c.op}</span>
                              <span className="font-mono text-red-600 font-bold">{String(c.actual)}</span>
                            </span>
                            <span className="text-xs text-gray-400">
                              阈值：<b className="text-gray-600">{String(c.threshold)}</b>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-white border border-gray-100">
                      <div className="text-xs font-semibold text-gray-600 mb-1">判定依据</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {result.qcRuleHitDetail.basis}
                      </div>
                    </div>
                  </div>
                )}

                <PermissionGate requireQcSupervisor requireRoles={["ADMIN" as any]}>
                  <div className="p-4 rounded-xl bg-gradient-to-r from-purple-50 to-fuchsia-50 border border-purple-200">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Unlock className="w-4 h-4 text-purple-600" />
                          <span className="font-bold text-purple-800">主管操作：误判快速放行</span>
                        </div>
                        <p className="text-xs text-purple-600">
                          确认品控规则误判？点击快速放行将自动关闭工单并解锁批次
                        </p>
                      </div>
                      <button
                        onClick={() => setQuickReleaseOpen(true)}
                        className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 text-white text-sm font-semibold shadow-sm transition-all flex items-center gap-1.5"
                      >
                        <Unlock className="w-4 h-4" />
                        快速放行
                      </button>
                    </div>
                  </div>
                </PermissionGate>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={quickReleaseOpen}
        onOpenChange={setQuickReleaseOpen}
        variant="warning"
        title="确认快速放行？"
        description="此操作将关闭关联工单并解锁该批次。请填写放行原因以便后续追溯。"
        confirmText="确认放行"
        requireNote
        noteLabel="复核原因"
        notePlaceholder="请说明放行原因，如：人工复核后确认无异常..."
        onConfirm={handleQuickRelease}
      />
      {quickReleaseLoading && null}
    </div>
  );
}
