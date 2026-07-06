"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  HandCoins,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
import { formatMoney, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface DashboardData {
  totalTickets: number;
  pendingTickets: number;
  urgentTickets: number;
  todayCompleted: number;
  customerPayoutTotal: number;
  vendorRecoveryTotal: number;
  qcHeldBatches: number;
  qcPassRate: number;
  trend7Days: { date: string; count: number; completed: number }[];
  topSubTypes: { subType: string; count: number }[];
  urgentTop10: {
    id: string;
    ticketNo: string;
    subType: string;
    severity: string;
    deadlineAt: string;
    reportedBy: string;
  }[];
  recentCompleted: {
    id: string;
    ticketNo: string;
    subType: string;
    completedAt: string;
    amount: number;
  }[];
}

function formatRemainTime(deadline: string): {
  text: string;
  color: string;
  isOverdue: boolean;
  isUrgent: boolean;
} {
  const ms = new Date(deadline).getTime() - Date.now();
  const totalMin = Math.floor(ms / 60000);
  const abs = Math.abs(totalMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const mmss =
    h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}分${String(Math.floor((abs * 60) % 60)).padStart(2, "0")}秒`;
  if (totalMin < 0) {
    return { text: `已超时 ${h}小时${m}分钟`, color: "text-red-600", isOverdue: true, isUrgent: true };
  }
  if (totalMin <= 30) {
    return { text: mmss, color: "text-red-600 animate-pulse font-bold", isOverdue: false, isUrgent: true };
  }
  if (totalMin <= 120) {
    return { text: `${h}h${String(m).padStart(2, "0")}m`, color: "text-orange-600 font-semibold", isOverdue: false, isUrgent: true };
  }
  return { text: `${h}h${String(m).padStart(2, "0")}m`, color: "text-gray-500", isOverdue: false, isUrgent: false };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats/dashboard");
      const json = await res.json();
      if (json.ok) setData(json.data);
      else toast.error(json.error ?? "加载失败");
    } catch (e: any) {
      toast.error(e.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const maxTrend = Math.max(1, ...(data?.trend7Days?.map((d) => d.count) ?? [0]));

  return (
    <div>
      <PageHeader
        title="运营仪表盘"
        subtitle="运单全生命周期监控 · 实时刷新"
        actions={
          <button
            onClick={load}
            className="btn-primary"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TrendingUp className="w-4 h-4" />
            )}
            刷新数据
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {loading && !data ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))
        ) : (
          <>
            <StatCard
              title="总工单数"
              value={data?.totalTickets ?? 0}
              subtitle="全量异常工单"
              icon={<ClipboardList className="w-5 h-5" />}
              accent="primary"
            />
            <StatCard
              title="待处理工单"
              value={data?.pendingTickets ?? 0}
              subtitle="待审核/审批/执行"
              icon={<Clock className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              title="即将超时"
              value={data?.urgentTickets ?? 0}
              subtitle="2小时内即将超时"
              icon={<AlertTriangle className="w-5 h-5" />}
              accent="orange"
              urgentFlash
            />
            <StatCard
              title="今日完成"
              value={data?.todayCompleted ?? 0}
              subtitle="已完成/已关闭"
              icon={<CheckCircle2 className="w-5 h-5" />}
              accent="green"
            />
            <StatCard
              title="客户赔付累计"
              value={formatMoney(data?.customerPayoutTotal ?? 0)}
              subtitle="已发放客户补偿"
              icon={<Wallet className="w-5 h-5" />}
              accent="purple"
            />
            <StatCard
              title="向供应商追偿"
              value={formatMoney(data?.vendorRecoveryTotal ?? 0)}
              subtitle="已发起追偿总额"
              icon={<HandCoins className="w-5 h-5" />}
              accent="blue"
            />
            <StatCard
              title="品控暂扣批次"
              value={data?.qcHeldBatches ?? 0}
              subtitle="当前锁定中"
              icon={<ShieldAlert className="w-5 h-5" />}
              accent="orange"
            />
            <StatCard
              title="品控通过率"
              value={`${(data?.qcPassRate ?? 0).toFixed(1)}%`}
              subtitle="扫描通过率"
              icon={<ShieldCheck className="w-5 h-5" />}
              accent="green"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-gray-900">近 7 天趋势</h3>
                <p className="text-xs text-gray-500 mt-0.5">新开工单 vs 已完成</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-primary" /> 新建
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-green-400" /> 完成
                </span>
              </div>
            </div>
            {loading ? (
              <div className="h-56 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-2 h-56 px-1">
                {(data?.trend7Days ?? []).map((d) => {
                  const h = (d.count / maxTrend) * 100;
                  const hc = (d.completed / maxTrend) * 100;
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                      <div className="w-full flex items-end justify-center gap-1 h-44">
                        <div
                          className="w-1/2 rounded-t-lg bg-gradient-to-t from-primary to-cyan-400 shadow-sm transition-all hover:from-primaryDark hover:to-primary relative group"
                          style={{ height: `${Math.max(2, h)}%` }}
                        >
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {d.count}
                          </span>
                        </div>
                        <div
                          className="w-1/2 rounded-t-lg bg-gradient-to-t from-green-500 to-green-300 shadow-sm transition-all hover:from-green-600 hover:to-green-500"
                          style={{ height: `${Math.max(2, hc)}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 w-full text-center truncate">
                        {d.date.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">异常子类型 TOP 榜</h3>
              <Link
                href="/tickets"
                className="text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                查看全部 →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(data?.topSubTypes ?? []).slice(0, 8).map((s, i) => {
                  const max = Math.max(1, ...(data?.topSubTypes ?? []).map((x) => x.count));
                  const pct = (s.count / max) * 100;
                  return (
                    <div key={s.subType} className="group">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold text-white",
                              i === 0 && "bg-gradient-to-br from-yellow-400 to-orange-500",
                              i === 1 && "bg-gradient-to-br from-gray-300 to-gray-500",
                              i === 2 && "bg-gradient-to-br from-orange-300 to-amber-600",
                              i > 2 && "bg-gradient-to-br from-cyan-400 to-teal-500"
                            )}
                          >
                            {i + 1}
                          </span>
                          <span className="font-medium text-gray-800">{s.subType}</span>
                        </div>
                        <span className="font-bold text-teal-700">{s.count}</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-teal-500 rounded-full transition-all group-hover:from-primary group-hover:to-primaryDark"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-red-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <h3 className="text-lg font-bold text-gray-900">即将超时 Top 10</h3>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 font-semibold">
                {data?.urgentTop10?.length ?? 0} 条
              </span>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : data?.urgentTop10?.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
                <Check className="w-8 h-8 text-green-400" />
                <span>太棒了！当前没有即将超时的工单</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                {(data?.urgentTop10 ?? []).map((t) => {
                  const rt = formatRemainTime(t.deadlineAt);
                  return (
                    <Link
                      key={t.id}
                      href={`/tickets/${t.id}`}
                      className="block p-3 rounded-lg border border-gray-100 hover:border-red-200 hover:bg-red-50/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-teal-700 truncate">
                              {t.ticketNo}
                            </span>
                            <StatusBadge
                              status="PENDING_REVIEW"
                              className="!text-[10px] !py-0.5"
                              urgentDot={rt.isUrgent}
                            />
                          </div>
                          <div className="text-xs text-gray-500 mb-1.5 truncate">
                            {t.subType} · 上报：{t.reportedBy}
                          </div>
                          <div className={cn("text-xs font-semibold", rt.color)}>
                            ⏱ {rt.text}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">最近完成</h3>
              <Link
                href="/tickets?status=COMPLETED,CLOSED"
                className="text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                历史记录 →
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {(data?.recentCompleted ?? []).map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-green-200 hover:bg-green-50/30 transition-colors gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-teal-700 truncate mb-0.5">
                        {t.ticketNo}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{t.subType}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(t.completedAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-green-600">
                        {formatMoney(t.amount)}
                      </div>
                      <div className="inline-flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                        <Check className="w-3 h-3" /> 完成
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
