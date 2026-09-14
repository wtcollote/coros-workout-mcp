# COROS Workout MCP v2.1.1 — Precision patch

- Performance trends are now calculated per discipline; cycling, running and trail speed are never pooled.
- Event readiness now separates current state from a projected event-date state based on decay of already-observed residual load.
- Priority-A calendar simulation hard-blocks >=3 h sessions in the final 10 days.
- Official sleep remains OAuth-owned by the calling platform. `officialSleepRecords` is still the safe ingestion contract; unofficial mobile login remains disabled.
- Connector version 2.1.1; visible tool count remains 56.
