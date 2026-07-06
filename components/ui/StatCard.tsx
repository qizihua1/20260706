"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
  trend?: { value: number; label: string } | null;
  urgentFlash?: boolean;
  accent?: "primary" | "orange" | "green" | "red" | "purple" | "blue";
  className?: string;
}

const accentMap = {
  primary: "from-cyan-50 to-teal-50 border-cyan-200 text-teal-700",
  orange: "from-orange-50 to-amber-50 border-orange-200 text-orange-700",
  green: "from-green-50 to-emerald-50 border-green-200 text-green-700",
  red: "from-red-50 to-rose-50 border-red-200 text-red-700",
  purple: "from-purple-50 to-fuchsia-50 border-purple-200 text-purple-700",
  blue: "from-blue-50 to-sky-50 border-blue-200 text-blue-700",
};

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  urgentFlash,
  accent = "primary",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative bg-white rounded-xl border shadow-sm overflow-hidden p-5 bg-gradient-to-br",
        accentMap[accent],
        urgentFlash && "animate-pulse",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 truncate">
            {title}
          </p>
          <p
            className={cn(
              "text-2xl sm:text-3xl font-bold mb-1.5",
              urgentFlash ? "text-orange-600" : "text-gray-900"
            )}
          >
            {value}
            {urgentFlash && (
              <span className="ml-1.5 inline-block text-xs align-top">⚠️</span>
            )}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-500 truncate">{subtitle}</p>
          )}
          {trend && (
            <div
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5",
                trend.value >= 0
                  ? "text-green-700 bg-green-100"
                  : "text-red-700 bg-red-100"
              )}
            >
              <span>{trend.value >= 0 ? "▲" : "▼"}</span>
              <span>
                {Math.abs(trend.value)}% {trend.label}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              "w-11 h-11 rounded-lg bg-white shadow-sm border flex items-center justify-center shrink-0",
              accentMap[accent].split(" ").slice(-1)[0]
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
