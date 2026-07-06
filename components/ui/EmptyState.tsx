"use client";

import { ReactNode } from "react";
import { Inbox, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  variant?: "default" | "search";
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = "暂无数据",
  description,
  icon,
  variant = "default",
  action,
  className,
}: EmptyStateProps) {
  const Icon = variant === "search" ? Search : Inbox;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-100 flex items-center justify-center mb-4">
        {icon ?? <Icon className="w-8 h-8 text-teal-400" />}
      </div>
      <h3 className="text-lg font-semibold text-gray-800 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  );
}
