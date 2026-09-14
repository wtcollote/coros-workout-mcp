# COROS Workout MCP 1.11.0

## Multisport operational routes

`plan_operational_route` now supports cycling, road running, trail running, walking and hiking. Timing can use speed or pace, separate ascent/descent penalties and a manual terrain factor. The release also fixes climb-category rounding and separates civil twilight from true night sectors.

## General activity and active recovery analysis

- `analyze_completed_activity` adds sport-aware context and accepts an optional date so strength can fall back to the activity-list summary when COROS rejects its detail endpoint.
- New `analyze_training_day` classifies the recorded day and identifies active-recovery candidates with explicit rules.
- `daily_training_briefing` includes the same per-session context and day classification.
- Strength analysis never infers muscular load from heart rate. When COROS omits sets, repetitions or resistance, the response says they are unavailable.

## Connector metadata

- Version: `1.11.0`
- Expected tools: `51`
