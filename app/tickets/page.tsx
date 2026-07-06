"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, DataTableColumn } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { StatCard } from "@/components/ui/StatCard";
import { PermissionGate } from "@/components/ui/PermissionGate";
import {
  ClipboardList,
  Search,
  RefreshCw,
  FilterX,
  Clock,
  Flame,
  FileText,
  ChevronRight,
  GripVertical,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatDate, cn } from "@/lib/utils";

const STATUSES = [
  "PENDING_REVIEW",
  "L1_APPROVING",
  "L2_APPROVING",
  "EXECUTING",
  "COMPLETED",
  "CLOSED",
  "ESCALATED_AUTO",
  "ESCALATED_MANUAL",
  "REJECTED",
];
const CATEGORIES = ["ALL", "LOGISTICS", "QC"];
const SEVERITIES = ["ALL", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SOURCES = ["ALL", "SCAN", "MANUAL"];

interface TicketRow {
  id: string;
  ticketNo: string;
  source: "SCAN" | "MANUAL";
  category: "LOGISTICS" | "QC";
  subType: string;
  severity: string;
  currentStatus: string;
  externalCode: string;
  reportedBy: string;
  l1Assignee?: string | null;
  l2Assignee?: string | null;
  abnormalAmount: number;
  createdAt: string;
  deadlineAt: string;
  isUrgent?: boolean;
}

interface TicketListResp {
  items: TicketRow[];
  total: number;
  matched: number;
  pendingMyApproval: number;
  todayNew: number;
  avgHandleMinutes: number;
}

function getRemainInfo(deadlineAt: string) {
  const ms = new Date(deadlineAt).getTime() - Date.now();
  const totalMin = Math.floor(ms / 60000);
  const absMin = Math.abs(totalMin);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  if (totalMin < 0) {
    return {
      text: `已超时 ${h}小时${m}分钟`,
      color: "text-red-600 font-bold",
      urgent: true,
      overdue: true,
    };
  }
  if (totalMin <= 30) {
    return {
      text: `${m}分${Math.floor(((absMin * 60) % 60))}秒`,
      color: "text-red-600 font-bold animate-pulse",
      urgent: true,
      overdue: false,
    };
  }
  if (totalMin <= 120) {
    return {
      text: `${h}h${String(m).padStart(2, "0")}m`,
      color: "text-orange-600 font-semibold",
      urgent: true,
      overdue: false,
    };
  }
  return {
    text: `${h}h${String(m).padStart(2, "0")}m`,
    color: "text-gray-500",
    urgent: false,
    overdue: false,
  };
}

function SourceBadge({ source }: { source: string }) {
  const isScan = source === "SCAN";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold",
        isScan
          ? "bg-purple-50 text-purple-700 border border-purple-200"
          : "bg-blue-50 text-blue-700 border border-blue-200"
      )}
    >
      {isScan ? (
        <GripVertical className="w-3 h-3" />
      ) : (
        <FileText className="w-3 h-3" />
      )}
      {isScan ? "SCAN" : "MANUAL"}
    </span>
  );
}

