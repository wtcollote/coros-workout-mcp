# COROS Workout MCP 2.0.0 — Adaptive Coaching Engine

## Goal

Turn the connector from a collection of COROS analysis/write utilities into one coherent long-term coaching system. Version 2.0 keeps the 56 visible MCP tools stable and adds the new intelligence through the compatibility bridge.

## New v2 engines

### `adaptive_coaching_engine`
Combines individual recovery baselines, official OAuth sleep input, HRV, resting HR, training-load ratio, residual stress, subjective state, current calendar and objective proximity. Returns one explainable decision: stop-and-assess, rest, recover, reduce, maintain or insufficient-data. It never invents a workout on an empty day.

### `longitudinal_athlete_model`
Builds athlete-specific observed baselines from recent history: resting HR, HRV/baseline relationship, load ratio, weekly training load, endurance load/hour, discipline exposure and long-session exposure. Confidence is explicit. Observational history is never presented as causal proof.

### `simulate_training_change`
Previews a proposed workout change across the next 14 days before any COROS write. Reports projected duration/load deltas, same-day stacks, post-long-session conflicts and late long sessions near an objective. Simulation is read-only.

### `season_strategy`
Adds long-horizon planning above daily readiness. An A/B/C objective can be mapped to general preparation, base, build, specific, taper or transition/recovery. Daily decisions cannot silently override the season strategy.

### `evaluate_prior_decision`
Closes the coaching loop by checking what was observed after an earlier decision. It compares follow-up load ratio, resting HR and training exposure but explicitly avoids causal claims.

## Architecture

The complete coaching loop is now:

`read -> interpret -> individualize -> decide -> simulate -> plan -> guard -> write -> verify -> observe -> evaluate -> learn`

The existing professional coaching analysis, methodology catalog, persistent athlete profile, full training context and professional calendar guard remain intact and are used as complementary layers rather than replaced.

## Compatibility

- Visible MCP tool count remains **56**.
- Compatibility bridge version becomes **2**.
- Existing dedicated tool schemas remain unchanged.
- Existing v1.16 mobile-session coexistence remains unchanged: unofficial mobile login stays fail-closed by default.
- Official COROS MCP OAuth remains the preferred source for sleep/recovery inputs.

## New compatibility read operations

Call `coros_capabilities`, then `coros_read` with one of:

- `adaptive_coaching_engine`
- `longitudinal_athlete_model`
- `simulate_training_change`
- `season_strategy`
- `evaluate_prior_decision`

## Safety / decision contract

- Subjective illness or high pain overrides favorable wearable data.
- Missing values remain missing; there is no invented readiness score.
- Learned baselines are individual observations, not medical thresholds.
- Missed sessions are never automatically repaid later.
- Simulation never writes to COROS.
- Existing calendar guard remains fail-closed when required context cannot be loaded.

## Tests added

`src/__tests__/adaptive-coaching-engine.test.ts` covers:

- maintain on a stable day without inventing extra training;
- illness overriding favorable wearable data;
- longitudinal model provenance / no-causation contract;
- blocking impact work immediately after a very long ride;
- taper phase selection close to an objective;
- post-decision evaluation without causal overclaiming.

## Deployment

1. Upload the v2 repository to GitHub.
2. Deploy on Render using the existing Dockerfile/build pipeline.
3. Keep `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false` (or unset).
4. Run `npm ci`, `npm test`, `npm run build` in the deployment environment.
5. After deployment call `connector_status`; expected version is `2.0.0`, expected tool count remains `56`.
6. Call `coros_capabilities` and confirm the five new read operations.
7. Smoke-test `longitudinal_athlete_model`, `adaptive_coaching_engine`, `simulate_training_change` and one guarded calendar validation before enabling real writes.
