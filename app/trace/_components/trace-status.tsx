// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/app/lib/admin-api";

type Status = { state: "caught_up" | "pending" | "lagging"; pendingEvents: number;
  lagSeconds: number; checkedAt: string };

export function TraceStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await adminApi("/api/v1/trace/status");
        if (!response.ok) throw new Error("TRACE_STATUS_UNAVAILABLE");
        const body = await response.json() as { data: Status };
        if (active) { setStatus(body.data); setError(false); }
      } catch { if (active) setError(true); }
    };
    void load();
    const interval = setInterval(() => { void load(); }, 15_000);
    return () => { active = false; clearInterval(interval); };
  }, []);
  if (error || !status) return <p role="status">Chưa xác định được độ mới của lịch sử lô.</p>;
  if (status.state !== "caught_up") return <p role="status">Lịch sử lô đang đồng bộ:
    {` ${status.pendingEvents} sự kiện chờ, trễ tối đa ${Math.ceil(status.lagSeconds)} giây.`}
    {status.state === "lagging" ? " Cần kiểm tra worker trace." : ""}</p>;
  return <p role="status">Đã xử lý hết hàng đợi trace local lúc {new Date(status.checkedAt).toLocaleString("vi-VN")}.
    Dữ liệu từ đối tác có thể còn thiếu.</p>;
}
