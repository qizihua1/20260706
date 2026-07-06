"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import {
  Settings2, Plus, Save, RefreshCw, Trash2, Loader2, DollarSign, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ThresholdRow {
  id: string;
  ruleCode: string;
  scope: "GLOBAL" | "BY_CATEGORY" | "BY_SEVERITY";
  applyCategory?: string | null;
  applySeverity?: string | null;
  amountMin: number;
  amountMax: number;
  approvalLevel: 1 | 2;
  timeoutMinutes: number;
  qcHoldTimeoutMinutes: number;
  enabled: boolean;
}

const DEFAULT_ROW: Omit<ThresholdRow, "id"> = {
  ruleCode: "",
  scope: "GLOBAL",
  applyCategory: null,
  applySeverity: null,
  amountMin: 0,
  amountMax: 9999999,
  approvalLevel: 1,
  timeoutMinutes: 1440,
  qcHoldTimeoutMinutes: 4320,
  enabled: true,
};

const SCOPES: ThresholdRow["scope"][] = ["GLOBAL", "BY_CATEGORY", "BY_SEVERITY"];
const CATEGORIES = ["LOGISTICS", "QC"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function Row({ row, onSave, onDelete, savingId }: {
  row: ThresholdRow;
  onSave: (r: ThresholdRow) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  savingId: string | null;
}) {
  const [local, setLocal] = useState(row);
  const dirty = JSON.stringify(local) !== JSON.stringify(row);
  const saving = savingId === row.id;
  return (
    <tr className={cn("transition-colors hover:bg-teal-50/30", dirty && "bg-amber-50/30")}>
      <td className="px-3 py-3">
        <input value={local.ruleCode} onChange={(e) => setLocal({ ...local, ruleCode: e.target.value })}
          className="w-full px-2 py-1 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          placeholder="TH-XXX" />
      </td>
      <td className="px-3 py-3">
        <select value={local.scope}
          onChange={(e) => setLocal({
            ...local,
            scope: e.target.value as any,
            applyCategory: e.target.value === "BY_CATEGORY" ? "LOGISTICS" : null,
            applySeverity: e.target.value === "BY_SEVERITY" ? "MEDIUM" : null,
          })}
          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          {SCOPES.map(s => (
            <option key={s} value={s}>
              {s === "GLOBAL" ? "全局 GLOBAL" : s === "BY_CATEGORY" ? "按类别" : "按严重度"}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3">
        {local.scope === "BY_CATEGORY" ? (
          <select value={local.applyCategory ?? ""}
            onChange={(e) => setLocal({ ...local, applyCategory: e.target.value })}
            className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        ) : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-3 py-3">
        {local.scope === "BY_SEVERITY" ? (
          <div>
            <SeverityBadge severity={local.applySeverity ?? "MEDIUM"} />
            <select value={local.applySeverity ?? ""}
              onChange={(e) => setLocal({ ...local, applySeverity: e.target.value })}
              className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
              {SEVERITIES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        ) : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5 text-gray-400" />
          <input type="number" min={0} value={local.amountMin}
            onChange={(e) => setLocal({ ...local, amountMin: Number(e.target.value) || 0 })}
            className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-gray-300">~</span>
          <input type="number" min={0} value={local.amountMax}
            onChange={(e) => setLocal({ ...local, amountMax: Number(e.target.value) || 0 })}
            className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        <select value={local.approvalLevel}
          onChange={(e) => setLocal({ ...local, approvalLevel: Number(e.target.value) as 1 | 2 })}
          className={cn("px-3 py-1 rounded-full text-sm font-bold border-2",
            local.approvalLevel === 1
              ? "bg-orange-50 text-orange-700 border-orange-200"
              : "bg-teal-50 text-teal-700 border-teal-200")}>
          <option value={1}>L1 审批</option>
          <option value={2}>L2 审批</option>
        </select>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <input type="number" min={1} value={local.timeoutMinutes}
            onChange={(e) => setLocal({ ...local, timeoutMinutes: Number(e.target.value) || 1 })}
            className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-xs text-gray-400">min</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">= {Math.floor(local.timeoutMinutes / 60)}h{local.timeoutMinutes % 60}m</div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <input type="number" min={1} value={local.qcHoldTimeoutMinutes}
            onChange={(e) => setLocal({ ...local, qcHoldTimeoutMinutes: Number(e.target.value) || 1 })}
            className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-xs text-gray-400">min</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">= {Math.floor(local.qcHoldTimeoutMinutes / 1440)}d品控暂扣</div>
      </td>
      <td className="px-3 py-3 text-center">
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={local.enabled}
            onChange={(e) => setLocal({ ...local, enabled: e.target.checked })}
            className="w-5 h-5 accent-green-600" />
        </label>
      </td>
      <td className="px-3 py-3 w-28">
        <div className="flex items-center gap-1">
          <button onClick={() => onSave(local)} disabled={!dirty || saving}
            className="px-3 py-1.5 rounded-md bg-gradient-to-r from-primary to-teal-500 text-white text-xs font-semibold hover:from-primaryDark hover:to-teal-600 disabled:opacity-40 flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            保存
          </button>
          {row.id !== "__new__" && (
            <button onClick={() => onDelete(row.id)}
              className="px-2 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function ApprovalThresholdsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ThresholdRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/approval-thresholds");
      const json = await res.json();
      if (json.ok) setRows(json.data ?? []);
      else toast.error(json.error ?? "加载失败");
    } catch (e: any) { toast.error(e.message ?? "加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (r: ThresholdRow) => {
    setSavingId(r.id);
    try {
      const res = await fetch("/api/settings/approval-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已保存");
        if (r.id === "__new__") setShowNew(false);
        load();
      } else { toast.error(json.error ?? "保存失败"); throw new Error(); }
    } finally { setSavingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该阈值？")) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/settings/approval-thresholds/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) { toast.success("已删除"); load(); }
      else toast.error(json.error ?? "删除失败");
    } catch (e: any) { toast.error(e.message ?? "删除失败"); }
    finally { setSavingId(null); }
  };

  const newRow: ThresholdRow = { ...DEFAULT_ROW, id: "__new__" };

  return (
    <div>
      <PageHeader
        title="审批分级阈值配置"
        subtitle="后台管理 · 按金额区间/类别/严重度设置 L1/L2 审批与超时"
        actions={
          <>
            <button onClick={load} disabled={loading}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> 刷新
            </button>
            <button onClick={() => setShowNew(!showNew)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> 新增阈值
            </button>
          </>
        }
      />

      <div className="bg-white rounded-xl border border-cyan-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-cyan-100">
              <tr>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">ruleCode</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">Scope</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">应用类别</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">严重度</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">金额区间 min-max</th>
                <th className="px-3 py-3 text-center font-semibold text-teal-700">审批层级</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">超时(min)</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700">品控暂扣超时(min)</th>
                <th className="px-3 py-3 text-center font-semibold text-teal-700 w-16">启用</th>
                <th className="px-3 py-3 text-left font-semibold text-teal-700 w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-3 py-3"><div className="h-5 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {!loading && showNew && (
                <Row row={newRow} onSave={handleSave} onDelete={() => { setShowNew(false); return Promise.resolve(); }} savingId={savingId} />
              )}
              {!loading && rows.map(r => (
                <Row key={r.id} row={r} onSave={handleSave} onDelete={handleDelete} savingId={savingId} />
              ))}
              {!loading && rows.length === 0 && !showNew && (
                <tr><td colSpan={10} className="px-4 py-16 text-center text-gray-400">
                  <Settings2 className="w-10 h-10 mx-auto mb-2 text-teal-300" />
                  暂无阈值配置，点击右上角「新增阈值」
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
