"use client";

import { Truck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Clock, Ban, Flame, Handshake } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusKey =
  | "PENDING_REVIEW"
  | "L1_APPROVING"
  | "L2_APPROVING"
  | "EXECUTING"
  | "COMPLETED"
  | "CLOSED"
  | "ESCALATED_AUTO"
  | "ESCALATED_MANUAL"
  | "REJECTED";

const STATUS_MAP: Record<
  StatusKey,
  { label: string; bg: string; text: string; border: string }
> = {
  PENDING_REVIEW: {
    label: "待审核",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  L1_APPROVING: {
    label: "L1 审批中",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
  },
  L2_APPROVING: {
    label: "L2 审批中",
    bg: "bg-orange-100",
    text: "text-orange-800",
    border: "border-orange-300",
  },
  EXECUTING: {
    label: "执行中",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  COMPLETED: {
    label: "已完成",
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
  CLOSED: {
    label: "已关闭",
    bg: "bg-gray-100",
    text: "text-gray-600",
    border: "border-gray-200",
  },
  ESCALATED_AUTO: {
    label: "已自动升级",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  ESCALATED_MANUAL: {
    label: "已手动升级",
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-300",
  },
  REJECTED: {
    label: "已驳回",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
  },
};

const StatusIcon = {
  PENDING_REVIEW: Clock,
  L1_APPROVING: AlertTriangle,
  L2_APPROVING: AlertTriangle,
  EXECUTING: Flame,
  COMPLETED: CheckCircle2,
  CLOSED: Ban,
  ESCALATED_AUTO: XCircle,
  ESCALATED_MANUAL: XCircle,
  REJECTED: Handshake,
};

interface StatusBadgeProps {
  status: string;
  category?: "LOGISTICS" | "QC" | string;
  urgentDot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  category,
  urgentDot,
  className,
}: StatusBadgeProps) {
  const key = (status as StatusKey) ?? "PENDING_REVIEW";
  const map = STATUS_MAP[key] ?? STATUS_MAP.PENDING_REVIEW;
  const CategoryIcon = category === "QC" ? ShieldAlert : Truck;
  const StatusIconComp = StatusIcon[key] ?? Clock;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap relative",
        map.bg,
        map.text,
        map.border,
        className
      )}
    >
      {urgentDot && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border-2 border-white" />
      )}
      <StatusIconComp className="w-3 h-3" />
      <span className="hidden sm:inline">
        <CategoryIcon className="w-3 h-3 inline mr-0.5 opacity-60" />
      </span>
      {map.label}
    </span>
  );
}
