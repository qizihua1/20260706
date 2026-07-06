"use client";

import { useState, useEffect, ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { AppRoleSwitcher } from "./AppRoleSwitcher";
import { Search, Menu, X, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/auth/user-context";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索工单号、运单号..."
                className="w-full pl-10 pr-4 py-2 border border-cyan-100 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <button className="p-2 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
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
