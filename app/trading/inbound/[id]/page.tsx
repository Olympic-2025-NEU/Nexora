// SPDX-License-Identifier: AGPL-3.0-only
import { InboundFormClient } from "../_components/inbound-form-client";

export default async function InboundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { id } = await params;
  const { kind } = await searchParams;
  const initialKind = kind === "nexora" ? "nexora" : "local";
  return <InboundFormClient id={id} initialKind={initialKind} />;
}
