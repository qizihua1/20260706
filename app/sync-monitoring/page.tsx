"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import {
  Activity, Server, Clock, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Zap, Copy, Check, Loader2, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, cn } from "@/lib/utils";

const ERROR_CATS = ["NETWORK_TIMEOUT", "AUTH", "NOT_FOUND", "BAD_PARAM", "V2_SERVER_ERROR", "UNKNOWN"] as const;
const CAT_COLORS: Record<string, string> = {
  NETWORK_TIMEOUT: "bg-gradient-to-br from-orange-400 to-red-500",
  AUTH: "bg-gradient-to-br from-red-500 to-pink-600",
  NOT_FOUND: "bg-gradient-to-br from-blue-400 to-indigo-500",
  BAD_PARAM: "bg-gradient-to-br from-yellow-400 to-amber-500",
  V2_SERVER_ERROR: "bg-gradient-to-br from-purple-500 to-fuchsia-600",
  UNKNOWN: "bg-gradient-to-br from-gray-400 to-slate-500",
};
const CAT_LABELS: Record<string, string> = {
  NETWORK_TIMEOUT: "网络超时",
  AUTH: "鉴权失败",
  NOT_FOUND: "资源不存在",
  BAD_PARAM: "参数错误",
  V2_SERVER_ERROR: "V2 服务端错误",
  UNKNOWN: "未知错误",
};

interface SyncStatusData {
  lastCallAt?: string;
  successRate24h: number;
  callCount24h: number;
  v2Reachable: boolean;
  errorBreakdown: { category: string; count: number }[];
  recentLogs: SyncLog[];
}

interface SyncLog {
  id: string;
  interfaceName: string;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  statusCode: number;
  durationMs: number;
  errorCategory?: string | null;
  errorMessage?: string | null;
  requestId: string;
  createdAt: string;
}

function Ring({ value, size = 80 }: { value: number; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, value)) / 100);
  const ok = value >= 95;
  const warn = value >= 80 && value < 95;
  const color = ok ? "#22c55e" : warn ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-lg font-bold" style={{ color }}>{value.toFixed(1)}%</div>
      </div>
    </div>
  );
}