export default function TicketsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [statuses, setStatuses] = useState<string[]>(
    searchParams.get("status")?.split(",")?.filter(Boolean) ?? []
  );
  const [category, setCategory] = useState(searchParams.get("category") ?? "ALL");
  const [subType, setSubType] = useState(searchParams.get("subType") ?? "");
  const [severity, setSeverity] = useState(searchParams.get("severity") ?? "ALL");
  const [source, setSource] = useState(searchParams.get("source") ?? "ALL");
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [onlyUrgent, setOnlyUrgent] = useState(searchParams.get("urgent") === "1");

  const [page, setPage] = useState(parseInt(searchParams.get("page") ?? "1"));
  const [pageSize, setPageSize] = useState(
    parseInt(searchParams.get("pageSize") ?? "10")
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TicketListResp | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statuses.length) params.set("status", statuses.join(","));
    if (category !== "ALL") params.set("category", category);
    if (subType) params.set("subType", subType);
    if (severity !== "ALL") params.set("severity", severity);
    if (source !== "ALL") params.set("source", source);
    if (keyword) params.set("keyword", keyword);
    if (onlyUrgent) params.set("urgent", "1");
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const qs = params.toString();
    router.replace(`${pathname}${qs ? "?" + qs : ""}`, { scroll: false });
  }, [statuses, category, subType, severity, source, keyword, onlyUrgent, page, pageSize]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statuses.length) params.set("status", statuses.join(","));
    if (category !== "ALL") params.set("category", category);
    if (subType) params.set("subType", subType);
    if (severity !== "ALL") params.set("severity", severity);
    if (source !== "ALL") params.set("source", source);
    if (keyword) params.set("keyword", keyword);
    if (onlyUrgent) params.set("urgent", "1");
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/tickets?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setData(res.data);
        else toast.error(res.error ?? "加载失败");
      })
      .catch((e) => toast.error(e.message ?? "加载失败"))
      .finally(() => setLoading(false));
  }, [statuses, category, subType, severity, source, keyword, onlyUrgent, page, pageSize, tick]);

  const resetFilters = () => {
    setStatuses([]);
    setCategory("ALL");
    setSubType("");
    setSeverity("ALL");
    setSource("ALL");
    setKeyword("");
    setOnlyUrgent(false);
    setPage(1);
  };

  const toggleStatus = (s: string) => {
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setPage(1);
  };

  const columns: DataTableColumn<TicketRow>[] = useMemo(
    () => [
      {
        key: "ticketNo",
        header: "工单号",
        render: (r) => (
          <Link
            href={`/tickets/${r.id}`}
            className="font-mono text-sm font-bold text-teal-700 hover:text-teal-800 hover:underline inline-flex items-center gap-1"
          >
            {r.ticketNo}
            <ChevronRight className="w-3 h-3 opacity-50" />
          </Link>
        ),
      },
      {
        key: "source",
        header: "来源",
        render: (r) => <SourceBadge source={r.source} />,
      },
      {
        key: "category",
        header: "类别 / 子类型",
        render: (r) => (
          <div>
            <div className="text-xs text-gray-500">
              {r.category === "QC" ? "品控异常" : "物流异常"}
            </div>
            <div className="text-sm font-semibold text-gray-800">{r.subType}</div>
          </div>
        ),
      },
      {
        key: "severity",
        header: "严重度",
        render: (r) => <SeverityBadge severity={r.severity} />,
      },
      {
        key: "currentStatus",
        header: "当前状态",
        render: (r) => {
          const ri = getRemainInfo(r.deadlineAt);
          return (
            <StatusBadge
              status={r.currentStatus}
              category={r.category}
              urgentDot={ri.urgent}
            />
          );
        },
      },
      {
        key: "externalCode",
        header: "关联运单号",
        render: (r) => (
          <a
            href="#"
            className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
            title="跳转 V2 运单详情"
          >
            {r.externalCode}
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        ),
      },
      { key: "reportedBy", header: "上报人", accessor: "reportedBy", className: "whitespace-nowrap" },
      {
        key: "assignee",
        header: "审批人",
        render: (r) => (
          <div className="text-xs text-gray-600">
            {r.l1Assignee && <div>L1: <b>{r.l1Assignee}</b></div>}
            {r.l2Assignee && <div>L2: <b>{r.l2Assignee}</b></div>}
            {!r.l1Assignee && !r.l2Assignee && <span className="text-gray-400">-</span>}
          </div>
        ),
      },
      {
        key: "abnormalAmount",
        header: "金额",
        align: "right",
        render: (r) => (
          <span className="font-mono font-bold text-gray-800">
            {formatMoney(r.abnormalAmount)}
          </span>
        ),
      },
      {
        key: "createdAt",
        header: "上报时间",
        render: (r) => (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {formatDate(r.createdAt)}
          </span>
        ),
      },
      {
        key: "remain",
        header: "剩余时间",
        render: (r) => {
          const ri = getRemainInfo(r.deadlineAt);
          return <div className={cn("text-xs whitespace-nowrap", ri.color)}>⏱ {ri.text}</div>;
        },
      },
      {
        key: "actions",
        header: "操作",
        width: "140px",
        render: (r) => {
          const actionable =
            r.currentStatus === "PENDING_REVIEW" ||
            r.currentStatus === "L1_APPROVING" ||
            r.currentStatus === "L2_APPROVING" ||
            r.currentStatus === "EXECUTING";
          return (
            <div className="flex items-center gap-1.5">
              <PermissionGate requireApproveLevel={1}>
                {actionable && (
                  <Link
                    href={`/tickets/${r.id}?action=process`}
                    className="px-3 py-1.5 rounded-md bg-gradient-to-r from-primary to-teal-500 text-white text-xs font-semibold hover:from-primaryDark hover:to-teal-600 shadow-sm"
                  >
                    处理
                  </Link>
                )}
              </PermissionGate>
              <Link
                href={`/tickets/${r.id}`}
                className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                详情
              </Link>
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div>
      <PageHeader
        title="工单管理"
        subtitle="模块四 · 全量异常工单列表、筛选、审批、执行"
        actions={
          <>
            <Link
              href="/report"
              className="px-4 py-2 rounded-lg border border-cyan-200 bg-gradient-to-br from-cyan-50 to-teal-50 text-sm font-semibold text-teal-700 hover:from-cyan-100 hover:to-teal-100 flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              新建上报
            </Link>
            <button
              onClick={() => {
                setPage(1);
                setTick((x) => x + 1);
              }}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              刷新
            </button>
          </>
        }
      />

      <div className="bg-white rounded-xl border border-cyan-100 shadow-sm p-5 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-semibold text-gray-500 mr-2">状态：</span>
          {STATUSES.map((s) => {
            const active = statuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium border transition-all",
                  active
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                )}
              >
                {s
                  .replace(/_/g, " ")
                  .replace("AUTO", "自动")
                  .replace("MANUAL", "手动")}
              </button>
            );
          })}
          {statuses.length > 0 && (
            <button
              onClick={() => setStatuses([])}
              className="text-xs text-gray-400 hover:text-gray-600 ml-1"
            >
              清除
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">类别</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c === "ALL" ? "全部类别" : c === "LOGISTICS" ? "物流" : "品控"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">子类型</label>
            <input
              type="text"
              value={subType}
              onChange={(e) => {
                setSubType(e.target.value);
                setPage(1);
              }}
              placeholder="如：丢件、破损"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">严重度</label>
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "全部严重度" : s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">来源</label>
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "全部来源" : s === "SCAN" ? "扫描品控" : "手动上报"}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">关键词</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder="运单号/收件人姓名"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-orange-200 bg-orange-50 cursor-pointer hover:bg-orange-100 transition-colors">
              <input
                type="checkbox"
                checked={onlyUrgent}
                onChange={(e) => {
                  setOnlyUrgent(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-xs font-semibold text-orange-700 whitespace-nowrap">
                🔥 只看 ≤2h 即将超时
              </span>
            </label>
            <button
              onClick={resetFilters}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
            >
              <FilterX className="w-4 h-4" />
              重置
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))
        ) : (
          <>
            <StatCard
              title="匹配条件"
              value={data?.matched ?? 0}
              subtitle={`${data?.total ?? 0} 条总工单`}
              accent="primary"
              icon={<ClipboardList className="w-4 h-4" />}
            />
            <StatCard
              title="待我审批"
              value={data?.pendingMyApproval ?? 0}
              subtitle="需要我处理"
              accent="orange"
              icon={<Clock className="w-4 h-4" />}
            />
            <StatCard
              title="今日新增"
              value={data?.todayNew ?? 0}
              subtitle="今日 0 点起"
              accent="blue"
              icon={<FileText className="w-4 h-4" />}
            />
            <StatCard
              title="平均处理时长"
              value={
                data?.avgHandleMinutes
                  ? `${Math.floor(data.avgHandleMinutes / 60)}h${data.avgHandleMinutes % 60}m`
                  : "-"
              }
              subtitle="历史平均"
              accent="green"
              icon={<Flame className="w-4 h-4" />}
            />
          </>
        )}
      </div>

      <DataTable<TicketRow>
        columns={columns}
        data={data?.items ?? []}
        loading={loading}
        total={data?.matched ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        emptyText="暂无工单，尝试调整筛选条件"
        rowKey={(r) => r.id}
      />
    </div>
  );
}
