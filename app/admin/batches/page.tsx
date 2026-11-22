// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

export default function AdminBatchesPage() {
  const t = useT();
  const [productId, setProductId] = useState("");
  const [localCode, setLocalCode] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<unknown[]>([]);

  async function load() {
    const q = productId ? `?productId=${encodeURIComponent(productId)}` : "";
    const res = await adminApi(`/api/v1/batches${q}`);
    if (res.status === 403) {
      setMessage(t("admin.forbidden"));
      return;
    }
    const json = await res.json();
    setItems(json.data ?? []);
    setMessage(res.ok ? "OK" : JSON.stringify(json));
  }

  async function createBatch(e: React.FormEvent) {
    e.preventDefault();
    const res = await adminApi("/api/v1/batches", {
      method: "POST",
      body: JSON.stringify({ productId, localCode }),
    });
    const json = await res.json();
    setMessage(
      res.ok
        ? `Created ${json.data?.localCode} (${json.data?.qualityStatus})`
        : JSON.stringify(json),
    );
    if (res.ok) await load();
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("admin.batchesTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        Local lots start in inspect; quality actions require reason and version match.
      </p>
      <form onSubmit={createBatch} className="grid max-w-lg gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="productId">Product ID</Label>
          <Input
            id="productId"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="localCode">Local code</Label>
          <Input
            id="localCode"
            value={localCode}
            onChange={(e) => setLocalCode(e.target.value)}
            required
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">{t("admin.create")}</Button>
          <Button type="button" variant="outline" onClick={load}>
            {t("admin.refresh")}
          </Button>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">{message}</p>
      <pre className="overflow-auto rounded-md border border-border bg-card p-3 text-xs text-card-foreground shadow-sm">
        {JSON.stringify(items, null, 2)}
      </pre>
    </section>
  );
}
