# COROS Workout MCP 1.15.0

## Outcome

This release makes professional context a server-side invariant rather than a chat-only instruction. The visible MCP catalog stays at 56 tools; new reads are delivered through the stable compatibility bridge.

## Added

- Versioned persistent athlete profile with provenance and review date.
- `coros_read` operation `get_athlete_profile`.
- `coros_read` operation `training_context_analysis` with configurable 7–28 day lookback/lookahead and a 14+14 default.
- `coros_read` operation `validate_calendar_change` for read-only preflight.
- Plan-versus-completed matching, key-session detection and conservative residual-stress flags.
- Calendar checks for post-long-session recovery, same-day stacking, completed work, strength near key sessions, consecutive demanding days and repeated impact under the declared hip-CAM constraint.

## Write safety

- Assignments and moves use the professional guard.
- Swaps validate both final destinations before mutation.
- Structured-workout scheduling, duplication and week-plan creation validate before creating library objects.
- Range shifts and copies validate all proposed destinations before the first write.
- If activity or calendar context cannot be read, the write fails closed with `insufficient_context`.
- Warnings remain advisory; hard blocks prevent the mutation.

## Athlete profile

The bundled private profile currently records:

- primary discipline: ultra-cycling;
- secondary disciplines: road running, trail running and strength;
- available signals: heart rate and cadence, without cycling power;
- preferred analysis: heart rate, cadence and aerobic decoupling;
- declared hip-CAM constraint;
- Monday–Sunday training week and protection of recovery after long sessions;
- RAS 500 objective: approximately 505 km, 8,000 m ascent and 30-hour target.

The profile can be replaced with `ATHLETE_PROFILE_PATH` or `ATHLETE_PROFILE_JSON`. It must never contain COROS credentials. Acute symptoms and other changing facts remain request inputs.

## Verification

- TypeScript build passes.
- 82 unit tests pass across 10 suites.
- Compatibility bridge version remains 1 with connector version 1.15.0 and 56 expected top-level tools.
