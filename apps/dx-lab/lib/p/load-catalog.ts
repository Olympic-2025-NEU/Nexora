// SPDX-License-Identifier: AGPL-3.0-only
import "server-only";
import { listBalances, listBatches, listUoms, listWarehouses } from "../api-client/client";

export async function loadPickerOptions(accessToken: string, q?: string) {
  const [batches, warehouses, balances, uoms] = await Promise.all([
    listBatches(accessToken, q),
    listWarehouses(accessToken),
    listBalances(accessToken),
    listUoms(accessToken),
  ]);
  return {
    batches: batches.map((batch) => ({
      id: String(batch.id),
      label: `${String(batch.localCode ?? batch.id)} · ${String(
        (batch.originLot as { issuerInstanceId?: string } | undefined)?.issuerInstanceId ?? "",
      )}`,
      productVariantId: String(batch.productVariantId ?? ""),
      qualityStatus: String(batch.qualityStatus ?? ""),
      expiresOn: String(batch.expiresOn ?? ""),
    })),
    warehouses: warehouses.map((warehouse) => ({
      id: String(warehouse.id),
      label: String(warehouse.name ?? warehouse.code ?? warehouse.id),
    })),
    balances: balances.map((balance) => ({
      batchId: String(balance.batchId),
      warehouseId: String(balance.warehouseId),
      quantity: String(balance.quantity),
      stockUomId: String(balance.stockUomId ?? ""),
    })),
    uoms: uoms.map((uom) => ({
      id: String(uom.id),
      label: `${String(uom.code ?? "")} · ${String(uom.name ?? "")}`,
    })),
  };
}
