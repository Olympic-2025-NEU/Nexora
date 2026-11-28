// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/app/lib/admin-api";

type Case = { messageId: string; eventType: string; errorCode: string | null; ageSeconds: number };
type Gap = Case & { inboxId: string; issuerInstanceId: string; state: string };
type Receipt = { transferId: string; state: string; ageSeconds: number };
type Lookup = { outbox: { outboxId: string; envelopeMessageId: string | null;
  eventType: string; status: string;
  correlationId: string | null; errorCode: string | null; attempts: { number: number;
    result: string; httpStatus: number | null; errorCode: string | null }[] }[];
  inbox: { inboxId: string; issuerInstanceId: string; messageId: string; eventType: string;
    state: string; errorCode: string | null; ackStatus: string | null }[] };
type Operations = { instanceId: string; queue: Record<string, number>; queueOldestAgeSeconds: number;
  attempts: Record<string, number>; inbox: Record<string, number>; receipts: Record<string, number>;
  deadLetters: Case[]; mappingGaps: Gap[]; receiptCases: Receipt[]; lookup: Lookup | null };

function Counts({ title, data }: { title: string; data: Record<string, number> }) {
  return <section className="rounded border border-border p-3"><h2 className="font-semibold">{title}</h2>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      {Object.entries(data).map(([key, count]) => <div key={key}><dt>{key}</dt><dd className="font-semibold">{count}</dd></div>)}
    </dl></section>;
}

export function FederationOperationsClient() {
  const [data, setData] = useState<Operations | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (messageId = "") => {
    try {
      const url = `/api/v1/admin/federation/operations${messageId ? `?messageId=${encodeURIComponent(messageId)}` : ""}`;
      const response = await adminApi(url);
      if (!response.ok) { setNotice(`Không đọc được vận hành federation (${response.status}).`); return; }
      setData(await response.json() as Operations);
      setNotice("");
    } catch { setNotice("Không kết nối được API vận hành federation."); }
  }, []);
  useEffect(() => {
    void adminApi("/api/v1/admin/federation/operations").then(async (response) => {
      if (response.ok) setData(await response.json() as Operations);
      else setNotice(`Không đọc được vận hành federation (${response.status}).`);
    }).catch(() => setNotice("Không kết nối được API vận hành federation."));
  }, []);
  async function operate(path: string, body: object) {
    setBusy(true);
    try {
      const response = await adminApi(path, { method: "POST", body: JSON.stringify(body) });
      const result = await response.json() as { code?: string; state?: string; status?: string };
      setNotice(response.ok ? `Đã ghi audit; trạng thái: ${result.state ?? result.status ?? "pending"}.` :
        `Không thực hiện được (${response.status}, ${result.code ?? "UNKNOWN"}).`);
      await load(query.trim());
    } catch { setNotice("Không kết nối được API vận hành federation."); }
    finally { setBusy(false); }
  }
  return <main className="space-y-5 p-4">
    <h1 className="text-2xl font-semibold">Vận hành federation {data?.instanceId ?? ""}</h1>
    <p className="text-sm text-muted-foreground">Tra cùng message ID trên A/B/C để đối chiếu outbox, ACK và inbox. Dữ liệu ở đây đã lọc payload và thông tin đăng nhập.</p>
    {notice && <p role="status" className="rounded border p-2 text-sm">{notice}</p>}
    {data && <><div className="grid gap-3 md:grid-cols-4">
      <Counts title={`Hàng đợi · lâu nhất ${data.queueOldestAgeSeconds}s`} data={data.queue} />
      <Counts title="Lần gửi" data={data.attempts} />
      <Counts title="Inbox" data={data.inbox} />
      <Counts title="Phiếu nhận" data={data.receipts} />
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void load(query.trim()); }}>
      <label htmlFor="federation-message-id">Message ID</label>
      <input id="federation-message-id" className="min-w-72 rounded border bg-background px-2"
        value={query} onChange={(event) => setQuery(event.target.value)} placeholder="UUID" />
      <button type="submit" className="rounded border px-3 py-1">Tra cứu</button>
      <button type="button" className="rounded border px-3 py-1" onClick={() => void load(query.trim())}>Tải lại</button>
    </form>
    {data.lookup && <section className="space-y-2 rounded border p-3 text-sm"><h2 className="font-semibold">Hành trình message</h2>
      {data.lookup.outbox.map((row) => <div key={row.outboxId} className="break-all">
        Outbox {row.outboxId} · envelope {row.envelopeMessageId ?? "—"} · {row.eventType} · {row.status} · correlation {row.correlationId ?? "—"} · lỗi {row.errorCode ?? "—"}
        <ul>{row.attempts.map((attempt) => <li key={attempt.number}>Lần {attempt.number}: {attempt.result} · HTTP {attempt.httpStatus ?? "—"} · {attempt.errorCode ?? "—"}</li>)}</ul>
      </div>)}
      {data.lookup.inbox.map((row) => <div key={row.inboxId} className="break-all">Inbox {row.issuerInstanceId}/{row.messageId} · {row.eventType} · {row.state} · ACK {row.ackStatus ?? "—"} · lỗi {row.errorCode ?? "—"}</div>)}
      {!data.lookup.outbox.length && !data.lookup.inbox.length && <p>Không tìm thấy message trên instance này.</p>}
    </section>}
    <div className="grid gap-3 lg:grid-cols-3">
      <section className="space-y-2 rounded border p-3 text-sm"><h2 className="font-semibold">Dead letter</h2>
        {data.deadLetters.map((row) => <div key={row.messageId} className="break-all border-t py-2">{row.messageId} · {row.eventType} · {row.errorCode ?? "—"} · {row.ageSeconds}s
          <button disabled={busy} className="ml-2 underline disabled:opacity-50" onClick={() => void operate("/api/v1/admin/retries", { messageId: row.messageId })}>Retry</button></div>)}
        {!data.deadLetters.length && <p>Không có.</p>}
      </section>
      <section className="space-y-2 rounded border p-3 text-sm"><h2 className="font-semibold">Inbox conflict / mapping gap</h2>
        {data.mappingGaps.map((row) => <div key={row.inboxId} className="break-all border-t py-2">{row.issuerInstanceId}/{row.messageId} · {row.state} · {row.errorCode ?? "—"} · {row.ageSeconds}s
          {row.state === "pending_dependency" && <button disabled={busy} className="ml-2 underline disabled:opacity-50" onClick={() => void operate("/api/v1/admin/federation/operations", { action: "reprocess", inboxId: row.inboxId })}>Reprocess</button>}</div>)}
        {!data.mappingGaps.length && <p>Không có.</p>}
      </section>
      <section className="space-y-2 rounded border p-3 text-sm"><h2 className="font-semibold">Phiếu nhận chờ / chênh lệch</h2>
        {data.receiptCases.map((row) => <div key={row.transferId} className="break-all border-t py-2">{row.transferId} · {row.state} · {row.ageSeconds}s</div>)}
        {!data.receiptCases.length && <p>Không có.</p>}
      </section>
    </div></>}
  </main>;
}
