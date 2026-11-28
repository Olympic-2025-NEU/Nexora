// SPDX-License-Identifier: AGPL-3.0-only
import { adminApi } from "@/app/lib/admin-api";

export type SuggestVariantCodeInput = {
  name: string;
  excludeVariantId?: string | null;
  reservedCodes?: string[];
};

/**
 * Request next suggested SKU/barcode from the catalog suggest-codes API
 * (shared algorithm for both fields).
 */
export async function suggestVariantCode(
  input: SuggestVariantCodeInput,
): Promise<string> {
  const res = await adminApi("/api/v1/products/suggest-codes", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      ...(input.excludeVariantId ? { excludeVariantId: input.excludeVariantId } : {}),
      ...(input.reservedCodes?.length ? { reservedCodes: input.reservedCodes } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`suggest-codes failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: { code?: string } };
  const code = body.data?.code?.trim();
  if (!code) throw new Error("suggest-codes empty");
  return code;
}
