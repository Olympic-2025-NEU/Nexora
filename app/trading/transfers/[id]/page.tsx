// SPDX-License-Identifier: AGPL-3.0-only
import { TransfersClient } from "../_components/transfers-client";

export const instant = false;

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  return <TransfersClient id={(await params).id} />;
}
