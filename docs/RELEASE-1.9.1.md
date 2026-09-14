# COROS Workout MCP 1.9.1

Reliability patch for route weather.

- Retries Open-Meteo HTTP 429 responses up to two times.
- Respects `Retry-After`, capped at ten seconds per retry.
- Caches identical successful forecasts in memory for fifteen minutes.
- Keeps the same 49-tool MCP catalog.

This patch was created after a real Render request received HTTP 429; GPX analysis and ultra simulation were already operating correctly.
