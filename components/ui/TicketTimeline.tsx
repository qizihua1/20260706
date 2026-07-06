"use client";

import { CheckCircle2, XCircle, Clock, AlertTriangle, ArrowRight, ShieldCheck, UserCheck, Ban, Flame, Package, Handshake } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  type:
    | "status_change"
    | "l1_approve"
    | "l1_reject"
    | "l2_approve"
    | "l2_reject"
    | "escalate"
    | "execute"
    | "create"
    | "note"
    | "scan_lock"
    | "scan_unlock";
  title: string;
  actor?: string;
  action?: string;
  comment?: string;
  timestamp: string | Date;
  meta?: Record<string, any>;
}

const TYPE_STYLES: Record<TimelineItem["type"], { dot: string; line: string; bg: string; text: string; icon: any }> = {
  create: { dot: "bg-blue-500", line: "bg-blue-200", bg: "bg-blue-50", text: "text-blue-700", icon: Package },
  status_change: { dot: "bg-gray-500", line: "bg-gray-200", bg: "bg-gray-50", text: "text-gray-700", icon: ArrowRight },
  l1_approve: { dot: "bg-orange-500", line: "bg-orange-200", bg: "bg-orange-50", text: "text-orange-700", icon: UserCheck },
  l1_reject: { dot: "bg-yellow-500", line: "bg-yellow-200", bg: "bg-yellow-50", text: "text-yellow-700", icon: Ban },
  l2_approve: { dot: "bg-teal-500", line: "bg-teal-200", bg: "bg-teal-50", text: "text-teal-700", icon: ShieldCheck },
  l2_reject: { dot: "bg-yellow-600", line: "bg-yellow-200", bg: "bg-yellow-50", text: "text-yellow-800", icon: Ban },
  escalate: { dot: "bg-red-500", line: "bg-red-200", bg: "bg-red-50", text: "text-red-700", icon: Flame },
  execute: { dot: "bg-purple-500", line: "bg-purple-200", bg: "bg-purple-50", text: "text-purple-700", icon: CheckCircle2 },
  note: { dot: "bg-gray-400", line: "bg-gray-200", bg: "bg-gray-50", text: "text-gray-700", icon: Clock },
  scan_lock: { dot: "bg-red-400", line: "bg-red-200", bg: "bg-red-50", text: "text-red-700", icon: AlertTriangle },
  scan_unlock: { dot: "bg-green-500", line: "bg-green-200", bg: "bg-green-50", text: "text-green-700", icon: Handshake },
};

interface TicketTimelineProps {
  items: TimelineItem[];
  order?: "asc" | "desc";
  className?: string;
}

export function TicketTimeline({
  items,
  order = "desc",
  className,
}: TicketTimelineProps) {
  const sorted = [...items].sort((a, b) => {
    const da = new Date(a.timestamp).getTime();
    const db = new Date(b.timestamp).getTime();
    return order === "asc" ? da - db : db - da;
  });

  return (
    <div className={cn("relative", className)}>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">
          暂无审批/操作记录
        </div>
      ) : (
        <div className="space-y-1">
          {sorted.map((item, idx) => {
            const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.note;
            const Icon = style.icon;
            const isLast = idx === sorted.length - 1;
            return (
              <div key={item.id} className="relative flex gap-4 min-h-[72px]">
                <div className="flex flex-col items-center shrink-0 w-10">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10",
                      style.dot,
                      "text-white"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  {!isLast && (
                    <div
                      className={cn(
                        "flex-1 w-0.5 mt-1 mb-1",
                        style.line
                      )}
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "flex-1 rounded-lg border border-gray-100 px-4 py-3 mb-1",
                    style.bg
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("text-sm font-semibold", style.text)}>
                        {item.title}
                      </span>
                      {item.action && (
                        <span className="text-xs px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                          {item.action}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {formatDate(item.timestamp)}
                    </span>
                  </div>
                  {item.actor && (
                    <div className="text-xs text-gray-500 mb-1.5">
                      操作人：<b className="text-gray-700">{item.actor}</b>
                    </div>
                  )}
                  {item.comment && (
                    <div className="text-sm text-gray-700 bg-white/60 rounded-md p-2 border border-gray-100 whitespace-pre-wrap">
                      {item.comment}
                    </div>
                  )}
                  {item.meta && Object.keys(item.meta).length > 0 && !item.comment && (
                    <div className="text-xs text-gray-500 space-y-0.5 bg-white/50 rounded-md p-2 mt-1">
                      {Object.entries(item.meta).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-gray-400 shrink-0">{k}:</span>
                          <span className="text-gray-700 break-all">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
