# Training data providers

COROS Workout keeps COROS as its default data source while exposing a provider layer for additional platforms.

## COROS

Provider ID: `coros`

This is the default provider and preserves the existing COROS Workout connector behavior. The provider adapter reuses the existing COROS API code; it does not replace the current MCP tools.

## Portable files

Provider ID: `file`

Portable analysis works without an external account:

- FIT activity analysis reuses `src/fit-analysis.ts`.
- GPX route analysis reuses `src/route-analysis.ts`.

This is also the fallback path for platforms that can export FIT or GPX but do not expose an API to the current installation.

## Strava

Provider ID: `strava`

Strava is optional. Configure the `STRAVA_*` environment variables from `.env.example`. The provider supports OAuth token refresh, stores rotated tokens in a local file with restricted permissions, and exposes activity list/detail reads.

If Strava is not configured, the provider remains registered but reports itself as unavailable and does not affect COROS.

## Garmin Connect

Provider ID: `garmin`

Garmin Connect Developer Program access is approval-based. The public Garmin documentation describes Activity, Health, Training and Courses APIs and states that Developer Program APIs use OAuth 2.0. The exact Activity API configuration available to an approved project must come from Garmin's developer portal.

For that reason this repository intentionally does **not** hard-code undocumented Garmin Connect consumer endpoints. Configure the URLs supplied for the approved project through:

- `GARMIN_ACCESS_TOKEN`
- `GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE`
- `GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE`

Supported template placeholders are `{startDate}`, `{endDate}`, `{page}`, `{size}`, `{activityId}` and `{sportType}`.

Until those values are configured, the Garmin provider reports itself as unavailable. Users without Garmin Developer Program access can still analyze Garmin-exported FIT files through the `file` provider.

## Provider selection

`coros` remains the default provider. New code should resolve an explicit provider and capability instead of silently switching sources. This keeps existing COROS behavior stable while allowing future MCP tools to accept a provider selector.

The current extension order is:

1. Preserve existing COROS connector behavior.
2. Use the common provider contract for new cross-platform features.
3. Add provider selection to analysis tools only after provider-specific tests pass.
4. Never make a platform provider mandatory for installations that do not configure it.
