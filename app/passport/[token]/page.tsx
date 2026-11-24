// SPDX-License-Identifier: AGPL-3.0-only
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getPrismaClient } from "@/platform/persistence/prisma";
import { createQrService } from "@/contexts/traceability/application/qr-token";

export const instant = false;

const labels: Record<string, string> = {
  "trading.receipt.confirmed.v1": "Nhập kho",
  "trading.issue.confirmed.v1": "Xuất kho",
  "trading.transfer.confirmed.v1": "Chuyển đối tác",
  "trading.receiving.confirmed.v1": "Nhận hàng",
  "trading.stocktake.confirmed.v1": "Kiểm kê",
  "trading.sale.recorded.v1": "Bán hàng",
};

export default async function PassportPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const passport = await createQrService(getPrismaClient()).publicPassport(token);
  if (!passport) notFound();
  return <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-8 text-slate-900 sm:px-8">
    <header className="border-b pb-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-slate-600">Nexora Passport</p>
      <h1 className="mt-2 text-3xl font-bold">{passport.productName}</h1>
      <p className="mt-2 text-sm">Mã lô công bố: <strong>{passport.publicLotCode}</strong></p>
      <p className="text-sm">Nguồn phát hành: <strong>{passport.originIssuer}</strong></p>
    </header>
    <section className="mt-6 rounded-lg border bg-slate-50 p-4" aria-label="Tình trạng dữ liệu">
      <h2 className="font-semibold">Tình trạng dữ liệu</h2>
      <p className="mt-1 text-sm">{passport.verificationState === "confirmed" ?
        "Các sự kiện được hiển thị có nguồn chứng từ local đã xác nhận." :
        "Lịch sử hiện có khoảng chưa xác minh hoặc chưa công bố đầy đủ."}</p>
      <p className="mt-2 text-xs text-slate-600">Cập nhật theo nguồn lúc {new Date(passport.asOf)
        .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.</p>
    </section>
    <section className="mt-8" aria-label="Lịch sử đã công bố">
      <h2 className="text-xl font-semibold">Lịch sử đã công bố</h2>
      {passport.timeline.length ? <ol className="mt-4 space-y-3 border-l pl-4">
        {passport.timeline.map((item, index) => <li key={`${item.type}-${item.occurredAt}-${index}`}>
          <p className="font-medium">{labels[item.type] ?? item.type}</p>
          <p className="text-sm text-slate-600">{new Date(item.occurredAt)
            .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
          <p className="text-xs text-slate-600">Nguồn local: {item.verificationState}</p>
        </li>)}</ol> : <p className="mt-3 text-sm">Chưa có sự kiện được phép công bố.</p>}
    </section>
    {passport.gaps.length > 0 && <section className="mt-8 rounded-lg border border-amber-300 p-4">
      <h2 className="font-semibold">Thông tin còn thiếu</h2>
      <ul className="mt-2 list-inside list-disc text-sm">{passport.gaps.map((gap) =>
        <li key={gap}>{gap}</li>)}</ul>
    </section>}
    <footer className="mt-8 border-t pt-4 text-xs text-slate-600">
      Trang này chỉ hiển thị dữ liệu được chủ sở hữu cho phép công bố; không phải chứng nhận chất lượng.
    </footer>
  </main>;
}
