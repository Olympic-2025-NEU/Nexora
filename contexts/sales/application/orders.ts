// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import type { OutboxEventInput } from "@/platform/outbox/message";
import { DomainError } from "@/platform/kernel/errors";
import { passportBaseUrl } from "@/contexts/traceability/application/qr-token";
import {
  createDocumentService,
  type DocumentInput,
  type LineInput,
  type TradingPorts,
} from "@/contexts/trading/application/documents";
import { createSaleService } from "@/contexts/trading/application/sales";
import { convertToStock } from "@/contexts/trading/application/uom-conversion";
import {
  allocateOrderNumber,
  assertMoney,
  assertPositiveQuantity,
  orderNumberDayKey,
  orderNumberPrefix,
  type PaymentMethod,
  type SalesOrderLineInput,
} from "../domain/sales-order";
import { allocateFefo } from "./fefo";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const newTraceToken = () => randomBytes(32).toString("base64url");

type Context = {
  tx: Prisma.TransactionClient;
  actor: Actor;
  requestId: string;
  emit(event: OutboxEventInput): void;
};

export type SalesOrderPorts = {
  trading: TradingPorts;
  saleAudit: Parameters<typeof createSaleService>[0];
  publicBaseUrl?: string;
};

export type CheckoutInput = {
  sellerMembershipId?: string;
  customerPartnerId?: string;
  warehouseId: string;
  paymentMethod: PaymentMethod;
  paidAmount: string;
  discountAmount?: string;
  soldAt?: string;
  note?: string;
  lines: SalesOrderLineInput[];
  createSaleRecord?: boolean;
};

function money(d: Decimal) {
  return d.toFixed(3);
}

type OrderDisplay = {
  sellerDisplayName?: string | null;
  customerDisplayName?: string | null;
  customerCode?: string | null;
  linkedIssueNumber?: string | null;
  productNames?: Map<string, string>;
  variantSkus?: Map<string, string | null>;
  uomNames?: Map<string, string>;
  batchCodes?: Map<string, string>;
};

function toView(order: {
  id: string;
  orderNumber: string;
  status: string;
  version: number;
  currency: string;
  subtotalAmount: Decimal;
  discountAmount: Decimal;
  totalAmount: Decimal;
  paidAmount: Decimal;
  paymentMethod: string;
  paidAt: Date | null;
  soldAt: Date;
  sellerMembershipId: string | null;
  customerPartnerId: string | null;
  linkedIssueId: string | null;
  linkedSaleId: string | null;
  note: string | null;
  createdAt: Date;
  lines?: {
    id: string;
    lineNo: number;
    productId: string;
    productVariantId: string;
    uomId: string;
    quantity: Decimal;
    unitPrice: Decimal;
    priceType: string;
    lineDiscount: Decimal;
    lineTotal: Decimal;
    lots?: {
      id: string;
      lineNo: number;
      warehouseId: string;
      batchId: string;
      productVariantId: string;
      quantity: Decimal;
      sourceIssueLineId: string | null;
    }[];
  }[];
  tokens?: { id: string; status: string; qrPath: string | null; createdAt: Date }[];
}, extras?: { publicTraceToken?: string; qrUrl?: string | null; display?: OrderDisplay }) {
  const active = order.tokens?.find((t) => t.status === "active");
  const display = extras?.display;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    version: order.version,
    currency: order.currency,
    subtotalAmount: money(order.subtotalAmount),
    discountAmount: money(order.discountAmount),
    totalAmount: money(order.totalAmount),
    paidAmount: money(order.paidAmount),
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt?.toISOString() ?? null,
    soldAt: order.soldAt.toISOString(),
    sellerMembershipId: order.sellerMembershipId,
    sellerDisplayName: display?.sellerDisplayName ?? null,
    customerPartnerId: order.customerPartnerId,
    customerDisplayName: display?.customerDisplayName ?? null,
    customerCode: display?.customerCode ?? null,
    linkedIssueId: order.linkedIssueId,
    linkedIssueNumber: display?.linkedIssueNumber ?? null,
    linkedSaleId: order.linkedSaleId,
    note: order.note,
    createdAt: order.createdAt.toISOString(),
    lines: (order.lines ?? []).map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      productId: line.productId,
      productName: display?.productNames?.get(line.productId) ?? null,
      productVariantId: line.productVariantId,
      variantSku: display?.variantSkus?.get(line.productVariantId) ?? null,
      uomId: line.uomId,
      uomName: display?.uomNames?.get(line.uomId) ?? null,
      quantity: money(line.quantity),
      unitPrice: money(line.unitPrice),
      priceType: line.priceType,
      lineDiscount: money(line.lineDiscount),
      lineTotal: money(line.lineTotal),
      lots: (line.lots ?? []).map((lot) => ({
        id: lot.id,
        invoiceItemId: lot.id,
        lineNo: lot.lineNo,
        warehouseId: lot.warehouseId,
        batchId: lot.batchId,
        batchLocalCode: display?.batchCodes?.get(lot.batchId) ?? null,
        productVariantId: lot.productVariantId,
        quantity: money(lot.quantity),
        sourceIssueLineId: lot.sourceIssueLineId,
      })),
    })),
    activeTraceTokenId: active?.id ?? null,
    qrPath: active?.qrPath ?? null,
    qrUrl: extras?.qrUrl ?? null,
    publicTraceToken: extras?.publicTraceToken,
  };
}

