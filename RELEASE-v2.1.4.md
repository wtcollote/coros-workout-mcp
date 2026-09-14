# COROS Workout MCP v2.1.4

## Dashboard data-source recovery

- Fixes Training Hub GET requests that could return an HTML login page when the stored web access token had expired.
- GET responses are now parsed defensively instead of calling `response.json()` blindly.
- HTML / non-JSON, HTTP 401/403, and explicit invalid-token responses trigger one coordinated web-auth refresh and a retry.
- Adds explicit JSON Accept and a stable User-Agent to Training Hub requests.
- If COROS still returns HTML after refresh, source errors now identify the exact endpoint and HTTP/content type instead of exposing `Unexpected token '<'`.
- No calendar/write contracts changed.
- Dashboard private API introduced in v2.1.3 remains unchanged.

Expected effect: `dashboard_snapshot` should recover HRV, daily metrics and calendar after an expired Training Hub token instead of returning empty sources.
