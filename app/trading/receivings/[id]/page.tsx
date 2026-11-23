// SPDX-License-Identifier: AGPL-3.0-only
import { ReceivingsClient } from "../_components/receivings-client";
export const instant = false;
export default async function ReceivingPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReceivingsClient id={(await params).id} />;
}
