// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

export default function AdminProductsPage() {
  const t = useT();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState("EA");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<unknown[]>([]);

  async function load() {
    setMessage(t("admin.loading"));
    const res = await adminApi("/api/v1/products");
    if (res.status === 403) {
      setMessage(t("admin.forbidden"));
      return;
    }
    const json = await res.json();
    setItems(json.data ?? []);
    setMessage(res.ok ? "OK" : JSON.stringify(json));
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setMessage(t("admin.loading"));
    const res = await adminApi("/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ sku, name, baseUnit }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Created ${json.data?.sku}` : JSON.stringify(json));
    if (res.ok) await load();
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("admin.productsTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        SKU and base unit cannot be changed after create.
      </p>
      <form onSubmit={createProduct} className="grid max-w-lg gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label>Base unit</Label>
          <Select value={baseUnit} onValueChange={setBaseUnit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EA">EA</SelectItem>
              <SelectItem value="KG">KG</SelectItem>
              <SelectItem value="L">L</SelectItem>
            </SelectContent>
          </Select>
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
