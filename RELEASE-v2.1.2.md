# COROS Workout MCP v2.1.2

Adds read-only `dashboard_snapshot` to the stable compatibility bridge.

The operation fetches COROS history/calendar once, then derives Athlete Intelligence, adaptive coaching, season strategy and athlete model from the same in-memory dataset. This is intended for dashboards and other UIs that must avoid repeated MCP/COROS calls.

No write contracts changed. Expected MCP tool count remains 56.
