# COROS Workout MCP v2.2.1

- `coach_state` now persists in Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured.
- Local-file storage remains a development fallback only.
- `coach_state` reports its active storage provider and whether persistence is enabled.
- Connector version corrected to 2.2.1 and compiled output rebuilt from source.
- Existing MCP tool count and compatibility bridge remain unchanged.
