// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { StatusBanner } from "../../../components/h/status-banner";
import { currentActor } from "../../../lib/auth/current-actor";

const links = [
  { href: "/operations/receipts", label: "Phiếu nhập" },
  { href: "/operations/issues", label: "Phiếu xuất" },
  { href: "/operations/transfers", label: "Điều chuyển" },
  { href: "/operations/receivings", label: "Nhận hàng" },
  { href: "/work/approvals", label: "Hộp phê duyệt" },
] as const;

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
        Actor <strong>{actor.displayName || actor.userId}</strong>
        {" "}· org session <code>{actor.organizationId}</code>.
      </p>
      {partnerId
        ? (
          <StatusBanner tone="success">
            Handoff partnerId <code>{partnerId}</code>.
            {" "}
            <Link href={`/operations/transfers?partnerId=${encodeURIComponent(partnerId)}`}>
              Mở transfer
            </Link>
          </StatusBanner>
        )
        : (
          <StatusBanner tone="info">
            Chưa chọn đối tác — mở <Link href="/partners">Đối tác</Link> rồi handoff.
          </StatusBanner>
        )}
      <nav className="area-nav" aria-label="Chứng từ">
        {links.map((link) => {
          const href = partnerId && link.href.includes("transfers")
            ? `${link.href}?partnerId=${encodeURIComponent(partnerId)}`
            : link.href;
          return <Link key={link.href} href={href}>{link.label}</Link>;
        })}
      </nav>
      <p className="muted">
        Deep-link: transfer → <Link href="/operations/receivings">receiving</Link>
        {" · "}receipt → <Link href="/data/lots">lot timeline</Link>
        {" · "}risk → <Link href="/assistant">assistant</Link> / batch.
      </p>
    </section>
  );
}
