"use client";

import { AlertCircle, AlertTriangle, Flame, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type SeverityKey = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SEVERITY_MAP: Record<
  SeverityKey,
  { label: string; bg: string; text: string; border: string; icon: any }
> = {
  LOW: {
    label: "低",
    bg: "bg-slate-50",
    text: "text-slate-600",
    border: "border-slate-200",
    icon: Minus,
  },
  MEDIUM: {
    label: "中",
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
    icon: AlertCircle,
  },
  HIGH: {
    label: "高",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    icon: AlertTriangle,
  },
  CRITICAL: {
    label: "严重",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: Flame,
  },
};

interface SeverityBadgeProps {
  severity: string;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const key = (severity as SeverityKey) ?? "MEDIUM";
  const map = SEVERITY_MAP[key] ?? SEVERITY_MAP.MEDIUM;
  const Icon = map.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap",
        map.bg,
        map.text,
        map.border,
        className
      )}
    >
      <Icon className="w-3 h-3" />
      {map.label}
    </span>
  );
}
