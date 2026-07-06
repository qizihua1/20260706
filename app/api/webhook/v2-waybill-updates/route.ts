import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requestId, sha256HexSync } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
} from "@/lib/services/ticket-state-machine";
import { PermissionDeniedError } from "@/lib/auth/permission-checks";

const WebhookBodySchema = z.object({
  event: z.enum(["waybill.updated", "waybill.created", "waybill.exception"]),
  waybillId: z.string().min(1),
  changes: z
    .object({
      amount: z.coerce.number().optional(),
      recipientAddress: z.string().optional(),
      status: z.string().optional(),
      recipientName: z.string().optional(),
      recipientPhone: z.string().optional(),
    })
    .optional()
    .default({}),
});

export async function POST(req: NextRequest) {
  try {
    const reqId = requestId();
    const secret = req.headers.get("x-webhook-secret");
    const expectedSecret = process.env.V3_WEBHOOK_SECRET ?? "";

    if (!expectedSecret) {
      console.warn(
        "[webhook/v2-waybill-updates] V3_WEBHOOK_SECRET 未配置，开发模式放行"
      );
    } else if (secret !== expectedSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: "无效的 webhook secret",
          code: "INVALID_WEBHOOK_SECRET",
          requestId: reqId,
        },
        { status: 401 }
      );
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "请求体非合法 JSON",
          code: "BAD_PARAM",
          requestId: reqId,
        },
        { status: 400 }
      );
    }
    const parsed = WebhookBodySchema.safeParse(body);
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
    const input = parsed.data;
    const now = new Date();

    await (prisma as any).sync_logs.create({
      data: {
        direction: "RECEIVE_WEBHOOK",
        interfaceName: `v2.webhook.${input.event}`,
        httpMethod: "POST",
        requestUrl: "/api/webhook/v2-waybill-updates",
        requestBodySha256: rawBody ? sha256HexSync(rawBody) : null,
        responseStatusCode: 200,
        requestId: reqId,
        durationMs: 0,
        errorCategory: null,
        errorMessage: null,
        retryAttempt: 0,
        callerUserId: null,
      },
    });

    const existing = await (prisma as any).waybill_snapshots.findUnique({
      where: { waybillId: input.waybillId },
    });

    const updateData: any = {
      syncedAt: now,
      syncRequestId: reqId,
    };
    const createData: any = {
      waybillId: input.waybillId,
      externalCode: null,
      storeName: null,
      recipientName: null,
      recipientPhone: null,
      recipientAddress: null,
      v2Status: null,
      totalAmount: 0,
      itemsSnapshot: [],
      syncedAt: now,
      syncRequestId: reqId,
    };

    if (input.changes.amount !== undefined) {
      updateData.totalAmount = input.changes.amount;
      createData.totalAmount = input.changes.amount;
    }
    if (input.changes.recipientAddress !== undefined) {
      updateData.recipientAddress = input.changes.recipientAddress;
      createData.recipientAddress = input.changes.recipientAddress;
    }
    if (input.changes.status !== undefined) {
      updateData.v2Status = input.changes.status;
      createData.v2Status = input.changes.status;
    }
    if (input.changes.recipientName !== undefined) {
      updateData.recipientName = input.changes.recipientName;
      createData.recipientName = input.changes.recipientName;
    }
    if (input.changes.recipientPhone !== undefined) {
      updateData.recipientPhone = input.changes.recipientPhone;
      createData.recipientPhone = input.changes.recipientPhone;
    }

    if (existing) {
      const updated = await (prisma as any).waybill_snapshots.update({
        where: { waybillId: input.waybillId },
        data: updateData,
      });
      return NextResponse.json({
        ok: true,
        waybillSnapshot: updated,
        upsert: "update",
      });
    } else {
      const created = await (prisma as any).waybill_snapshots.create({
        data: createData,
      });
      return NextResponse.json({
        ok: true,
        waybillSnapshot: created,
        upsert: "create",
      });
    }
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
