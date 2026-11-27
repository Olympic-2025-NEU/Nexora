// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { listBatches, listWarehouses } from "../api-client/client";

export async function loadPickerOptions(accessToken: string, q?: string) {
  const [batches, warehouses] = await Promise.all([
    listBatches(accessToken, q),
    listWarehouses(accessToken),
  ]);
  return {
    batches: batches.map((batch) => ({
      id: String(batch.id),
      label: `${String(batch.localCode ?? batch.id)} · ${String(
        (batch.originLot as { issuerInstanceId?: string } | undefined)?.issuerInstanceId ?? "",
      )}`,
      productVariantId: String(batch.productVariantId ?? ""),
    })),
    warehouses: warehouses.map((warehouse) => ({
      id: String(warehouse.id),
      label: String(warehouse.name ?? warehouse.code ?? warehouse.id),
    })),
  };
}
