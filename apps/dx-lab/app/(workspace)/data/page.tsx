// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";

export default function DataHomePage() {
  return (
    <section className="stack">
      <p className="eyebrow">D · Data</p>
      <h1>Tồn và truy xuất</h1>
      <nav className="area-nav" aria-label="Dữ liệu">
        <Link href="/data/inventory">Tồn kho</Link>
        <Link href="/data/lots">Lô / timeline</Link>
        <Link href="/data/quality">Quality issues</Link>
      </nav>
    </section>
  );
}
