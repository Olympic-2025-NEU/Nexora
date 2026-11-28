// SPDX-License-Identifier: AGPL-3.0-only
export default function Forbidden() {
  return <main className="auth-card"><h1>Không có quyền truy cập</h1>
    <p>Tài khoản hiện tại không có quyền với khu vực này.</p>
    <a href="/dxlab/work">Quay lại công việc</a></main>;
}
