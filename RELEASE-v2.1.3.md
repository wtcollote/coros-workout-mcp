# COROS Workout MCP v2.1.3

- Adds a private server-to-server read API at `/api/dashboard-read`.
- Uses the existing compatibility bridge directly, bypassing MCP transport for the mobile dashboard.
- Protected by `DASHBOARD_API_TOKEN` (or `DASHBOARD_TOKEN` fallback).
- MCP endpoint and 56-tool surface remain unchanged.
