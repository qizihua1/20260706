"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import {
  ShieldCheck, Plus, Save, RefreshCw, Trash2, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QcRule {
  id: string;
  ruleCode: string;
  name: string;
  category: string;
  triggerConditions: Record<string, number | any>;
  severity: string;
  autoCreateTicket: boolean;
  defaultApprovalLevel: 1 | 2;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string;
}

const DEFAULT_RULE: Omit<QcRule, "id" | "createdAt"> = {
  ruleCode: "",
  name: "",
  category: "QTY_DIFF",
  triggerConditions: {},
  severity: "MEDIUM",
  autoCreateTicket: true,
  defaultApprovalLevel: 1,
  enabled: true,
  sortOrder: 100,
};

const CATEGORIES = ["QTY_DIFF", "SIZE_DEVIATION", "DAMAGE_LEVEL", "LABEL_MISSING", "EXPIRY_NEAR", "CUSTOM"];
const CONDITION_FIELDS: Record<string, { field: string; label: string; unit?: string; type: "number" | "boolean" }[]> = {
  QTY_DIFF: [{ field: "qtyDiffPercent", label: "数量偏差阈值", unit: "%", type: "number" }],
  SIZE_DEVIATION: [{ field: "maxDeviationMm", label: "最大尺寸偏差", unit: "mm", type: "number" }],
  DAMAGE_LEVEL: [{ field: "minDamageLevel", label: "最低破损等级", type: "number" }, { field: "minDamageItems", label: "最少破损件数", type: "number" }],
  LABEL_MISSING: [{ field: "labelIntactMustBeTrue", label: "标签不完整即触发", type: "boolean" }],
  EXPIRY_NEAR: [{ field: "daysBeforeExpiry", label: "多少天内到期", unit: "天", type: "number" }],
  CUSTOM: [{ field: "customThreshold", label: "自定义阈值", type: "number" }],
};

