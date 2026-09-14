# COROS Workout MCP v2.1.0 — Athlete Intelligence

## Added
- Personal recovery-response model (24/48/72 h observations)
- Residual fatigue model
- Training dose optimizer
- Session fingerprints
- Performance trend detector
- Event readiness planning index
- Personal-baseline anomaly detection
- Data-quality/confidence reporting
- Unified Athlete Intelligence operation

## Changed
- Taper boundary: <=14 days before a dated objective.
- Internal adaptive engine/model version raised to 2.1.
- Connector version 2.1.0.

## Compatibility
- Expected MCP tool count remains 56.
- New capabilities are exposed through the stable `coros_read` bridge.
- No existing calendar write contract was changed.

## Validation
A dedicated `athlete-intelligence.test.ts` regression test was added. In this packaging environment `npm ci` timed out before dependencies completed, so run `npm ci && npm test && npm run build` in CI/Render before production start.
