// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { newQrToken, passportBaseUrl, safePublicPassport, validQrToken } from "./qr-token";

test("P08-T06 QR encodes an opaque URL that a decoder can scan", async () => {
  const token = newQrToken();
  assert.equal(token.length, 43);
  assert.ok(validQrToken(token));
  const url = new URL(`/passport/${token}`, passportBaseUrl("https://passport.example"))
    .toString();
  assert.equal(url.includes("batchId"), false);
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4, width: 320 });
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, url);
  assert.equal(validQrToken("a".repeat(42)), false);
  assert.equal(validQrToken("a".repeat(44)), false);
  assert.equal(validQrToken("../secret"), false);
  assert.throws(() => passportBaseUrl("http://passport.example"),
    { code: "PUBLIC_BASE_URL_INVALID" });
});

test("P08-T06 public projection rejects extra or private fields", () => {
  const valid = { productName: "Product", publicLotCode: "LOT", originIssuer: "local",
    timeline: [{ type: "receipt", occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(), issuer: "local", sourceId: "source-1",
      verificationState: "confirmed", evidence: [] }], verificationState: "confirmed", gaps: [],
    asOf: new Date().toISOString() };
  assert.equal(safePublicPassport(valid), true);
  assert.equal(safePublicPassport({ ...valid, buyerRef: "secret" }), false);
  assert.equal(safePublicPassport({ ...valid, timeline: [
    { ...valid.timeline[0], privateDocumentId: "secret" }] }), false);
});
