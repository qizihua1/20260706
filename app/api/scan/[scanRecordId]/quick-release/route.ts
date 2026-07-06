import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveCurrentUser } from "@/lib/auth/user-context";
import {
  PermissionDeniedError,
  canQcQuickRelease,
} from "@/lib/auth/permission-checks";
import { requestId } from "@/lib/utils";
import { V2ApiError } from "@/lib/v2-api-client";
import {
  OptimisticConcurrencyError,
  TicketStateTransitionError,
  transitionTicket,
} from "@/lib/services/ticket-state-machine";
import { updateBatchStatus } from "@/lib/services/scan-batch-machine";

const PatchBodySchema = z.object({
  note: z.string().min(1, "复核原因必填"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { scanRecordId: string } }
) {
  try {
    const reqId = requestId();
    const scanRecordId = params.scanRecordId;
    const body = await req.json();
    const parsed = PatchBodySchema.safeParse(body);
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
    const note = parsed.data.note;

    const caller = await resolveCurrentUser(headers());
    if (!canQcQuickRelease(caller)) {
      throw new PermissionDeniedError(
        "当前用户无 QC 快速放行权限（需 QC_SUPERVISOR / ADMIN）"
      );
    }

    const txResult = await (prisma as any).$transaction(async (tx: any) => {
      const scanRecord = await tx.scan_records.findUnique({
        where: { id: scanRecordId },
      });
      if (!scanRecord) {
        return NextResponse.json(
          {
            ok: false,
            error: "扫描记录不存在",
            code: "SCAN_RECORD_NOT_FOUND",
            requestId: reqId,
          },
          { status: 404 }
        );
      }

      let releasedTicket: any = null;
      const ticketId = scanRecord.ticketId;

      if (ticketId) {
        const ticket = await tx.exception_tickets.findUnique({
          where: { id: ticketId },
        });
        const terminal = ["COMPLETED", "CLOSED_AUTO_DISMISSED"];
        if (ticket && !terminal.includes(ticket.currentStatus)) {
          const now = new Date();
          try {
            await tx.approval_records.create({
              data: {
                ticketId,
                approverUserId: caller.id,
                level: 0,
                action: "QUICK_RELEASE_QC",
                comment: note,
                beforeStatus: ticket.currentStatus,
                afterStatus: "COMPLETED",
                idempotencyKey: `QR-${scanRecordId}-${caller.id}-${now.getTime()}`,
              },
            });
          } catch (e: any) {
            if (
              !(e?.code === "P2002" && String(e.message).includes("idempotencyKey"))
            ) {
              throw e;
            }
          }

          const transitionRes = await transitionTicket(tx, ticketId, {
            kind: "EXECUTE_DONE",
            actorUserId: caller.id,
            comment: note,
            approvalActionOverride: "QUICK_RELEASE_QC",
          });
          releasedTicket = transitionRes.ticket;
        } else {
          releasedTicket = ticket;
        }
      }

      const updatedRecords = await updateBatchStatus(tx, {
        batchNo: scanRecord.batchNo,
        skuCode: scanRecord.skuCode,
        toStatus: "RELEASED",
        reason: "QC 主管快速放行",
        ticketId: ticketId ?? undefined,
        qcSupervisorReleaseNote: note,
        qcSupervisorReleaseByUserId: caller.id,
      });

      const finalScan = updatedRecords.find(
        (r: any) => r.id === scanRecordId
      ) ?? updatedRecords[0];

      return {
        ok: true,
        releasedTicket,
        scanRecordUpdated: finalScan ?? scanRecord,
      };
    });

    if (txResult instanceof NextResponse) return txResult;
    return NextResponse.json(txResult);
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
        error: "该工单已被处理，请刷新",
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
