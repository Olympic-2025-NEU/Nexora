// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/app/components/ui/button";
import { Combobox } from "@/app/components/ui/combobox";
import { DateTimePicker } from "@/app/components/ui/date-time-picker";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";
import { fetchMe, getCachedMe } from "@/app/lib/session";

const SELLER_ROLES = new Set(["administrator", "sales_clerk"]);

function memberHasSellerRole(m: { role: string; roles?: string[] }): boolean {
  const roles = m.roles?.length ? m.roles : [m.role];
  return roles.some((r) => SELLER_ROLES.has(r));
}

type IssueOption = {
  id: string;
  documentNumber: string;
  lines: { batchId: string; quantity: string; warehouseId: string }[];
};

type MemberRow = {
  id: string;
  keycloakSub?: string;
  displayName: string;
  role: string;
  roles?: string[];
  status: string;
};

type PartnerRow = {
  id: string;
  code: string;
  displayName: string;
  status: string;
};

type Sale = { id: string; documentNumber: string };

function nowLocalInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function OrderFormClient() {
  const t = useT();
  const router = useRouter();
  const [issues, setIssues] = useState<IssueOption[]>([]);
  const [sellers, setSellers] = useState<MemberRow[]>([]);
  const [customers, setCustomers] = useState<PartnerRow[]>([]);
  const [issueId, setIssueId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [soldAt, setSoldAt] = useState(nowLocalInputValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          const me = getCachedMe() ?? (await fetchMe());
          const [optRes, memRes, partnerRes] = await Promise.all([
            adminApi("/api/v1/sales-records?options=1"),
            adminApi("/api/v1/members"),
            adminApi("/api/v1/partners"),
          ]);
          if (!optRes.ok) throw new Error(t("orders.optionsFailed"));
          const optJson = await optRes.json();
          if (cancelled) return;
          setIssues(((optJson.data as { issues?: IssueOption[] })?.issues) ?? []);

          if (memRes.ok) {
            const rows = (((await memRes.json()).data as MemberRow[]) ?? []).filter(
              (m) => m.status === "active" && memberHasSellerRole(m),
            );
            setSellers(rows);
            if (rows.length > 0) {
              const match =
                rows.find(
                  (m) =>
                    me &&
                    (m.keycloakSub === me.userId || m.displayName === me.displayName),
                ) ?? rows[0];
              setSellerId(match.id);
            }
          } else if (me) {
            const fallback: MemberRow = {
              id: me.userId,
              displayName: me.displayName || me.userId,
              role: me.roles[0] ?? "sales_clerk",
              roles: me.roles,
              status: "active",
            };
            setSellers([fallback]);
            setSellerId(fallback.id);
          }

          if (partnerRes.ok) {
            const rows = (((await partnerRes.json()).data as PartnerRow[]) ?? []).filter(
              (p) => p.status === "active",
            );
            setCustomers(rows);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : t("orders.optionsFailed"));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const selected = issues.find((item) => item.id === issueId);

  const sellerOptions = useMemo(
    () => sellers.map((m) => ({ value: m.id, label: m.displayName, keywords: m.role })),
    [sellers],
  );
  const customerOptions = useMemo(
    () => customers.map((p) => ({ value: p.id, label: p.displayName, keywords: p.code })),
    [customers],
  );
  const issueOptions = useMemo(
    () => issues.map((i) => ({ value: i.id, label: i.documentNumber })),
    [issues],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { linkedIssueId: issueId };
      if (soldAt) body.soldAt = new Date(soldAt).toISOString();
      if (sellerId) body.sellerMembershipId = sellerId;
      if (customerId) body.customerPartnerId = customerId;
      const res = await adminApi("/api/v1/sales-records", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? t("orders.createFailed"));
      }
      const doc = (await res.json()).data as Sale;
      router.push(`/orders/${doc.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("orders.createTitle")}
        description={t("orders.createHint")}
        actions={
          <Button type="button" variant="outline" asChild>
            <Link href="/orders">{t("orders.backToList")}</Link>
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="max-w-2xl space-y-5 rounded-lg border border-border bg-card p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="order-issue">{t("orders.linkedIssue")}</Label>
            <Combobox
              id="order-issue"
              value={issueId}
              onChange={setIssueId}
              options={issueOptions}
              placeholder={t("orders.pickIssue")}
              searchPlaceholder={t("orders.pickIssue")}
              aria-label={t("orders.linkedIssue")}
            />
            <p className="text-xs text-muted-foreground">{t("orders.linkedIssueHint")}</p>
          </div>

          {selected ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t("orders.issueLines")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {selected.lines.map((line, index) => (
                  <li key={`${line.batchId}-${index}`} className="font-mono text-xs">
                    {line.batchId.slice(0, 8)}… · {line.quantity} · {line.warehouseId.slice(0, 8)}…
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="order-seller">{t("pos.seller")}</Label>
              <Combobox
                id="order-seller"
                value={sellerId}
                onChange={setSellerId}
                options={sellerOptions}
                placeholder={t("pos.sellerPlaceholder")}
                searchPlaceholder={t("pos.sellerSearch")}
                disabled={sellerOptions.length === 0}
                aria-label={t("pos.seller")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-sold-at">{t("pos.soldAt")}</Label>
              <DateTimePicker
                id="order-sold-at"
                mode="datetime"
                value={soldAt}
                onChange={setSoldAt}
                placeholder={t("pos.soldAtPlaceholder")}
                aria-label={t("pos.soldAt")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="order-customer">{t("pos.customer")}</Label>
            <Combobox
              id="order-customer"
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              placeholder={t("pos.customerPlaceholder")}
              searchPlaceholder={t("pos.customerSearch")}
              emptyLabel={t("pos.customerNone")}
              aria-label={t("pos.customer")}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={busy || !issueId}>
              {busy ? t("admin.loading") : t("orders.create")}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/orders">{t("catalog.cancel")}</Link>
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
