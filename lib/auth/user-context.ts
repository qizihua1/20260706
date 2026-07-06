import { prisma } from "../prisma";

export enum UserRole {
  WAREHOUSE_OPERATOR = "WAREHOUSE_OPERATOR",
  QC_SUPERVISOR = "QC_SUPERVISOR",
  APPROVER_L1 = "APPROVER_L1",
  APPROVER_L2 = "APPROVER_L2",
  ADMIN = "ADMIN",
}

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  roles: UserRole[];
  isActive: boolean;
};

function parseCookieString(cookie: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k) out[k.trim()] = decodeURIComponent(rest.join("=").trim());
  }
  return out;
}

function _tryGetUserFromArgs(
  headersListOrCookie?: { get?: (k: string) => string | undefined | null; [k: string]: any }
): { userId?: string; username?: string } {
  if (!headersListOrCookie) return {};

  if (typeof (headersListOrCookie as any).get === "function") {
    const getFn = (headersListOrCookie as any).get as (k: string) =>
      | string
      | undefined
      | null;
    const demoId = getFn("x-demo-user-id");
    if (demoId) return { userId: demoId };
    const auth = getFn("authorization");
    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice(7);
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64").toString()
        );
        if (payload?.sub) return { userId: payload.sub };
        if (payload?.username) return { username: payload.username };
      } catch {}
    }
    const cookie = getFn("cookie");
    if (cookie) {
      const parsed = parseCookieString(cookie);
      if (parsed.__v3_user) return { userId: parsed.__v3_user };
    }
    return {};
  }

  const record = headersListOrCookie as Record<string, any>;
  for (const key of Object.keys(record)) {
    const lk = key.toLowerCase();
    if (lk === "x-demo-user-id" && record[key]) {
      return { userId: String(record[key]) };
    }
  }
  if (record.__v3_user) return { userId: String(record.__v3_user) };
  if (record.cookie) {
    const parsed = parseCookieString(String(record.cookie));
    if (parsed.__v3_user) return { userId: parsed.__v3_user };
  }
  return {};
}

const DEFAULT_OP_ID = "op1";

async function _getOrCreateDefaultUser(): Promise<CurrentUser> {
  try {
    const existing = await prisma.users.findUnique({
      where: { username: DEFAULT_OP_ID },
    });
    if (existing) {
      return {
        id: existing.id,
        username: existing.username,
        displayName: existing.displayName ?? "仓库操作员 op1",
        roles: (existing.roles as UserRole[]) ?? [UserRole.WAREHOUSE_OPERATOR],
        isActive: existing.isActive,
      };
    }
    const created = await prisma.users.upsert({
      where: { username: DEFAULT_OP_ID },
      update: {},
      create: {
        username: DEFAULT_OP_ID,
        displayName: "仓库操作员 op1",
        roles: [UserRole.WAREHOUSE_OPERATOR],
        isActive: true,
      },
    });
    return {
      id: created.id,
      username: created.username,
      displayName: created.displayName ?? "仓库操作员 op1",
      roles: (created.roles as UserRole[]) ?? [UserRole.WAREHOUSE_OPERATOR],
      isActive: created.isActive,
    };
  } catch {
    return {
      id: "fallback-op1-local-id",
      username: DEFAULT_OP_ID,
      displayName: "仓库操作员 op1",
      roles: [UserRole.WAREHOUSE_OPERATOR],
      isActive: true,
    };
  }
}

export async function resolveCurrentUser(
  headersListOrCookie?: {
    get?: (k: string) => string | undefined | null;
    [k: string]: any;
  }
): Promise<CurrentUser> {
  try {
    const { userId, username } = _tryGetUserFromArgs(headersListOrCookie);

    if (userId || username) {
      const where: any = {};
      if (userId) where.id = userId;
      else if (username) where.username = username;
      const found = await prisma.users.findUnique({ where });
      if (found && found.isActive) {
        return {
          id: found.id,
          username: found.username,
          displayName: found.displayName ?? found.username,
          roles: (found.roles as UserRole[]) ?? [],
          isActive: found.isActive,
        };
      }
      if (found && !found.isActive) {
        // 禁用用户，回退默认
      }
    }
  } catch {}

  return _getOrCreateDefaultUser();
}

export function requireRole(
  user: CurrentUser,
  required: UserRole | UserRole[]
): boolean {
  const reqs = Array.isArray(required) ? required : [required];
  return reqs.every((r) => user.roles.includes(r));
}

export function hasAnyRole(
  user: CurrentUser,
  roles: UserRole[]
): boolean {
  return roles.some((r) => user.roles.includes(r));
}

export function canApproveLevel(
  user: CurrentUser,
  level: 1 | 2
): boolean {
  if (user.roles.includes(UserRole.ADMIN)) return true;
  if (level === 1) {
    return (
      user.roles.includes(UserRole.APPROVER_L1) ||
      user.roles.includes(UserRole.APPROVER_L2)
    );
  }
  if (level === 2) {
    return user.roles.includes(UserRole.APPROVER_L2);
  }
  return false;
}

export function isQcSupervisor(user: CurrentUser): boolean {
  return user.roles.includes(UserRole.QC_SUPERVISOR);
}
