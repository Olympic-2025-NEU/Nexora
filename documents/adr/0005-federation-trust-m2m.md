# D05 — Federation trust (receiver-issued M2M)

- **Status:** Accepted for P00 design, 2026-11-17. Gateway scope spike passed; partner mapping runtime remains P02/P05/P09.
- **Blocks:** P02/P05 partner identity and P09 inbox delivery.
- **Decision owners:** Dev/team; two G00 reviewers still required.
- **Detailed rationale:** [D05-federation-trust.md](./D05-federation-trust.md).

## Decision

Each receiver provisions a confidential client for each sending partner in its own Keycloak realm. The sender obtains a short-lived client-credentials token from that receiver. The gateway checks signature, issuer, audience and `federation:write` scope; the application binds the verified `client_id` to an active `system.partner_connection.inbound_client_id` before writing inbox. `issuerInstanceId` in the body must equal that partner's configured instance ID. A, B and C retain separate credentials and databases. User sessions and shared API keys are not the federation transport.

Keycloak/APISIX image versions, license, source and RAM snapshot are recorded in [D01](./0001-gateway-apisix.md), [D04](./0004-identity-session-keycloak.md), [D13 detail](./D13-versions-licenses-resources.md) and the [infra spike](../phase-plan/evidence/spikes/infra/README.md). This ADR adds a trust policy, not a new image.

## P00 evidence and boundary

- [x] Spike: `sender-a` with scope reaches M2M mock upstream (202); `sender-c` without scope and user token get 403; service tokens cannot call private user route.
- [x] Contract: federation inbound declares M2M bearer, issuer/recipient negative fixtures, technical ACK separated from business receipt. See [contract validation](../phase-plan/evidence/contract-validate.md).
- [ ] Runtime: A/B/C independent realms, wrong issuer/audience/expired token, disabled/rotated partner, client→partner binding, body spoof, TLS/SSRF and lost ACK. Owners: P02/P05/P09; no P00 mock proves these app checks.

Changing the binding or transport requires an ADR update with [security](../phase-plan/security.md), [API](../phase-plan/api-payloads-v1.md), [events](../phase-plan/event-payloads-v1.md) and [DB](../phase-plan/database-schema-v1.md) contracts in the same PR. G00 still awaits human sign-off.
