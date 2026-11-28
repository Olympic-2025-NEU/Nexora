// SPDX-License-Identifier: AGPL-3.0-only
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DomainError } from "@/platform/kernel/errors";
import { runCommand } from "@/platform/http/pipeline";
import { checkPolicy } from "@/platform/access/policy";
import { assertBody, isUuid, mapRouteError, ok, parseIfMatchVersion, readJson } from "@/contexts/catalog/application/http";
import { resolveUserActor } from "@/composition/system";
import { salesIdempotency, salesOrderService, salesRead, salesUnitOfWork } from "@/composition/sales";
import type { PaymentMethod, SalesOrderLineInput } from "../domain/sales-order";
import { PAYMENT_METHODS } from "../domain/sales-order";

function parseLines(raw: unknown): SalesOrderLineInput[] {
  if (!Array.isArray(raw) || !raw.length) throw new DomainError("LINES_REQUIRED", 422);
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("LINE_INVALID", 422);
    const row = item as Record<string, unknown>;
    if (typeof row.productVariantId !== "string" || !isUuid(row.productVariantId)) {
      throw new DomainError("VARIANT_ID_INVALID", 422);
    }
    if (typeof row.uomId !== "string" || !isUuid(row.uomId)) throw new DomainError("UOM_ID_INVALID", 422);
    if (typeof row.quantity !== "string") throw new DomainError("QUANTITY_INVALID", 422);
    return {
      productVariantId: row.productVariantId,
      uomId: row.uomId,
      quantity: row.quantity,
      ...(typeof row.unitPrice === "string" ? { unitPrice: row.unitPrice } : {}),
      ...(row.priceType === "retail" || row.priceType === "wholesale" ? { priceType: row.priceType } : {}),
      ...(typeof row.lineDiscount === "string" ? { lineDiscount: row.lineDiscount } : {}),
    };
  });
}

