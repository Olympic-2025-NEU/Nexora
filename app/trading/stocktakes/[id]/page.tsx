// SPDX-License-Identifier: AGPL-3.0-only
import { StocktakesClient } from "../_components/stocktakes-client";
export const instant = false;
export default async function StocktakePage({ params }: { params: Promise<{ id: string }> }) {
  return <StocktakesClient id={(await params).id} />;
}
