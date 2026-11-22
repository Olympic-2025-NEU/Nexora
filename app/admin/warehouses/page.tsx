// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

export default function AdminWarehousesPage() {
  const t = useT();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<unknown[]>([]);

  async function load() {
    const res = await adminApi("/api/v1/warehouses");
    if (res.status === 403) {
      setMessage(t("admin.forbidden"));
      return;
    }
    const json = await res.json();
    setItems(json.data ?? []);
    setMessage(res.ok ? "OK" : JSON.stringify(json));
  }

  async function createWarehouse(e: React.FormEvent) {
    e.preventDefault();
    const res = await adminApi("/api/v1/warehouses", {
      method: "POST",
      body: JSON.stringify({ code, name }),
    });
    const json = await res.json();
    setMessage(res.ok ? `Created ${json.data?.code}` : JSON.stringify(json));
    if (res.ok) await load();
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("admin.warehousesTitle")}</h1>
      <p className="text-sm text-muted-foreground">
        Archive is blocked while stock remains. Staff only see warehouses in their assigned scope.
      </p>
      <form onSubmit={createWarehouse} className="grid max-w-lg gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="code">Code</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
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
