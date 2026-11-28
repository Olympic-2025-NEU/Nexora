// SPDX-License-Identifier: AGPL-3.0-only
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/platform/identity/actor";
import { DomainError } from "@/platform/kernel/errors";
import { createDocumentService, type TradingPorts } from "./documents";
import { createReceivingService, type ReceivingPorts } from "./receivings";

type Context = {
  tx: Prisma.TransactionClient;
  actor: Actor;
  requestId: string;
  emit: (event: never) => void;
};

export type InboundSourceKind = "local" | "nexora";

export type InboundListItem = {
  id: string;
  documentNumber: string;
  sourceKind: InboundSourceKind;
  status: string;
  counterpartyLabel: string | null;
  createdAt: string;
  confirmedAt: string | null;
  href: string;
};

export function createInboundService(
  ports: TradingPorts & ReceivingPorts,
  instanceId: string,
) {
  const receipts = createDocumentService(ports);
  const receivings = createReceivingService(ports, instanceId);

  return {
    async list(
      ctx: Context,
      opts?: { sourceKind?: InboundSourceKind; status?: string; q?: string; limit?: number },
    ): Promise<{ items: InboundListItem[] }> {
      const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
      const kind = opts?.sourceKind;
      const items: InboundListItem[] = [];

      if (!kind || kind === "local") {
        const page = await receipts.list(ctx as never, "goods_receipt", opts?.status as never);
        for (const doc of page.items as Array<{
          id: string;
          documentNumber: string;
          status: string;
          createdAt: string;
          confirmedAt: string | null;
          localSupplier?: { displayName: string; code: string } | null;
        }>) {
          if (opts?.q && !doc.documentNumber.toLowerCase().includes(opts.q.toLowerCase())) continue;
          items.push({
            id: doc.id,
            documentNumber: doc.documentNumber,
            sourceKind: "local",
            status: doc.status,
            counterpartyLabel: doc.localSupplier
              ? `${doc.localSupplier.displayName} (${doc.localSupplier.code})`
              : null,
            createdAt: doc.createdAt,
            confirmedAt: doc.confirmedAt,
            href: `/trading/inbound/${doc.id}?kind=local`,
          });
        }
      }

      if (!kind || kind === "nexora") {
        const page = await receivings.list(ctx as never);
        const issuers = [
          ...new Set(
            (page.items as Array<{ sourceIssuerInstanceId: string }>).map(
              (row) => row.sourceIssuerInstanceId,
            ),
          ),
        ];
        const partners = issuers.length
          ? await ctx.tx.partner.findMany({
              where: { issuerInstanceId: { in: issuers } },
              select: { issuerInstanceId: true, displayName: true, code: true },
            })
          : [];
        const partnerByIssuer = new Map(partners.map((p) => [p.issuerInstanceId, p]));
        for (const doc of page.items as Array<{
          id: string;
          documentNumber: string;
          status: string;
          createdAt: string;
          confirmedAt: string | null;
          sourceIssuerInstanceId: string;
        }>) {
          if (opts?.status && doc.status !== opts.status) continue;
          if (opts?.q && !doc.documentNumber.toLowerCase().includes(opts.q.toLowerCase())) continue;
          const partner = partnerByIssuer.get(doc.sourceIssuerInstanceId);
          items.push({
            id: doc.id,
            documentNumber: doc.documentNumber,
            sourceKind: "nexora",
            status: doc.status,
            counterpartyLabel: partner
              ? `${partner.displayName} (${partner.code})`
              : doc.sourceIssuerInstanceId,
            createdAt: doc.createdAt,
            confirmedAt: doc.confirmedAt,
            href: `/trading/inbound/${doc.id}?kind=nexora`,
          });
        }
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items: items.slice(0, limit) };
    },

    async resolveKind(ctx: Context, id: string): Promise<InboundSourceKind> {
      const doc = await ctx.tx.document.findUnique({
        where: { id },
        select: { documentType: true },
      });
      if (!doc) throw new DomainError("DOCUMENT_NOT_FOUND", 404);
      if (doc.documentType === "goods_receipt") return "local";
      if (doc.documentType === "receiving_confirmation") return "nexora";
      throw new DomainError("NOT_INBOUND_DOCUMENT", 404);
    },
  };
}
