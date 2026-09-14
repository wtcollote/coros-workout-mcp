# v2.2.0 — Coach State

Adds a persistent coach-state layer so ChatGPT can publish the actual trainer assessment, plan and changes consumed by the external mobile app.

- `coros_read(operation="coach_state")` reads trainer state.
- `coros_write(operation="update_coach_state", confirmation="CONFIRM")` publishes trainer state.
- State contains daily assessment, current plan and an append-only recent change feed.
- App sync is independent from COROS dashboard reconstruction.
- Set `COACH_STATE_PATH` to a path on a Render persistent disk for durable production storage. Without a persistent disk, state can be lost on redeploy/restart.
