# Quick start

## Try it without credentials

Run `npm ci` and then `npm run demo`.

Demo mode uses synthetic activities only and does not read COROS, Strava or Garmin accounts.

Run `npm run doctor` to inspect Node.js, provider availability and configuration without printing secret values.

## Real data

Copy `.env.example` to `.env`, configure only the providers you use, then run:

```bash
npm ci
npm run build
npm run doctor
npm start
```

Default MCP endpoint: `http://localhost:8787/mcp`.

## Providers

Use `training_data_status` or `list_training_providers` through `coros_read` to see what is available. Universal analytics accept `providerId` values such as `coros`, `strava`, `garmin` or `demo`.

## Render

The included `render.yaml` defines a free-plan Docker web service. Store credentials in Render environment variables and never commit a `.env` file.