function RuleRow({ rule, onSave, onDelete, savingId }: {
  rule: QcRule;
  onSave: (r: QcRule) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  savingId: string | null;
}) {
  const [local, setLocal] = useState<QcRule>(rule);
  const [expanded, setExpanded] = useState(false);
  const dirty = JSON.stringify(local) !== JSON.stringify(rule);
  const saving = savingId === rule.id;

  const fields = CONDITION_FIELDS[local.category] ?? CONDITION_FIELDS.CUSTOM;

  const updateCondition = (k: string, v: any) => {
    setLocal({
      ...local,
      triggerConditions: { ...local.triggerConditions, [k]: v },
    });
  };

  return (
    <>
      <tr className={cn("transition-colors hover:bg-teal-50/30", dirty && "bg-amber-50/30")}>
        <td className="px-4 py-3">
          <input
            value={local.ruleCode}
            onChange={(e) => setLocal({ ...local, ruleCode: e.target.value })}
            className="w-full px-2 py-1 border border-gray-200 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="RULE_XXX"
          />
        </td>
        <td className="px-4 py-3">
          <input
            value={local.name}
            onChange={(e) => setLocal({ ...local, name: e.target.value })}
            className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="规则名称"
          />
        </td>
        <td className="px-4 py-3">
          <select
            value={local.category}
            onChange={(e) => setLocal({ ...local, category: e.target.value, triggerConditions: {} })}
            className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        <td className="px-4 py-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
          >
            {Object.keys(local.triggerConditions).length} 项条件
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </td>
        <td className="px-4 py-3">
          <SeverityBadge severity={local.severity} />
          <select
            value={local.severity}
            onChange={(e) => setLocal({ ...local, severity: e.target.value })}
            className="mt-1 w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
          </select>
        </td>
        <td className="px-4 py-3 text-center">
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={local.autoCreateTicket}
              onChange={(e) => setLocal({ ...local, autoCreateTicket: e.target.checked })}
              className="w-5 h-5 accent-green-600" />
          </label>
        </td>
        <td className="px-4 py-3 text-center">
          <select
            value={local.defaultApprovalLevel}
            onChange={(e) => setLocal({ ...local, defaultApprovalLevel: Number(e.target.value) as 1 | 2 })}
            className="px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value={1}>L1</option>
            <option value={2}>L2</option>
          </select>
        </td>
        <td className="px-4 py-3 text-center">
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={local.enabled}
              onChange={(e) => setLocal({ ...local, enabled: e.target.checked })}
              className="w-5 h-5 accent-primary" />
          </label>
        </td>
        <td className="px-4 py-3 w-24">
          <input type="number" value={local.sortOrder}
            onChange={(e) => setLocal({ ...local, sortOrder: Number(e.target.value) || 0 })}
            className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSave(local)}
              disabled={!dirty || saving}
              className="px-3 py-1.5 rounded-md bg-gradient-to-r from-primary to-teal-500 text-white text-xs font-semibold hover:from-primaryDark hover:to-teal-600 disabled:opacity-40 flex items-center gap-1"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              保存
            </button>
            <button
              onClick={() => onDelete(rule.id)}
              className="px-2 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gradient-to-r from-cyan-50/50 to-teal-50/50 border-b border-cyan-100">
          <td colSpan={10} className="px-6 py-4">
            <div className="text-xs font-semibold text-teal-800 mb-3">触发条件 (Trigger Conditions) 键值对编辑</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {fields.map(f => (
                <div key={f.field} className="p-3 rounded-lg bg-white border border-gray-200">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    <code className="bg-gray-100 px-1 rounded mr-1">{f.field}</code>
                    {f.label}
                  </label>
                  {f.type === "number" ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={(local.triggerConditions[f.field] as number) ?? 0}
                        onChange={(e) => updateCondition(f.field, Number(e.target.value) || 0)}
                        className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      {f.unit && <span className="text-xs text-gray-400 w-8">{f.unit}</span>}
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox"
                        checked={!!local.triggerConditions[f.field]}
                        onChange={(e) => updateCondition(f.field, e.target.checked)}
                        className="w-4 h-4 accent-primary" />
                      <span className="text-sm text-gray-600">启用</span>
                    </label>
                  )}
                </div>
              ))}
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 flex flex-col justify-center">
                <div className="text-xs font-semibold text-yellow-700 mb-1">JSON 预览</div>
                <pre className="text-[10px] font-mono text-yellow-800 bg-white/60 p-1.5 rounded overflow-auto max-h-16">
                  {JSON.stringify(local.triggerConditions, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function QcRulesPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<QcRule[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newRule, setNewRule] = useState<QcRule>({ ...DEFAULT_RULE, id: "__new__", ruleCode: "" });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/qc-rules");
      const json = await res.json();
      if (json.ok) setRules(json.data ?? []);
      else toast.error(json.error ?? "加载失败");
    } catch (e: any) { toast.error(e.message ?? "加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleSave = async (r: QcRule) => {
    setSavingId(r.id);
    try {
      const res = await fetch("/api/qc-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("已保存");
        if (r.id === "__new__") { setShowNew(false); setNewRule({ ...DEFAULT_RULE, id: "__new__", ruleCode: "" }); }
        load();
      } else { toast.error(json.error ?? "保存失败"); throw new Error(); }
    } finally { setSavingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该品控规则？")) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/qc-rules/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) { toast.success("已删除"); load(); }
      else toast.error(json.error ?? "删除失败");
    } catch (e: any) { toast.error(e.message ?? "删除失败"); }
    finally { setSavingId(null); }
  };

  return (
    <div>
      <PageHeader
        title="品控规则配置"
        subtitle="模块零 · QC 规则增删改查，触发条件阈值实时编辑"
        actions={
          <>
            <button onClick={load} disabled={loading} className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> 刷新
            </button>
            <button onClick={() => setShowNew(!showNew)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> 新增规则
            </button>
          </>
        }
      />

      <div className="bg-white rounded-xl border border-cyan-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-cyan-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-teal-700">ruleCode</th>
                <th className="px-4 py-3 text-left font-semibold text-teal-700">规则名称</th>
                <th className="px-4 py-3 text-left font-semibold text-teal-700">类别</th>
                <th className="px-4 py-3 text-left font-semibold text-teal-700">触发条件</th>
                <th className="px-4 py-3 text-left font-semibold text-teal-700">严重度</th>
                <th className="px-4 py-3 text-center font-semibold text-teal-700">自动开单</th>
                <th className="px-4 py-3 text-center font-semibold text-teal-700">审批级</th>
                <th className="px-4 py-3 text-center font-semibold text-teal-700 w-16">启用</th>
                <th className="px-4 py-3 text-right font-semibold text-teal-700 w-24">排序</th>
                <th className="px-4 py-3 text-left font-semibold text-teal-700 w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-5 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {!loading && showNew && (
                <RuleRow
                  rule={newRule}
                  onSave={(r) => {
                    setNewRule(r);
                    return handleSave(r);
                  }}
                  onDelete={() => { setShowNew(false); return Promise.resolve(); }}
                  savingId={savingId}
                />
              )}
              {!loading && rules.map(r => (
                <RuleRow key={r.id} rule={r} onSave={handleSave} onDelete={handleDelete} savingId={savingId} />
              ))}
              {!loading && rules.length === 0 && !showNew && (
                <tr><td colSpan={10} className="px-4 py-16 text-center text-gray-400">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-teal-300" />
                  暂无品控规则，点击右上角「新增规则」
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
