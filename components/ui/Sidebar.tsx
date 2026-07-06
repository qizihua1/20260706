"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ScanLine,
  FileWarning,
  ClipboardList,
  ShieldCheck,
  Settings2,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/scan", label: "扫描品控", icon: ScanLine },
  { href: "/report", label: "异常上报", icon: FileWarning },
  { href: "/tickets", label: "工单管理", icon: ClipboardList },
  { href: "/qc-rules", label: "品控规则", icon: ShieldCheck },
  { href: "/approval-thresholds", label: "审批阈值", icon: Settings2 },
  { href: "/sync-monitoring", label: "同步监控", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-white border-r border-cyan-100 shadow-sm flex flex-col">
      <div className="px-6 py-4 border-b border-cyan-100">
        <h2 className="text-lg font-bold text-teal-600">功能导航</h2>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-gradient-to-r from-cyan-50 to-teal-50 text-teal-700 border border-cyan-200 shadow-sm"
                  : "text-gray-600 hover:bg-teal-50 hover:text-teal-600"
              )}
            >
              <Icon
                className={cn(
                  "w-5 h-5",
                  isActive ? "text-teal-600" : "text-gray-400"
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
