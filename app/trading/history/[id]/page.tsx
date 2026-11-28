// SPDX-License-Identifier: AGPL-3.0-only
import { HistoryClient } from "../../_components/history-client";

export const instant = false;

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <HistoryClient id={(await params).id} />;
}
