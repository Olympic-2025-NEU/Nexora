# P08-T01 closure — explicit local source allocation

Date: 2026-11-24. Branch: `phase-08`.

## Implemented

- Migration `20261124040000_issue_source_allocation` adds `trading.issue_source_allocation(issue_line_id,source_line_id,quantity)` and optional `trace_link.allocation_detail`. The source is a confirmed GoodsReceipt or ReceivingConfirmation line in the same warehouse/batch/variant/stock UOM. Database guards reject a mismatched source, partial allocation on a confirmed issue, aggregate over-allocation and mutation after Draft. Confirmed source lines remain immutable.
- The issue create/edit API accepts `sources` for each line. Values are in stock UOM, so they must sum to the issue's converted stock quantity; all lines must provide sources if any line does. Draft edit replaces its allocation rows with its lines. M03 confirm locks source line IDs in order, rechecks confirmed source capacity and posts movement, audit and outbox atomically. Source selection is explicit, never inferred from a common batch or stock balance.
- `GET /api/v1/lots/{id}/issue-sources?warehouseId=...` pages in-scope confirmed receipt/receiving lines with remaining declarable quantity. The issue form supports multiple sources, and the issue detail plus `/trace` display the declared mapping.
- The P08 projector derives one `derived_from` edge from the confirmed issue event to each referenced receipt/receiving event. Each edge carries the exact issue line/source line/quantity mapping. If the source event has not projected yet, the outbox delivery retries. Backward and forward APIs expose these links under warehouse scope; `/trace` shows the quantities. Core Data's deterministic projection includes the details.

## Verification

- `npm run test:platform:trading`: a real M03/Flowable issue uses 2 units from one confirmed receipt line and 4 from another; Draft edit replaces rows; posting leaves correct stock. A wrong-lot source and incomplete sum are rejected. A later 4-unit claim on a source with only 3 unallocated units fails with `ISSUE_SOURCE_OVERALLOCATED` and leaves the document approved.
- `npm run test:platform:trace`: upgraded/fresh databases and restore/replay pass. A fixture with two receipt sources and one issue creates two `derived_from` edges, carries `2.000` and `4.000` allocation details in the backward graph, and appears in forward/core projection. Replaying the same outbox event leaves two links.
- `npm run typecheck`, `npm run lint`, `npm run build:worker`, `npm run test:contracts`, `npm run build`, `npm test` and `npx prisma validate` with a disposable URL all passed. GitHub CI is checked after push.

## Compatibility boundary

Previously confirmed issues have no recorded receipt-line allocation and cannot be retroactively proven. The API still accepts a new issue without `sources` for compatibility; the trace continues to report `local_allocation_unknown` in that case. A new issue with declared sources must account for every issue line and cannot overclaim its sources. This closes the T01 **link capability** without relabeling unknown legacy provenance as verified.