export function createSalesOrderService(ports: SalesOrderPorts) {
  const docs = createDocumentService(ports.trading);
  const sales = createSaleService(ports.saleAudit);

  async function loadOrder(tx: Prisma.TransactionClient, id: string) {
    return tx.salesOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { lots: { orderBy: { lineNo: "asc" } } }, orderBy: { lineNo: "asc" } },
        tokens: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async function resolveWarehouse(ctx: Context, warehouseId: string) {
    if (!ctx.actor.roles.includes("administrator") && !ctx.actor.unitIds.includes(warehouseId)) {
      throw new DomainError("WAREHOUSE_SCOPE_REQUIRED", 403);
    }
    const wh = await ctx.tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh || wh.status !== "active") throw new DomainError("WAREHOUSE_NOT_ACTIVE", 422);
    return wh;
  }

  async function resolvePrice(
    tx: Prisma.TransactionClient,
    variantId: string,
    uomId: string,
    priceType: "retail" | "wholesale",
    override?: string,
  ) {
    const list = await tx.priceList.findFirst({
      where: { isDefault: true, deletedAt: null, isActive: true },
      include: {
        items: {
          where: { productVariantId: variantId, uomId, priceType, isActive: true },
          take: 1,
        },
      },
    });
    if (!list) throw new DomainError("PRICE_LIST_NOT_FOUND", 422);
    if (override !== undefined) {
      assertMoney(override, "UNIT_PRICE_INVALID");
      return { amount: new Decimal(override), currency: list.currency, priceListItemId: list.items[0]?.id ?? null };
    }
    const item = list.items[0];
    if (!item) throw new DomainError("PRICE_NOT_FOUND", 422);
    return { amount: item.amount, currency: list.currency, priceListItemId: item.id };
  }

  async function buildLines(ctx: Context, lines: SalesOrderLineInput[]) {
    if (!lines.length) throw new DomainError("LINES_REQUIRED", 422);
    if (lines.length > 100) throw new DomainError("TOO_MANY_LINES", 422);
    const prepared: {
      id: string;
      lineNo: number;
      productId: string;
      productVariantId: string;
      uomId: string;
      quantity: Decimal;
      unitPrice: Decimal;
      priceType: "retail" | "wholesale";
      lineDiscount: Decimal;
      lineTotal: Decimal;
      priceListItemId: string | null;
      stockQuantity: string;
      currency: string;
    }[] = [];
    let currency: string | null = null;
    let subtotal = new Decimal(0);

    for (const [index, line] of lines.entries()) {
      assertPositiveQuantity(line.quantity);
      const priceType = line.priceType ?? "retail";
      const variant = await ctx.tx.productVariant.findUnique({
        where: { id: line.productVariantId },
        include: { product: true, uoms: { include: { uom: true } } },
      });
      if (!variant || variant.deletedAt || !variant.isActive || variant.product.deletedAt || !variant.product.isActive) {
        throw new DomainError("VARIANT_NOT_FOUND", 422);
      }
      const uoms = variant.uoms.map((item) => ({
        uomId: item.uomId,
        isStockKeeping: item.isStockKeeping,
        factorToStockUom: item.factorToStockUom.toFixed(),
      }));
      const converted = convertToStock(line.quantity, line.uomId, uoms);
      const priced = await resolvePrice(ctx.tx, variant.id, line.uomId, priceType, line.unitPrice);
      if (currency && currency !== priced.currency) throw new DomainError("CURRENCY_MISMATCH", 422);
      currency = priced.currency;
      const discount = new Decimal(line.lineDiscount ?? "0");
      assertMoney(discount.toFixed(3), "LINE_DISCOUNT_INVALID");
      const qty = new Decimal(line.quantity);
      const lineTotal = qty.mul(priced.amount).minus(discount);
      if (lineTotal.lt(0)) throw new DomainError("LINE_TOTAL_INVALID", 422);
      subtotal = subtotal.plus(lineTotal);
      prepared.push({
        id: randomUUID(),
        lineNo: index + 1,
        productId: variant.productId,
        productVariantId: variant.id,
        uomId: line.uomId,
        quantity: qty,
        unitPrice: priced.amount,
        priceType,
        lineDiscount: discount,
        lineTotal,
        priceListItemId: priced.priceListItemId,
        stockQuantity: converted.stockQuantity,
        currency: priced.currency,
      });
    }
    return { prepared, currency: currency!, subtotal };
  }

  async function mintToken(ctx: Context, orderId: string) {
    const order = await loadOrder(ctx.tx, orderId);
    if (!order || order.status !== "fulfilled") throw new DomainError("ORDER_NOT_FULFILLED", 409);
    const lots = order.lines.flatMap((line) => line.lots);
    if (!lots.length) return { publicTraceToken: undefined as string | undefined, qrUrl: null as string | null };

    const existing = order.tokens.find((t) => t.status === "active");
    if (existing) {
      // Idempotent: no raw token to re-return
      return { publicTraceToken: undefined, qrUrl: null, tokenId: existing.id, qrPath: existing.qrPath };
    }

    const org = await ctx.tx.organization.findUnique({ where: { singletonSlot: 1 } });
    const snapshotLines = [];
    for (const line of order.lines) {
      const product = await ctx.tx.product.findUnique({ where: { id: line.productId }, select: { name: true } });
      const uom = await ctx.tx.uom.findUnique({ where: { id: line.uomId }, select: { name: true } });
      for (const lot of line.lots) {
        const batch = await ctx.tx.batch.findUnique({
          where: { id: lot.batchId },
          select: { localCode: true, originLotId: true, originIssuerInstanceId: true, expiresOn: true },
        });
        snapshotLines.push({
          invoiceItemId: lot.id,
          productName: product?.name ?? "",
          quantity: money(lot.quantity),
          uomName: uom?.name ?? "",
          batchPublicCode: batch?.localCode ?? "",
          originSummary: batch ? `${batch.originIssuerInstanceId}/${batch.originLotId}` : undefined,
          expiresOn: batch?.expiresOn?.toISOString().slice(0, 10) ?? undefined,
        });
      }
    }

    const snapshot = {
      orderNumber: order.orderNumber,
      soldAt: order.soldAt.toISOString(),
      orgDisplayName: org?.name ?? "Nexora",
      lines: snapshotLines,
    };

    const raw = newTraceToken();
    const tokenId = randomUUID();
    const qrPath = `/trace/${raw}`;
    await ctx.tx.orderTraceToken.create({
      data: {
        id: tokenId,
        orderId,
        tokenHash: sha(raw),
        status: "active",
        snapshotJson: snapshot,
        qrPath,
        createdBySub: ctx.actor.userId,
      },
    });
    await ctx.tx.salesOrder.update({
      where: { id: orderId },
      data: { activeTraceTokenId: tokenId, updatedAt: new Date() },
    });

    let qrUrl: string | null = null;
    try {
      const base = passportBaseUrl(ports.publicBaseUrl ?? process.env.PUBLIC_BASE_URL);
      qrUrl = new URL(qrPath, base).toString();
    } catch {
      qrUrl = qrPath;
    }
    return { publicTraceToken: raw, qrUrl, tokenId, qrPath };
  }

  function resolveQrUrl(qrPath: string | null | undefined): string | null {
    if (!qrPath) return null;
    if (qrPath.startsWith("http://") || qrPath.startsWith("https://")) return qrPath;
    try {
      const base = passportBaseUrl(ports.publicBaseUrl ?? process.env.PUBLIC_BASE_URL);
      return new URL(qrPath, base).toString();
    } catch {
      return qrPath;
    }
  }

  async function enrichDisplay(
    tx: Prisma.TransactionClient,
    order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>,
  ): Promise<OrderDisplay> {
    const productIds = [...new Set(order.lines.map((l) => l.productId))];
    const variantIds = [...new Set(order.lines.map((l) => l.productVariantId))];
    const uomIds = [...new Set(order.lines.map((l) => l.uomId))];
    const batchIds = [...new Set(order.lines.flatMap((l) => l.lots.map((lot) => lot.batchId)))];

    const [products, variants, uoms, batches, seller, customer, issue] = await Promise.all([
      productIds.length
        ? tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      variantIds.length
        ? tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, barcode: true },
          })
        : Promise.resolve([]),
      uomIds.length
        ? tx.uom.findMany({ where: { id: { in: uomIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      batchIds.length
        ? tx.batch.findMany({ where: { id: { in: batchIds } }, select: { id: true, localCode: true } })
        : Promise.resolve([]),
      order.sellerMembershipId
        ? tx.membership.findUnique({
            where: { id: order.sellerMembershipId },
            select: { displayName: true },
          })
        : Promise.resolve(null),
      order.customerPartnerId
        ? tx.partner.findUnique({
            where: { id: order.customerPartnerId },
            select: { displayName: true, code: true },
          })
        : Promise.resolve(null),
      order.linkedIssueId
        ? tx.document.findUnique({
            where: { id: order.linkedIssueId },
            select: { documentNumber: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      sellerDisplayName: seller?.displayName ?? null,
      customerDisplayName: customer?.displayName ?? null,
      customerCode: customer?.code ?? null,
      linkedIssueNumber: issue?.documentNumber ?? null,
      productNames: new Map(products.map((p) => [p.id, p.name])),
      variantSkus: new Map(variants.map((v) => [v.id, v.sku ?? v.barcode])),
      uomNames: new Map(uoms.map((u) => [u.id, u.name])),
      batchCodes: new Map(batches.map((b) => [b.id, b.localCode])),
    };
  }

  async function view(ctx: Context, id: string) {
    const order = await loadOrder(ctx.tx, id);
    if (!order) throw new DomainError("ORDER_NOT_FOUND", 404);
    const active = order.tokens.find((t) => t.status === "active");
    const display = await enrichDisplay(ctx.tx, order);
    return toView(order, { qrUrl: resolveQrUrl(active?.qrPath ?? null), display });
  }

  async function nextDailyOrderNumber(tx: Prisma.TransactionClient, at: Date = new Date()): Promise<string> {
    const dayPrefix = orderNumberPrefix(orderNumberDayKey(at));
    const rows = await tx.salesOrder.findMany({
      where: { orderNumber: { startsWith: dayPrefix } },
      select: { orderNumber: true },
    });
    return allocateOrderNumber(
      rows.map((r) => r.orderNumber),
      at,
    );
  }

  return {
    view,

    async list(ctx: Context, opts?: { status?: string; cursorId?: string; limit?: number; q?: string }) {
      const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
      const where: Prisma.SalesOrderWhereInput = {
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.q ? { orderNumber: { contains: opts.q, mode: "insensitive" } } : {}),
      };
      const items = await ctx.tx.salesOrder.findMany({
        where,
        include: {
          lines: { include: { lots: true }, orderBy: { lineNo: "asc" } },
          tokens: true,
        },
        orderBy: [{ soldAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(opts?.cursorId ? { cursor: { id: opts.cursorId }, skip: 1 } : {}),
      });
      const page = items.slice(0, limit);
      const sellerIds = [...new Set(page.map((r) => r.sellerMembershipId).filter(Boolean))] as string[];
      const customerIds = [...new Set(page.map((r) => r.customerPartnerId).filter(Boolean))] as string[];
      const [sellers, customers] = await Promise.all([
        sellerIds.length
          ? ctx.tx.membership.findMany({
              where: { id: { in: sellerIds } },
              select: { id: true, displayName: true },
            })
          : Promise.resolve([] as { id: string; displayName: string }[]),
        customerIds.length
          ? ctx.tx.partner.findMany({
              where: { id: { in: customerIds } },
              select: { id: true, displayName: true, code: true },
            })
          : Promise.resolve([] as { id: string; displayName: string; code: string }[]),
      ]);
      const sellerById = new Map(sellers.map((s) => [s.id, s.displayName]));
      const customerById = new Map(customers.map((c) => [c.id, c]));
      return {
        items: page.map((row) => {
          const active = row.tokens.find((t) => t.status === "active");
          const customer = row.customerPartnerId
            ? customerById.get(row.customerPartnerId)
            : undefined;
          return toView(row, {
            qrUrl: resolveQrUrl(active?.qrPath ?? null),
            display: {
              sellerDisplayName: row.sellerMembershipId
                ? sellerById.get(row.sellerMembershipId) ?? null
                : null,
              customerDisplayName: customer?.displayName ?? null,
              customerCode: customer?.code ?? null,
            },
          });
        }),
        nextCursorId: items.length > limit ? page[page.length - 1]!.id : null,
      };
    },

    async createDraft(ctx: Context, input: {
      sellerMembershipId?: string;
      customerPartnerId?: string;
      warehouseId: string;
      soldAt?: string;
      note?: string;
      lines: SalesOrderLineInput[];
      paymentMethod?: PaymentMethod;
    }) {
      await resolveWarehouse(ctx, input.warehouseId);
      const { prepared, currency, subtotal } = await buildLines(ctx, input.lines);
      const id = randomUUID();
      const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
      if (!Number.isFinite(soldAt.getTime())) throw new DomainError("INVALID_SOLD_AT", 422);
      await ctx.tx.salesOrder.create({
        data: {
          id,
          orderNumber: await nextDailyOrderNumber(ctx.tx, soldAt),
          status: "draft",
          sellerMembershipId: input.sellerMembershipId ?? null,
          customerPartnerId: input.customerPartnerId ?? null,
          currency,
          subtotalAmount: subtotal,
          discountAmount: new Decimal(0),
          totalAmount: subtotal,
          paidAmount: new Decimal(0),
          paymentMethod: input.paymentMethod ?? "cash",
          soldAt,
          createdBySub: ctx.actor.userId,
          correlationId: ctx.requestId,
          note: input.note ?? null,
          lines: {
            create: prepared.map((line) => ({
              id: line.id,
              lineNo: line.lineNo,
              productId: line.productId,
              productVariantId: line.productVariantId,
              uomId: line.uomId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              priceType: line.priceType,
              lineDiscount: line.lineDiscount,
              lineTotal: line.lineTotal,
              priceListItemId: line.priceListItemId,
            })),
          },
        },
      });
      return view(ctx, id);
    },

    async checkout(ctx: Context, input: CheckoutInput, existingOrderId?: string) {
      await resolveWarehouse(ctx, input.warehouseId);
      assertMoney(input.paidAmount, "PAID_AMOUNT_INVALID");
      const discount = new Decimal(input.discountAmount ?? "0");
      assertMoney(discount.toFixed(3), "DISCOUNT_INVALID");

      let orderId = existingOrderId;
      let preparedLines: Awaited<ReturnType<typeof buildLines>>["prepared"];
      let currency: string;
      let subtotal: Decimal;

      if (orderId) {
        const existing = await loadOrder(ctx.tx, orderId);
        if (!existing) throw new DomainError("ORDER_NOT_FOUND", 404);
        if (existing.status === "fulfilled") {
          const token = existing.tokens.find((t) => t.status === "active");
          const display = await enrichDisplay(ctx.tx, existing);
          return toView(existing, { qrUrl: resolveQrUrl(token?.qrPath ?? null), display });
        }
        if (existing.status !== "draft" && existing.status !== "paid") {
          throw new DomainError("WRONG_STATE", 409);
        }
        preparedLines = existing.lines.map((line) => ({
          id: line.id,
          lineNo: line.lineNo,
          productId: line.productId,
          productVariantId: line.productVariantId,
          uomId: line.uomId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          priceType: line.priceType as "retail" | "wholesale",
          lineDiscount: line.lineDiscount,
          lineTotal: line.lineTotal,
          priceListItemId: null,
          stockQuantity: line.quantity.toFixed(3),
          currency: existing.currency,
        }));
        // Recompute stock qty via conversion
        for (const line of preparedLines) {
          const variant = await ctx.tx.productVariant.findUnique({
            where: { id: line.productVariantId },
            include: { uoms: true },
          });
          if (!variant) throw new DomainError("VARIANT_NOT_FOUND", 422);
          const converted = convertToStock(
            line.quantity.toFixed(3),
            line.uomId,
            variant.uoms.map((u) => ({
              uomId: u.uomId,
              isStockKeeping: u.isStockKeeping,
              factorToStockUom: u.factorToStockUom.toFixed(),
            })),
          );
          line.stockQuantity = converted.stockQuantity;
        }
        currency = existing.currency;
        subtotal = existing.subtotalAmount;
      } else {
        const built = await buildLines(ctx, input.lines);
        preparedLines = built.prepared;
        currency = built.currency;
        subtotal = built.subtotal;
        orderId = randomUUID();
        const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
        if (!Number.isFinite(soldAt.getTime())) throw new DomainError("INVALID_SOLD_AT", 422);
        const total = Decimal.max(subtotal.minus(discount), new Decimal(0));
        await ctx.tx.salesOrder.create({
          data: {
            id: orderId,
            orderNumber: await nextDailyOrderNumber(ctx.tx, soldAt),
            status: "draft",
            sellerMembershipId: input.sellerMembershipId ?? null,
            customerPartnerId: input.customerPartnerId ?? null,
            currency,
            subtotalAmount: subtotal,
            discountAmount: discount,
            totalAmount: total,
            paidAmount: new Decimal(0),
            paymentMethod: input.paymentMethod,
            soldAt,
            createdBySub: ctx.actor.userId,
            correlationId: ctx.requestId,
            note: input.note ?? null,
            lines: {
              create: preparedLines.map((line) => ({
                id: line.id,
                lineNo: line.lineNo,
                productId: line.productId,
                productVariantId: line.productVariantId,
                uomId: line.uomId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                priceType: line.priceType,
                lineDiscount: line.lineDiscount,
                lineTotal: line.lineTotal,
                priceListItemId: line.priceListItemId,
              })),
            },
          },
        });
      }

      const org = await ctx.tx.organization.findUnique({ where: { singletonSlot: 1 } });
      const timezone = org?.timezone ?? "UTC";
      const totalAmount = Decimal.max(subtotal.minus(discount), new Decimal(0));
      const paid = new Decimal(input.paidAmount);
      if (input.paymentMethod === "cash" && paid.lt(totalAmount)) {
        throw new DomainError("PAID_INSUFFICIENT", 422);
      }

      // FEFO allocate per line
      const issueLines: LineInput[] = [];
      const lotRows: {
        id: string;
        orderLineId: string;
        lineNo: number;
        warehouseId: string;
        batchId: string;
        productVariantId: string;
        quantity: string;
      }[] = [];

      for (const line of preparedLines) {
        const lots = await allocateFefo(ctx.tx, {
          warehouseId: input.warehouseId,
          productVariantId: line.productVariantId,
          quantity: line.stockQuantity,
          timezone,
        });
        let lotNo = 0;
        for (const lot of lots) {
          lotNo += 1;
          const lotId = randomUUID();
          lotRows.push({
            id: lotId,
            orderLineId: line.id,
            lineNo: lotNo,
            warehouseId: lot.warehouseId,
            batchId: lot.batchId,
            productVariantId: lot.productVariantId,
            quantity: lot.quantity,
          });
          issueLines.push({
            warehouseId: lot.warehouseId,
            productVariantId: lot.productVariantId,
            batchId: lot.batchId,
            quantity: lot.quantity,
            uomId: (await ctx.tx.productVariantUom.findFirst({
              where: { productVariantId: line.productVariantId, isStockKeeping: true },
            }))!.uomId,
          });
        }
      }

      const existingLotCount = await ctx.tx.salesOrderLineLot.count({
        where: { orderLineId: { in: preparedLines.map((l) => l.id) } },
      });
      if (existingLotCount > 0) throw new DomainError("ORDER_LOTS_ALREADY_ALLOCATED", 409);
      if (lotRows.length) {
        await ctx.tx.salesOrderLineLot.createMany({ data: lotRows });
      }

      const paidAt = new Date();
      await ctx.tx.salesOrder.update({
        where: { id: orderId },
        data: {
          status: "paid",
          discountAmount: discount,
          totalAmount,
          paidAmount: paid,
          paymentMethod: input.paymentMethod,
          paidAt,
          sellerMembershipId: input.sellerMembershipId ?? undefined,
          customerPartnerId: input.customerPartnerId ?? undefined,
          note: input.note ?? undefined,
          updatedAt: paidAt,
          version: { increment: 1 },
        },
      });

      const giInput: DocumentInput = { purpose: "sale", lines: issueLines, note: `POS ${orderId}` };
      const gi = await docs.createAndConfirmSaleIssue(ctx, giInput);
      const issueDoc = await ctx.tx.document.findUnique({
        where: { id: gi.id },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
      if (!issueDoc) throw new DomainError("DOCUMENT_NOT_FOUND", 404);

      // Map source issue lines onto lots (same order as issue lines)
      for (let i = 0; i < lotRows.length; i++) {
        const issueLine = issueDoc.lines[i];
        if (!issueLine) break;
        await ctx.tx.salesOrderLineLot.update({
          where: { id: lotRows[i]!.id },
          data: { sourceIssueLineId: issueLine.id },
        });
      }

      let linkedSaleId: string | null = null;
      if (input.createSaleRecord !== false) {
        try {
          const soldAtIso = new Date(
            Math.min(Date.now(), (await loadOrder(ctx.tx, orderId))!.soldAt.getTime()),
          ).toISOString();
          const sale = await sales.create(ctx, {
            linkedIssueId: gi.id,
            soldAt: soldAtIso,
            sellerMembershipId: input.sellerMembershipId,
            customerPartnerId: input.customerPartnerId,
          });
          const confirmed = await sales.confirm(ctx, sale.id, sale.version);
          linkedSaleId = confirmed.id;
        } catch (err) {
          // Optional continuity only — stock already moved on GI confirm.
          if (!(err instanceof DomainError && (
            err.code === "SALE_ALREADY_EXISTS" ||
            err.code === "POLICY_DENIED" ||
            err.code === "INVALID_SOLD_AT" ||
            err.code === "SELLER_NOT_FOUND" ||
            err.code === "SELLER_ROLE_INVALID"
          ))) {
            throw err;
          }
        }
      }

      await ctx.tx.salesOrder.update({
        where: { id: orderId },
        data: {
          status: "fulfilled",
          linkedIssueId: gi.id,
          linkedSaleId,
          updatedAt: new Date(),
          version: { increment: 1 },
        },
      });

      const minted = await mintToken(ctx, orderId);
      const order = await loadOrder(ctx.tx, orderId);
      const display = await enrichDisplay(ctx.tx, order!);
      return toView(order!, {
        publicTraceToken: minted.publicTraceToken,
        qrUrl: minted.qrUrl,
        display,
      });
    },

    async cancel(ctx: Context, id: string, expectedVersion: number) {
      const order = await loadOrder(ctx.tx, id);
      if (!order) throw new DomainError("ORDER_NOT_FOUND", 404);
      if (order.version !== expectedVersion) throw new DomainError("VERSION_CONFLICT", 409);
      if (order.status !== "draft" && order.status !== "paid") throw new DomainError("WRONG_STATE", 409);
      if (order.linkedIssueId) throw new DomainError("ORDER_ALREADY_ISSUED", 409);
      await ctx.tx.salesOrder.update({
        where: { id },
        data: { status: "cancelled", version: { increment: 1 }, updatedAt: new Date() },
      });
      return view(ctx, id);
    },

    async reissueTraceToken(ctx: Context, id: string) {
      const order = await loadOrder(ctx.tx, id);
      if (!order) throw new DomainError("ORDER_NOT_FOUND", 404);
      if (order.status !== "fulfilled") throw new DomainError("ORDER_NOT_FULFILLED", 409);
      const active = order.tokens.filter((t) => t.status === "active");
      for (const token of active) {
        await ctx.tx.orderTraceToken.update({
          where: { id: token.id },
          data: { status: "revoked", revokedAt: new Date() },
        });
      }
      await ctx.tx.salesOrder.update({
        where: { id },
        data: { activeTraceTokenId: null, updatedAt: new Date() },
      });
      const minted = await mintToken(ctx, id);
      const refreshed = await loadOrder(ctx.tx, id);
      const display = await enrichDisplay(ctx.tx, refreshed!);
      return toView(refreshed!, {
        publicTraceToken: minted.publicTraceToken,
        qrUrl: minted.qrUrl,
        display,
      });
    },
  };
}
