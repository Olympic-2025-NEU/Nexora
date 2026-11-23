// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { useT } from "@/app/i18n/LocaleProvider";
import { adminApi } from "@/app/lib/admin-api";

type Uom = {
  id: string;
  code: string;
  name: string;
  kind: string;
  isSystemDefault: boolean;
  isActive: boolean;
  version: number;
};

export default function UomPage() {
  const t = useT();
  const [items, setItems] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("count");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/uoms");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setItems((json.data as Uom[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/uoms", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), kind }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${t("catalog.createFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      setName("");
      setKind("count");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("catalog.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("nav.uom")}
        description={t("catalog.uomHint")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t("admin.refresh")}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("catalog.colName")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colCode")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colKind")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colSystem")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colActive")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-border/70">
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {u.code}
                  </td>
                  <td className="px-3 py-2">{u.kind}</td>
                  <td className="px-3 py-2">
                    {u.isSystemDefault ? t("catalog.activeYes") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {u.isActive ? t("catalog.activeYes") : t("catalog.activeNo")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">{t("catalog.createUom")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("catalog.uomNormalizeHint")}</p>
        <form onSubmit={(e) => void create(e)} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="uom-name">{t("catalog.colName")}</Label>
            <Input
              id="uom-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CÁI"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("catalog.colKind")}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">count</SelectItem>
                <SelectItem value="mass">mass</SelectItem>
                <SelectItem value="volume">volume</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? t("admin.loading") : t("admin.create")}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
