// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Category = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
};

function depthOf(
  id: string,
  byId: Map<string, Category>,
  memo: Map<string, number>,
): number {
  if (memo.has(id)) return memo.get(id)!;
  const node = byId.get(id);
  if (!node?.parentId) {
    memo.set(id, 0);
    return 0;
  }
  const d = depthOf(node.parentId, byId, memo) + 1;
  memo.set(id, d);
  return d;
}

export default function CategoriesPage() {
  const t = useT();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("__root__");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/categories");
      if (res.status === 403) throw new Error(t("admin.forbidden"));
      if (!res.ok) throw new Error(`${t("admin.loadFailed")} (${res.status})`);
      const json = await res.json();
      setItems((json.data as Category[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const byId = new Map(items.map((c) => [c.id, c]));
    const depths = new Map<string, number>();
    return [...items].sort((a, b) => {
      const da = depthOf(a.id, byId, depths);
      const db = depthOf(b.id, byId, depths);
      if (da !== db) return da - db;
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    });
  }, [items]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await adminApi("/api/v1/categories", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          ...(parentId !== "__root__" ? { parentId } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          `${t("catalog.createFailed")} (${res.status}${json.error ? `: ${json.error}` : ""})`,
        );
      }
      setCode("");
      setName("");
      setParentId("__root__");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("catalog.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  const byId = useMemo(() => new Map(items.map((c) => [c.id, c])), [items]);
  const depths = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) depthOf(c.id, byId, m);
    return m;
  }, [items, byId]);

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={t("nav.categories")}
        description={t("catalog.categoriesHint")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t("admin.refresh")}
          </Button>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("catalog.colName")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colCode")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colParent")}</th>
                <th className="px-3 py-2 font-medium">{t("catalog.colActive")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const depth = depths.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-medium">
                      <span style={{ paddingLeft: `${depth * 1.25}rem` }}>{c.name}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {c.code}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.parentId ? byId.get(c.parentId)?.name ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {c.isActive ? t("catalog.activeYes") : t("catalog.activeNo")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">{t("catalog.createCategory")}</h2>
        <form onSubmit={(e) => void create(e)} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-code">{t("catalog.colCode")}</Label>
            <Input
              id="cat-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t("catalog.colName")}</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>{t("catalog.colParent")}</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">{t("catalog.rootCategory")}</SelectItem>
                {items.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={creating || !code.trim() || !name.trim()}>
              {creating ? t("admin.loading") : t("admin.create")}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
