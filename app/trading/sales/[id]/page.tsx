// SPDX-License-Identifier: AGPL-3.0-only
import { SalesClient } from "../_components/sales-client";
export const instant = false;
export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  return <SalesClient id={(await params).id} />;
}
