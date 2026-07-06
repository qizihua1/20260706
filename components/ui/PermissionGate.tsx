"use client";

import { ReactNode, useState, useEffect } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CurrentUser, UserRole } from "@/lib/auth/user-context";
import { hasAnyRole, canApproveLevel, isQcSupervisor } from "@/lib/auth/user-context";

interface PermissionGateProps {
  children: ReactNode;
  requireRoles?: UserRole[];
  requireApproveLevel?: 1 | 2;
  requireQcSupervisor?: boolean;
  fallback?: ReactNode;
  className?: string;
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await fetch("/api/auth/current-user");
    const data = await res.json();
    return data.ok ? data.data : null;
  } catch {
    return null;
  }
}

export function PermissionGate({
  children,
  requireRoles,
  requireApproveLevel,
  requireQcSupervisor,
  fallback,
  className,
}: PermissionGateProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUser(u);
      setLoaded(true);
    });
  }, []);

  if (!loaded) {
    return (
      <div className={cn("inline-block opacity-40", className)}>{children}</div>
    );
  }

  let allowed = !!user;
  if (user) {
    if (requireRoles?.length) {
      allowed = allowed && hasAnyRole(user, requireRoles);
    }
    if (requireApproveLevel) {
      allowed = allowed && canApproveLevel(user, requireApproveLevel);
    }
    if (requireQcSupervisor) {
      allowed = allowed && isQcSupervisor(user);
    }
  }

  if (allowed) {
    return <div className={className}>{children}</div>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 opacity-50 cursor-not-allowed grayscale-[60%] select-none",
        className
      )}
      title="无权限执行此操作"
    >
      <span className="relative inline-block">
        {children}
        <span className="absolute inset-0 flex items-center justify-center">
          <Lock className="w-3.5 h-3.5 text-gray-500" />
        </span>
      </span>
    </div>
  );
}
