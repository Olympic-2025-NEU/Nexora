// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../components/h/status-banner";
import { currentActor } from "../../../lib/auth/current-actor";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ partnerId?: string }>;
}) {
  const actor = await currentActor();
  const params = await searchParams;
  const partnerId = typeof params.partnerId === "string" ? params.partnerId.trim() : "";

  return (
    <section className="stack">
      <p className="eyebrow">P · Process</p>
      <h1>Giao dịch</h1>
      <p>
        Actor hiện tại: <strong>{actor.displayName || actor.userId}</strong>
        {" "}· org từ session <code>{actor.organizationId}</code>.
      </p>
      {partnerId
        ? (
          <StatusBanner tone="success">
            Handoff từ H: partnerId <code>{partnerId}</code> đã được chọn cho draft transfer (T04 sẽ dùng
            destinationPartnerId, không đổi organizationId trong request).
          </StatusBanner>
        )
        : (
          <StatusBanner tone="info">
            Chưa chọn đối tác. Mở <Link href="/partners">Đối tác</Link> rồi dùng “Dùng trong giao dịch”.
          </StatusBanner>
        )}
      <p className="muted">Editor receipt/issue/transfer và approval decisions thuộc P11-T04.</p>
    </section>
  );
}
