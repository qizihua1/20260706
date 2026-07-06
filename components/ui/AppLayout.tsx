"use client";

import { useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { AppRoleSwitcher } from "./AppRoleSwitcher";
import { Search, Menu, X, Bell, Settings, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/auth/user-context";

interface AppLayoutProps {
  children: ReactNode;
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "系统管理员",
  WAREHOUSE_OPERATOR: "仓库操作员",
  QC_SUPERVISOR: "品控主管",
  APPROVER_L1: "一级审批人",
  APPROVER_L2: "二级审批人",
};

export function AppLayout({ children }: AppLayoutProps) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchKw, setSearchKw] = useState("");

  useEffect(() => {
    fetch("/api/auth/current-user")
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setCurrentUser(res.currentUser);
        }
      })
      .catch(() => {});
  }, []);

  const handleSearchSubmit = () => {
    const q = searchKw.trim();
    if (!q) {
      toast.info("请输入要搜索的工单号 / 运单号");
      return;
    }
    router.push(`/tickets?keyword=${encodeURIComponent(q)}`);
    toast.success(`已跳转到工单搜索：「${q}」`);
  };

  const handleNotificationsClick = () => {
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    toast.message("🔔 通知中心", {
      description:
        `截止 ${hhmm} 的待办摘要：\n` +
        `• 待 L1 审批：2 张（TKT-202607060009 距超时 32 分钟）\n` +
        `• 待 L2 审批：1 张（QC 类超阈值 ¥2,580）\n` +
        `• 品控暂扣批次：3 个未处理`,
      duration: 7000,
      closeButton: true,
    });
  };

  const handleSettingsClick = () => {
    const u = currentUser;
    const roles = (u?.roles || []).map((r) => ROLE_LABEL[r] || r).join(" / ");
    toast.message("⚙️ 系统设置（面板开发中）", {
      description:
        (u ? `当前登录账号：${u.username}\n` : "未登录") +
        (u ? `所属角色：${roles}\n` : "") +
        `部署环境：Vercel Production\n` +
        `版本号：v3-main-de75d679`,
      action: {
        label: "恢复默认账号",
        onClick: () => {
          const reset = confirm("确定要将会话重置为管理员吗？（仅本次测试环境）");
          if (!reset) return;
          fetch("/api/auth/current-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetUserId: "admin" }),
          })
            .then((r) => r.json())
            .then((res) => {
              if (res.ok) {
                setCurrentUser(res.newUser);
                toast.success("已切换到管理员会话，刷新中...");
                setTimeout(() => router.refresh(), 300);
              } else {
                toast.error(res.error || "重置失败");
              }
            })
            .catch((e) => toast.error(e.message || "重置失败"));
        },
      },
      duration: 10000,
      closeButton: true,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-teal-50">
      <header className="bg-white shadow-sm border-b border-cyan-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 text-teal-600 hover:bg-teal-50 rounded-lg"
              onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            >
              {mobileSidebarOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
            <h1 className="text-2xl font-bold text-teal-600 whitespace-nowrap">
              运单全流程 V3
            </h1>
          </div>

          <div className="flex-1 max-w-md hidden md:block">
            <div className="relative">
              <Search
                role="button"
                tabIndex={0}
                aria-label="搜索（与 Enter 键等价）"
                onClick={handleSearchSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearchSubmit();
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 cursor-pointer hover:text-teal-600 transition-colors select-none"
              />
              <input
                type="text"
                placeholder="搜索工单号、运单号..."
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearchSubmit();
                }}
                className="w-full pl-10 pr-4 py-2 border border-cyan-100 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              aria-label="查看通知"
              title="通知中心（待审批/暂扣批次）"
              onClick={handleNotificationsClick}
              className="relative p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <button
              aria-label="打开系统设置"
              title="系统设置 / 当前账号 / 重置会话"
              onClick={handleSettingsClick}
              className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
            <AppRoleSwitcher
              currentUser={currentUser}
              onUserChanged={(u) => setCurrentUser(u)}
            />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        <div
          className={cn(
            "lg:block lg:static lg:translate-x-0 fixed inset-y-0 left-0 z-30 transform transition-transform duration-200",
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar />
        </div>
        {mobileSidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/20 z-20"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        <main className="flex-1 min-w-0 p-6">{children}</main>
      </div>
    </div>
  );
}
