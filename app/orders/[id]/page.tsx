// SPDX-License-Identifier: AGPL-3.0-only
import { OrderDetailClient } from "../_components/order-detail-client";

export const instant = false;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetailClient id={id} />;
}
