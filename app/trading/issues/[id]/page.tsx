// SPDX-License-Identifier: AGPL-3.0-only
import { DocumentsClient } from "../../_components/documents-client";

export const instant = false;

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentsClient kind="issues" id={(await params).id} />;
}
