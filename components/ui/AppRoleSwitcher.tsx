"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/auth/user-context";

const SEED_USERS: { id: string; username: string; displayName: string }[] = [
  // id 必须与数据库实际 username 一致（后端 route.ts 会先按 id 查，再按 username fallback）
  { id: "op1", username: "op1", displayName: "仓库操作员-小王 (WAREHOUSE_OPERATOR)" },
  { id: "qc1", username: "qc1", displayName: "品控主管-老李 (QC_SUPERVISOR)" },
  { id: "l1_approver", username: "l1_approver", displayName: "一级审批-张主管 (APPROVER_L1)" },
  { id: "l2_approver", username: "l2_approver", displayName: "二级审批-王经理 (APPROVER_L2)" },
  { id: "admin", username: "admin", displayName: "系统管理员 admin (ADMIN)" },
];

interface AppRoleSwitcherProps {
  currentUser: CurrentUser | null;
  onUserChanged?: (user: CurrentUser) => void;
}

export function AppRoleSwitcher({
  currentUser,
  onUserChanged,
}: AppRoleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSwitch = async (userId: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/current-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = await res.json();
      if (data.ok) {
        const user = data.newUser;
        toast.success(`已切换到 ${user?.displayName ?? user?.username}`);
        onUserChanged?.(user);
        setTimeout(() => window.location.reload(), 300);
      } else {
        toast.error(data.error ?? "切换失败");
      }
    } catch (e: any) {
      toast.error(e.message ?? "切换失败");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-100 bg-gradient-to-r from-cyan-50 to-teal-50 hover:from-cyan-100 hover:to-teal-100 transition-colors",
          loading && "opacity-60 pointer-events-none"
        )}
      >
        <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center">
          {loading ? (
            <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
          ) : (
            <User className="w-4 h-4 text-teal-600" />
          )}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-sm font-semibold text-teal-700">
            {currentUser?.displayName ?? "加载中..."}
          </div>
          <div className="text-xs text-gray-500">
            {currentUser?.roles?.length
              ? currentUser.roles.map((r: string) => r.replace("WAREHOUSE_OPERATOR", "操作员")
                .replace("QC_SUPERVISOR", "品控主管")
                .replace("APPROVER_L1", "L1审批")
                .replace("APPROVER_L2", "L2审批")
                .replace("ADMIN", "管理员")).join(" / ")
              : "-"}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-teal-600 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-cyan-100 shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-cyan-50 to-teal-50 border-b border-cyan-100">
            <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">
              切换角色 / 用户
            </p>
          </div>
          <div className="py-1 max-h-80 overflow-auto">
            {SEED_USERS.map((u) => {
              const isActive =
                currentUser?.id === u.id ||
                currentUser?.username === u.username;
              return (
                <button
                  key={u.id}
                  onClick={() => handleSwitch(u.id)}
                  disabled={isActive || loading}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    isActive
                      ? "bg-teal-50 text-teal-700"
                      : "hover:bg-gray-50 text-gray-700"
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center",
                      isActive ? "bg-teal-200" : "bg-gray-100"
                    )}
                  >
                    <User
                      className={cn(
                        "w-4 h-4",
                        isActive ? "text-teal-700" : "text-gray-500"
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {u.displayName}
                    </p>
                    <p className="text-xs text-gray-400">@{u.username}</p>
                  </div>
                  {isActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                      当前
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
