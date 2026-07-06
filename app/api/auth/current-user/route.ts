import { NextRequest, NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser, CurrentUser, UserRole } from "@/lib/auth/user-context";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import { OptimisticConcurrencyError, TicketStateTransitionError } from "@/lib/services/ticket-state-machine";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";

const PostBodySchema = z.object({
  targetUserId: z.string().min(1),
});

export async function GET() {
  try {
    const reqId = requestId();
    const caller = await resolveCurrentUser(headers());

    const demoUsers = await prisma.users.findMany({
      where: { isActive: true },
      select: {
        id: true,
        username: true,
        displayName: true,
        roles: true,
      },
      orderBy: { username: "asc" },
    });

    return NextResponse.json({
      ok: true,
      currentUser: caller,
      demoUsers: demoUsers.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName ?? u.username,
        roles: (u.roles as UserRole[]) ?? [],
      })),
    });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
    const body = await req.json();
    const parsed = PostBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.errors.map((e) => e.message).join("; "),
          code: "BAD_PARAM",
          requestId: reqId,
        },
        { status: 400 }
      );
    }

    const targetUser = await prisma.users.findUnique({
      where: { id: parsed.data.targetUserId },
    });
    if (!targetUser || !targetUser.isActive) {
      return NextResponse.json(
        {
          ok: false,
          error: "目标用户不存在或已禁用",
          code: "USER_NOT_FOUND",
          requestId: reqId,
        },
        { status: 404 }
      );
    }

    const newUser: CurrentUser = {
      id: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName ?? targetUser.username,
      roles: (targetUser.roles as UserRole[]) ?? [],
      isActive: targetUser.isActive,
    };

    const cookieStore = cookies();
    const thirtyDays = 30 * 24 * 60 * 60;
    cookieStore.set("__v3_user", targetUser.id, {
      path: "/",
      maxAge: thirtyDays,
      httpOnly: true,
      sameSite: "lax",
    });

    return NextResponse.json({
      ok: true,
      newUser,
    });
  } catch (err: any) {
    return handleRouteError(err);
  }
}

function handleRouteError(err: any): NextResponse {
  const reqId = requestId();
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.errors.map((e) => e.message).join("; "),
        code: "BAD_PARAM",
        requestId: reqId,
      },
      { status: 400 }
    );
  }
  if (err instanceof V2ApiError) {
    const statusMap: Record<string, number> = {
      NETWORK_TIMEOUT: 504,
      AUTH: 401,
      NOT_FOUND: 404,
      BAD_PARAM: 400,
      V2_SERVER_ERROR: 502,
      UNKNOWN: 500,
    };
    const status = statusMap[err.category] ?? 500;
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: err.category,
        requestId: err.requestId ?? reqId,
      },
      { status }
    );
  }
  if (err instanceof OptimisticConcurrencyError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "CONFLICT",
        requestId: err.ticketId ?? reqId,
      },
      { status: 409 }
    );
  }
  if (err instanceof PermissionDeniedError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "PERMISSION_DENIED",
        requestId: reqId,
      },
      { status: 403 }
    );
  }
  if (err instanceof TicketStateTransitionError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        code: "STATE_TRANSITION_ERROR",
        requestId: reqId,
      },
      { status: 422 }
    );
  }
  const isDev = process.env.NODE_ENV !== "production";
  return NextResponse.json(
    {
      ok: false,
      error: isDev ? err?.message ?? String(err) : "系统错误",
      code: "INTERNAL_ERROR",
      requestId: reqId,
    },
    { status: 500 }
  );
}
