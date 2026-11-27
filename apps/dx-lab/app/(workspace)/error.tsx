// SPDX-License-Identifier: AGPL-3.0-only
"use client";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return <section role="alert"><h1>Dịch vụ tạm thời không sẵn sàng</h1>
    <p>Không tải được dữ liệu từ cổng API. Hãy thử lại sau.</p>
    <button type="button" onClick={reset}>Thử lại</button></section>;
}
