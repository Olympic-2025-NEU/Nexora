// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

export const instant = false;

/** Legacy path — order detail at `/orders/[id]`. */
export default async function SaleRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/orders/${id}`);
}
