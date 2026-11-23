// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import fixtures from "./fixtures/domain-events-v1.json";
import { EVENT_DESTINATIONS, TRADING_EVENT_TYPES, serializeDomainEvent, validateDomainEvent,
  type TradingEventType } from "./registry";

const cases = Object.entries(fixtures.cases).filter(([name]) => name.startsWith("trading-"));
test("five trading schemas serialize valid fixtures, reject invalid fixtures and pin versions", () => {
  assert.equal(cases.length, 5);
  assert.deepEqual(Object.values(TRADING_EVENT_TYPES), cases.map(([name]) =>
    name.replace(".schema.json", "").replaceAll("-", ".")));
  for (const [name, pair] of cases) {
    const type = name.replace(".schema.json", "").replaceAll("-", ".") as TradingEventType;
    const input = { type, payload: pair.valid, aggregateType: "trading", aggregateId: randomUUID(),
      aggregateVersion: 2, correlationId: randomUUID() };
    const rows = serializeDomainEvent(input);
    assert.deepEqual(rows.map((row) => row.destination),
      [TRADING_EVENT_TYPES.receipt, TRADING_EVENT_TYPES.issue].includes(type as typeof TRADING_EVENT_TYPES.receipt)
        ? [EVENT_DESTINATIONS.traceability] : [EVENT_DESTINATIONS.traceability, EVENT_DESTINATIONS.federation]);
    assert.ok(rows.every((row) => row.eventType === type && row.schemaVersion === "1" && row.payload === pair.valid));
    assert.deepEqual(validateDomainEvent(type, "1", pair.invalid), { ok: false, reason: "INVALID_EVENT_PAYLOAD" });
    assert.throws(() => serializeDomainEvent({ ...input, payload: pair.invalid }), /INVALID_EVENT_PAYLOAD/);
  }
  assert.deepEqual(validateDomainEvent("trading.receipt.confirmed.v2", "2", {}),
    { ok: false, reason: "UNSUPPORTED_EVENT_VERSION" });
  assert.deepEqual(validateDomainEvent(TRADING_EVENT_TYPES.receipt, "2", {}),
    { ok: false, reason: "UNSUPPORTED_EVENT_VERSION" });
  assert.deepEqual(validateDomainEvent("workflow.unknown.v1", "1", {}),
    { ok: false, reason: "UNSUPPORTED_EVENT_TYPE" });
  assert.deepEqual(serializeDomainEvent({ type: TRADING_EVENT_TYPES.receipt, payload: cases[0][1].valid,
    aggregateType: "trading", aggregateId: randomUUID(), aggregateVersion: 2, correlationId: randomUUID(),
    destinations: [EVENT_DESTINATIONS.federation] }).map((row) => row.destination), [EVENT_DESTINATIONS.federation]);
});