export async function orderRoute(
  request: NextRequest,
  id?: string,
  action?: string,
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (id && !isUuid(id)) throw new DomainError("ORDER_ID_INVALID", 422);
    if (action && !["checkout", "cancel", "trace-reissue"].includes(action)) {
      throw new DomainError("ACTION_INVALID", 422);
    }
    const service = salesOrderService();

    if (request.method === "GET" && !action) {
      const actor = await resolveUserActor(request);
      if (!checkPolicy(actor, "sales:order:read").allowed) throw new DomainError("POLICY_DENIED", 403);
      return salesRead(async (tx) => {
        const ctx = { tx, actor, requestId, emit: () => {} };
        if (id) return ok(await service.view(ctx, id), requestId);
        const q = request.nextUrl.searchParams.get("q") ?? undefined;
        const status = request.nextUrl.searchParams.get("status") ?? undefined;
        const cursorId = request.nextUrl.searchParams.get("cursor") ?? undefined;
        const page = await service.list(ctx, { q, status, cursorId });
        return NextResponse.json({ data: page.items, page: { nextCursor: page.nextCursorId }, requestId });
      });
    }

    if (request.method !== "POST") throw new DomainError("METHOD_NOT_ALLOWED", 405);

    const body = assertBody(await readJson(request), [
      "sellerMembershipId", "customerPartnerId", "warehouseId", "paymentMethod",
      "paidAmount", "discountAmount", "soldAt", "note", "lines", "createSaleRecord",
    ]);

    const isCollectionCheckout = !id && action === "checkout";
    const isCreate = !id && !action;
    const isIdCheckout = !!id && action === "checkout";
    const isCancel = !!id && action === "cancel";
    const isReissue = !!id && action === "trace-reissue";

    if (!isCollectionCheckout && !isCreate && !isIdCheckout && !isCancel && !isReissue) {
      throw new DomainError("METHOD_NOT_ALLOWED", 405);
    }

    if (isCreate || isCollectionCheckout || isIdCheckout) {
      if (typeof body.warehouseId !== "string" || !isUuid(body.warehouseId)) {
        throw new DomainError("WAREHOUSE_ID_INVALID", 422);
      }
    }
    if (isCollectionCheckout || isIdCheckout) {
      if (typeof body.paymentMethod !== "string" || !PAYMENT_METHODS.includes(body.paymentMethod as PaymentMethod)) {
        throw new DomainError("PAYMENT_METHOD_INVALID", 422);
      }
      if (typeof body.paidAmount !== "string") throw new DomainError("PAID_AMOUNT_INVALID", 422);
    }
    if (body.sellerMembershipId !== undefined && !isUuid(body.sellerMembershipId as string)) {
      throw new DomainError("SELLER_ID_INVALID", 422);
    }
    if (body.customerPartnerId !== undefined && !isUuid(body.customerPartnerId as string)) {
      throw new DomainError("CUSTOMER_ID_INVALID", 422);
    }

    const version = isCancel ? parseIfMatchVersion(request.headers.get("if-match")) : null;
    if (isCancel && version === null) throw new DomainError("IF_MATCH_REQUIRED", 428);

    const key = request.headers.get("idempotency-key") ?? undefined;
    if ((isCollectionCheckout || isIdCheckout || isReissue) && !key) {
      throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", 400);
    }

    const policyAction = isCancel
      ? "sales:order:cancel"
      : isReissue
        ? "sales:order:trace:revoke"
        : isCollectionCheckout || isIdCheckout
          ? "sales:order:checkout"
          : "sales:order:create";

    const result = await runCommand({ requestId }, {
      authenticate: () => resolveUserActor(request),
      resolveTenant: async (actor) => {
        if (!("organizationId" in actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        return actor.organizationId;
      },
      action: policyAction,
      method: request.method,
      routeKey: `sales-order:${id ?? "collection"}:${action ?? "create"}`,
      payload: { body, version },
      idempotencyKey: key,
      idempotencyPort: salesIdempotency(),
      unitOfWork: salesUnitOfWork,
      async domain(ctx) {
        if (!("organizationId" in ctx.actor)) throw new DomainError("TENANT_FORBIDDEN", 403);
        const args = { tx: ctx.tx, actor: ctx.actor, requestId, emit: ctx.emit };
        if (isCancel && id && version !== null) return service.cancel(args, id, version);
        if (isReissue && id) return service.reissueTraceToken(args, id);
        if (isIdCheckout && id) {
          return service.checkout(args, {
            warehouseId: body.warehouseId as string,
            paymentMethod: body.paymentMethod as PaymentMethod,
            paidAmount: body.paidAmount as string,
            discountAmount: typeof body.discountAmount === "string" ? body.discountAmount : undefined,
            sellerMembershipId: typeof body.sellerMembershipId === "string" ? body.sellerMembershipId : undefined,
            customerPartnerId: typeof body.customerPartnerId === "string" ? body.customerPartnerId : undefined,
            soldAt: typeof body.soldAt === "string" ? body.soldAt : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
            lines: [],
            createSaleRecord: body.createSaleRecord !== false,
          }, id);
        }
        const lines = parseLines(body.lines);
        if (isCollectionCheckout) {
          return service.checkout(args, {
            warehouseId: body.warehouseId as string,
            paymentMethod: body.paymentMethod as PaymentMethod,
            paidAmount: body.paidAmount as string,
            discountAmount: typeof body.discountAmount === "string" ? body.discountAmount : undefined,
            sellerMembershipId: typeof body.sellerMembershipId === "string" ? body.sellerMembershipId : undefined,
            customerPartnerId: typeof body.customerPartnerId === "string" ? body.customerPartnerId : undefined,
            soldAt: typeof body.soldAt === "string" ? body.soldAt : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
            lines,
            createSaleRecord: body.createSaleRecord !== false,
          });
        }
        return service.createDraft(args, {
          warehouseId: body.warehouseId as string,
          sellerMembershipId: typeof body.sellerMembershipId === "string" ? body.sellerMembershipId : undefined,
          customerPartnerId: typeof body.customerPartnerId === "string" ? body.customerPartnerId : undefined,
          soldAt: typeof body.soldAt === "string" ? body.soldAt : undefined,
          note: typeof body.note === "string" ? body.note : undefined,
          lines,
          paymentMethod: typeof body.paymentMethod === "string"
            && PAYMENT_METHODS.includes(body.paymentMethod as PaymentMethod)
            ? body.paymentMethod as PaymentMethod
            : undefined,
        });
      },
    });

    return ok(result, requestId, isCreate || isCollectionCheckout ? 201 : 200);
  } catch (error) {
    return mapRouteError(error, requestId);
  }
}
