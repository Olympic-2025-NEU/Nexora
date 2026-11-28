// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

export default async function ReceivingsDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/trading/inbound/${id}?kind=nexora`);
}
