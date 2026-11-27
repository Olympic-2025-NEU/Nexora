// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import type { ReactNode } from "react";
import { currentActor } from "../../lib/auth/current-actor";
import { navigationForRoles } from "../../lib/auth/navigation";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  return <>
    <a className="skip-link" href="#main">Bỏ qua điều hướng</a>
    <div className="workspace">
      <header className="topbar">
        <Link href="/work" className="brand">Nexora <span>DX-Lab</span></Link>
        <div className="identity"><span>{actor.displayName || "Thành viên"}</span>
          <span className="org">{actor.organizationId}</span></div>
        <form method="post" action="/dxlab/logout"><button type="submit" className="text-button">Đăng xuất</button></form>
      </header>
      <nav className="area-nav" aria-label="Các vùng làm việc">
        {navigationForRoles(actor.roles).map(({ href, label }) =>
          <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <main id="main" tabIndex={-1} className="workspace-main">{children}</main>
    </div>
  </>;
}
