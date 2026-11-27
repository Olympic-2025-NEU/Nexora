// SPDX-License-Identifier: AGPL-3.0-only
import { safeNext } from "../../lib/auth/paths";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const href = `/dxlab/login?${new URLSearchParams({ next })}`;
  return <main className="auth-card">
    <p className="eyebrow">Nexora · DX-Lab</p>
    <h1>Đăng nhập</h1>
    <p>{params.reason === "expired" ? "Phiên đã hết hạn. Đăng nhập lại để tiếp tục." :
      "Đăng nhập bằng tài khoản của tổ chức để mở không gian làm việc."}</p>
    <a className="button" href={href}>Tiếp tục với Keycloak</a>
  </main>;
}
