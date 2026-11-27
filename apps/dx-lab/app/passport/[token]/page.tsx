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
  const timeline = Array.isArray(passport?.timeline)
    ? passport.timeline.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item))
    : [];
  const verificationState = String(passport?.verificationState ?? "");
  const asOf = String(passport?.asOf ?? "");
  const gaps = Array.isArray(passport?.gaps)
    ? passport.gaps.filter((gap): gap is string => typeof gap === "string")
    : [];

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
            <dt>Xác minh</dt><dd>{verificationState || "—"}</dd>
            <dt>Cập nhật lúc</dt><dd>{asOf || "—"}</dd>
          </dl>
          {gaps.length ? <StatusBanner tone="warning">Dữ liệu còn thiếu: {gaps.join(", ")}</StatusBanner> : null}
          <section className="panel">
            <h2>Timeline</h2>
            <ul className="task-list">
              {timeline.map((item, index) => (
                <li key={`${String(item.sourceId ?? "")}-${index}`}>
                  {String(item.type ?? "")} · {String(item.issuer ?? "")} ·{" "}
                  {String(item.verificationState ?? "")} · {String(item.occurredAt ?? "")}
                  {item.sentQuantity ? ` · gửi ${String(item.sentQuantity)}` : ""}
                  {item.actualQuantity ? ` · nhận ${String(item.actualQuantity)}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
