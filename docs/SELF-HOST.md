# Self-hosting COROS Workout

COROS Workout is designed to remain usable as the existing COROS MCP connector while allowing optional training-data providers to be added behind a common provider layer.

## Recommended deployment model

Use one deployment per athlete/account. The COROS connector remains the default provider and keeps its existing MCP tool surface. Optional providers do not replace COROS unless a caller explicitly selects them through the provider layer.

Do not expose the MCP endpoint directly to the public internet without an authentication layer or trusted reverse proxy.

## Requirements

- Node.js 22 or Docker
- HTTPS for remote MCP usage
- Persistent storage if you want local auth/token state to survive restarts
- A private environment configuration based on `.env.example`

## Basic COROS setup

Copy `.env.example` to a private `.env` file and configure at minimum:

```env
COROS_EMAIL=you@example.com
COROS_PASSWORD=your-password
COROS_REGION=eu
COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false
```

Keep `.env` out of Git. The repository `.gitignore` excludes environment files and local token/auth state.

`COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false` is recommended so this service does not open a competing unofficial mobile session. Sleep/recovery data should use the official COROS OAuth path when available to the calling client.

## Private athlete profile

The repository ships only a generic athlete template. Personal constraints, objectives and preferences belong outside Git.

Use either:

```env
ATHLETE_PROFILE_PATH=/run/secrets/athlete-profile.json
```

or a deployment-managed encrypted environment variable:

```env
ATHLETE_PROFILE_JSON={...}
```

`ATHLETE_PROFILE_JSON` takes precedence over `ATHLETE_PROFILE_PATH`, which takes precedence over the bundled generic template.

## Optional Strava provider

Register your own Strava application and configure:

```env
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REFRESH_TOKEN=
```

Optional bootstrap values:

```env
STRAVA_ACCESS_TOKEN=
STRAVA_EXPIRES_AT=
STRAVA_TOKEN_FILE=
```

The Strava provider handles access-token refresh and persists rotated token state locally with restricted permissions. COROS remains the default provider.

## Optional Garmin provider

Garmin integration is intentionally limited to the official Garmin Connect Developer Program. It does not use undocumented Garmin Connect endpoints.

After Garmin approves the project and provides the relevant Activity API configuration, set:

```env
GARMIN_ACCESS_TOKEN=
GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE=
GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE=
```

If official Garmin access is unavailable, FIT/GPX import remains the portable path.

## FIT and GPX

The `file` provider works without an external account:

- FIT activity analysis reuses the existing FIT parser.
- GPX route analysis reuses the existing route-analysis engine.

This provider is useful both as a fallback and as a reference implementation for future providers.

## Local build

```bash
npm ci
npm test
npm run build
npm start
```

The HTTP service defaults to port `8787` when `PORT` is not supplied.

- Health endpoint: `/`
- MCP endpoint: `/mcp`

## Docker

```bash
docker build -t coros-workout-chatgpt .
docker run --rm -p 8787:8787 --env-file .env coros-workout-chatgpt
```

For persistent local token state, mount the relevant configuration directory or use the host platform's persistent disk/secrets facility.

## Providers

| Provider | Status | Account/API requirement | Main capabilities |
| --- | --- | --- | --- |
| `coros` | Default | COROS account / existing connector flow | Existing COROS MCP behavior, activities, metrics and coaching context |
| `file` | Optional | None | FIT activity analysis, GPX route analysis |
| `strava` | Optional | Strava OAuth application | Activity list/detail |
| `garmin` | Optional / official-ready | Approved Garmin Developer Program access | Activity list/detail through supplied official endpoints |

See `docs/training-data-providers.md` for the provider architecture.

## Before publishing a fork

Run the complete test/build pipeline and a production dependency audit. Do not publish a repository history that contains private athlete data, credentials or token files. A current clean working tree is not sufficient if older reachable commits contain private information.
