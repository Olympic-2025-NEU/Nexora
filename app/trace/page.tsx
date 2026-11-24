// SPDX-License-Identifier: AGPL-3.0-only
import { TraceStatus } from "./_components/trace-status";
import { BackwardTrace } from "./_components/backward-trace";
import { ForwardImpact } from "./_components/forward-impact";
import { QrPassport } from "./_components/qr-passport";

export default function TracePage() {
  return <main className="mx-auto max-w-4xl p-6">
    <h1 className="text-2xl font-semibold">Truy xuất nguồn gốc</h1>
    <TraceStatus />
    <BackwardTrace />
    <ForwardImpact />
    <QrPassport />
  </main>;
}
