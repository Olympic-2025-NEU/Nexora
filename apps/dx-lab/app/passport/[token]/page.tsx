// SPDX-License-Identifier: AGPL-3.0-only
import { StatusBanner } from "../../../components/h/status-banner";
import { ApiError, getPublicPassport } from "../../../lib/api-client/client";

async function loadPassport(token: string) {
  try {
    return { passport: await getPublicPassport(token) };
  } catch (error) {
    return {
      error: error instanceof ApiError && error.status === 404
        ? "Token không hợp lệ hoặc đã thu hồi."
        : "Không đọc được passport.",
    };
  }
}

export default async function PassportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadPassport(token);
  const passport = loaded.passport;
  const productName = String(passport?.productName ?? "");
  const publicLotCode = String(passport?.publicLotCode ?? "");
  const originIssuer = String(passport?.originIssuer ?? "");
  const timeline = (passport?.timeline as Record<string, unknown>[] | undefined) ?? [];
  const leaked = passport
    ? /email|price|stock|credential|rawPayload|buyerRef/i.test(JSON.stringify(passport))
    : false;

  return (
    <main className="intro stack">
      <p className="eyebrow">Passport công khai</p>
      <h1>{productName || "Passport"}</h1>
      {loaded.error ? <StatusBanner tone="error">{loaded.error}</StatusBanner> : null}
      {passport ? (
        <>
          <dl className="profile">
            <dt>Lô công khai</dt><dd>{publicLotCode || "—"}</dd>
            <dt>Origin issuer</dt><dd>{originIssuer || "—"}</dd>
          </dl>
          {leaked
            ? <StatusBanner tone="error">Phát hiện field private trong payload — dừng demo.</StatusBanner>
            : <StatusBanner tone="success">Không thấy field private trong response allowlist.</StatusBanner>}
          <section className="panel">
            <h2>Timeline</h2>
            <ul className="task-list">
              {timeline.map((item, index) => (
                <li key={index}>{JSON.stringify(item)}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
