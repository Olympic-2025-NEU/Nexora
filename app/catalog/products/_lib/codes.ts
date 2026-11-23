// SPDX-License-Identifier: AGPL-3.0-only

/** Build a short SKU from product name + random suffix. */
export function suggestSku(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  const suffix = Math.floor(100 + Math.random() * 900).toString();
  return `${base || "SP"}${suffix}`;
}

function ean13CheckDigit(twelve: string): string {
  const digits = twelve.split("").map((d) => Number(d));
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

/** Local-only EAN-13 suggestion (prefix 200 = internal). */
export function suggestBarcode(): string {
  const body = `200${Date.now().toString().slice(-9)}`.slice(0, 12);
  return `${body}${ean13CheckDigit(body)}`;
}
