# COROS Workout MCP v2.2.2

- Centralized official sleep validation, date normalization, range filtering and source resolution in `src/sleep-source.ts`.
- Added optional `officialSleepRecords` to all six legacy sleep consumers: `get_sleep_data`, `get_readiness_summary`, `daily_training_briefing`, `weekly_training_report`, `preview_daily_adjustment` and `taper_readiness`.
- Shared the resolver with all sleep-consuming compatibility operations, including professional coaching, adaptive coaching, longitudinal history and dashboard snapshots. Simulation, season strategy and decision evaluation now also accept the official records used by their shared history loader.
- Missing sleep returns explicit `sleepStatus: "unavailable"` with no fabricated measurements or general tool failure. Sleep-only reads accept supplied records without requiring Training Hub authentication. Official reads report `sleepSource: "COROS MCP official OAuth"`.
- No change to COROS authentication or mobile login. `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN` remains disabled by default; only an existing explicit `true` opt-in permits the optional source, whose failures are contained.
- Updated stale test expectations to the existing bridge/model versions and actual 56-tool catalog, without removing or renaming tools.

Validation: TypeScript build; complete 167-test suite across 16 files, including the supplied 2026-09-08 official record (418 minutes, quality 98), missing/out-of-range sleep, null/zero preservation, optional-source gating, all affected MCP routes and dashboard 100% completeness with the other sources supplied. External COROS data is mocked in ingestion tests; no production session or deployment is involved.
