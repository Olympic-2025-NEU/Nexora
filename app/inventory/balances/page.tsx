// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

export default function AdminInventoryPage() {
  const t = useT();
  const [warehouseId, setWarehouseId] = useState("");
  const [balances, setBalances] = useState<unknown[]>([]);
  const [movements, setMovements] = useState<unknown[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const q = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [b, m] = await Promise.all([
      adminApi(`/api/v1/inventory/balances${q}`),
      adminApi(`/api/v1/inventory/movements${q}`),
    ]);
    if (b.status === 403 || m.status === 403) {
      setMessage(t("admin.forbidden"));
      return;
    }
    const bj = await b.json();
    const mj = await m.json();
    setBalances(bj.data ?? []);
    setMovements(mj.data ?? []);
    setMessage(b.ok && m.ok ? "OK" : JSON.stringify({ balances: bj, movements: mj }));
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("admin.inventoryTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        Read-only balances and movements.
      </p>
      <div className="flex max-w-lg flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="warehouseId">Warehouse ID (optional)</Label>
          <Input
            id="warehouseId"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          />
        </div>
        <Button type="button" onClick={load}>
          {t("admin.refresh")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-medium">Balances</h2>
          <pre className="overflow-auto rounded-md border border-border bg-card p-3 text-xs text-card-foreground shadow-sm">
            {JSON.stringify(balances, null, 2)}
          </pre>
        </div>
        <div>
          <h2 className="mb-2 font-medium">Movements</h2>
          <pre className="overflow-auto rounded-md border border-border bg-card p-3 text-xs text-card-foreground shadow-sm">
            {JSON.stringify(movements, null, 2)}
          </pre>
        </div>
      </div>
    </section>
  );
}