export default function SyncMonitoringPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SyncStatusData | null>(null);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ escalated: number; closed: number; reassigned: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sync/status");
      const json = await res.json();
      if (json.ok) setData(json.data);
      else toast.error(json.error ?? "加载失败");
    } catch (e: any) { toast.error(e.message ?? "加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const handleTrigger = async () => {
    setTriggerLoading(true);
    setTriggerResult(null);
    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        setTriggerResult(json.data);
        toast.success(`巡检完成：升级${json.data.escalated} 关闭${json.data.closed} 改派${json.data.reassigned}`);
        load();
      } else { toast.error(json.error ?? "触发失败"); }
    } catch (e: any) { toast.error(e.message ?? "触发失败"); }
    finally { setTriggerLoading(false); }
  };

  const handleCopy = (val: string) => {
    navigator.clipboard?.writeText(val).then(() => {
      setCopied(val);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const maxErr = Math.max(1, ...(data?.errorBreakdown ?? []).map(e => e.count));
  const totalCalls = data?.callCount24h ?? 0;

  return (
    <div>
      <PageHeader
        title="跨系统同步监控"
        subtitle="模块五 · V2 接口健康度、日志、巡检与改派"
        actions={
          <>
            <button onClick={load} disabled={loading}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> 刷新
            </button>
            <button onClick={handleTrigger} disabled={triggerLoading}
              className="btn-primary flex items-center gap-2">
              <Zap className={cn("w-4 h-4", triggerLoading && "animate-spin")} />
              {triggerLoading ? "巡检中..." : "手动触发超时巡检+改派"}
            </button>
          </>
        }
      />

      {triggerResult && (
        <div className="mb-5 p-4 rounded-xl bg-gradient-to-r from-purple-50 to-fuchsia-50 border border-purple-200 flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-purple-600" />
              <span className="font-bold text-purple-900">超时巡检执行完成</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="p-2.5 rounded-lg bg-white/70 border border-purple-100 text-center">
                <div className="text-xs text-gray-500">升级</div>
                <div className="font-bold text-red-600 text-lg">{triggerResult.escalated}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-white/70 border border-purple-100 text-center">
                <div className="text-xs text-gray-500">关闭</div>
                <div className="font-bold text-green-600 text-lg">{triggerResult.closed}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-white/70 border border-purple-100 text-center">
                <div className="text-xs text-gray-500">改派</div>
                <div className="font-bold text-teal-600 text-lg">{triggerResult.reassigned}</div>
              </div>
            </div>
          </div>
          <button onClick={() => setTriggerResult(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
        </div>
      )}

      {/* 顶部大卡 + 4 StatCard */}
      <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6 mb-5">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-200">
            <Server className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-gray-900">V2 跨系统接口健康度</h3>
            <p className="text-sm text-gray-500">最近 24 小时统计 · 每 30 秒自动刷新</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 探测中
              </span>
            ) : data?.v2Reachable ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                V2 可达
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                V2 不可达
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="最近一次调用"
            value={data?.lastCallAt ? formatDate(data.lastCallAt).slice(5) : "-"}
            subtitle={data?.lastCallAt ? `${formatDate(data.lastCallAt).slice(0, 10)}` : "暂无调用记录"}
            icon={<Clock className="w-4 h-4" />}
            accent="primary"
          />
          <StatCard
            title="24h 成功率"
            value={
              <div className="flex items-center gap-3">
                <Ring value={data?.successRate24h ?? 0} size={52} />
                <span className="text-lg font-bold">{(data?.successRate24h ?? 0).toFixed(1)}%</span>
              </div>
            }
            subtitle={`失败 ${totalCalls - Math.round((data?.successRate24h ?? 0) / 100 * totalCalls)} 次`}
            accent="green"
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
          <StatCard
            title="调用总次数(24h)"
            value={totalCalls}
            subtitle="所有接口总和"
            accent="purple"
            icon={<Activity className="w-4 h-4" />}
          />
          <StatCard
            title="V2 可达状态"
            value={
              <span className={cn(
                "text-xl font-bold",
                data?.v2Reachable ? "text-green-600" : "text-red-600"
              )}>
                {loading ? "..." : data?.v2Reachable ? "正常" : "异常"}
              </span>
            }
            subtitle={data?.v2Reachable ? "接口响应正常" : "检查 V2 服务/网络"}
            accent={data?.v2Reachable ? "green" : "red"}
            icon={data?.v2Reachable ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* 左：错误分类统计 */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-cyan-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              错误类别分布
            </h3>
            <span className="text-xs text-gray-400">6 类错误</span>
          </div>
          {loading ? (
            <div className="space-y-3">
              {ERROR_CATS.map(c => (
                <div key={c} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {ERROR_CATS.map(cat => {
                const item = data?.errorBreakdown?.find(e => e.category === cat);
                const count = item?.count ?? 0;
                const pct = totalCalls > 0 ? (count / totalCalls) * 100 : 0;
                const barW = (count / maxErr) * 100;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("w-3 h-3 rounded shrink-0", CAT_COLORS[cat])} />
                        <span className="font-medium text-gray-700 truncate">{CAT_LABELS[cat]}</span>
                        <span className="text-xs text-gray-400 font-mono">{cat}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-bold text-gray-900">{count}</span>
                        <span className="text-xs text-gray-400 w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-4 bg-gray-100 rounded-full overflow-hidden relative">
                      <div
                        className={cn("h-full rounded-full shadow-sm", CAT_COLORS[cat])}
                        style={{ width: `${barW}%`, transition: "width 0.8s" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 饼图替代展示 */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-500 mb-3">占比可视化</div>
            <div className="flex h-8 rounded-lg overflow-hidden shadow-sm">
              {ERROR_CATS.map(cat => {
                const count = data?.errorBreakdown?.find(e => e.category === cat)?.count ?? 0;
                const w = totalCalls > 0 ? (count / totalCalls) * 100 : 0;
                if (w <= 0) return null;
                return (
                  <div
                    key={cat}
                    title={`${CAT_LABELS[cat]}: ${count}`}
                    className={CAT_COLORS[cat]}
                    style={{ width: `${w}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {ERROR_CATS.map(cat => (
                <span key={cat} className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                  <span className={cn("w-2 h-2 rounded", CAT_COLORS[cat])} />
                  {CAT_LABELS[cat]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 右：最近 20 条日志 */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-cyan-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-500" />
              最近 20 条接口日志
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
              {data?.recentLogs?.length ?? 0} 条
            </span>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-gray-100 max-h-[560px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-teal-700 whitespace-nowrap">接口名</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-teal-700">方法</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-teal-700">状态</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold text-teal-700 whitespace-nowrap">耗时</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-teal-700">错误分类</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold text-teal-700 whitespace-nowrap">RequestId</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-teal-700 whitespace-nowrap">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(data?.recentLogs ?? []).map(log => {
                    const isErr = !!log.errorCategory || (log.statusCode >= 400);
                    return (
                      <tr key={log.id} className={cn("hover:bg-teal-50/30 transition-colors", isErr && "bg-red-50/30")}>
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-xs font-semibold text-gray-800 truncate max-w-[140px]">
                            {log.interfaceName}
                          </div>
                          {log.errorMessage && (
                            <div className="mt-0.5 group relative inline-block max-w-full">
                              <span className="text-[10px] text-red-600 truncate block max-w-[180px]">
                                ⚠️ {log.errorMessage}
                              </span>
                              <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:block p-2 rounded-lg bg-gray-900 text-white text-[10px] whitespace-pre-wrap shadow-lg max-w-xs break-words">
                                {log.errorMessage}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={cn(
                            "inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono",
                            log.method === "GET" && "bg-green-50 text-green-700 border border-green-200",
                            log.method === "POST" && "bg-blue-50 text-blue-700 border border-blue-200",
                            log.method === "PATCH" && "bg-yellow-50 text-yellow-700 border border-yellow-200",
                            log.method === "DELETE" && "bg-red-50 text-red-700 border border-red-200",
                            log.method === "PUT" && "bg-purple-50 text-purple-700 border border-purple-200",
                          )}>{log.method}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <span className={cn(
                            "font-mono font-bold text-xs",
                            log.statusCode >= 500 ? "text-red-600"
                            : log.statusCode >= 400 ? "text-orange-600"
                            : log.statusCode >= 300 ? "text-yellow-600"
                            : "text-green-600"
                          )}>{log.statusCode}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <span className={cn(
                            "font-mono text-xs",
                            log.durationMs >= 3000 ? "text-red-600 font-bold"
                            : log.durationMs >= 1000 ? "text-orange-600 font-semibold"
                            : "text-gray-600"
                          )}>
                            {log.durationMs}ms
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          {log.errorCategory ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-white",
                              CAT_COLORS[log.errorCategory]
                            )}>
                              {CAT_LABELS[log.errorCategory] ?? log.errorCategory}
                            </span>
                          ) : (
                            <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded font-semibold">
                              ✓ OK
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1 group">
                            <span className="font-mono text-[10px] text-gray-500 truncate max-w-[80px]">
                              {log.requestId.slice(0, 10)}...
                            </span>
                            <button
                              onClick={() => handleCopy(log.requestId)}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-teal-600 transition-colors"
                              title="复制 RequestId"
                            >
                              {copied === log.requestId ? (
                                <Check className="w-3 h-3 text-green-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                            {formatDate(log.createdAt).slice(5)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {(!data?.recentLogs || data.recentLogs.length === 0) && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">暂无日志</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <a href="#" className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
              查看完整日志 <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
