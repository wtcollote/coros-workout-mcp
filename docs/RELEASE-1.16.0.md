# COROS Workout MCP 1.16.0

## Goal

Allow the official COROS phone app and the private COROS Workout connector to
coexist without repeated mobile logouts, while preserving sleep-aware coaching.

## What changed

- Reverse-engineered mobile login is disabled by default.
- `professional_coaching_analysis` accepts normalized `officialSleepRecords`.
- ChatGPT can obtain those records with the official COROS MCP OAuth connector
  and hand only the recovery values to this private analysis layer.
- Connector metadata advertises `mobile-session-safe` and
  `official-oauth-recovery-ingestion`.
- The visible MCP catalog remains stable at 56 tools.

## Deployment

1. Deploy this version normally.
2. Remove `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN` from Render, or set it to
   `false`.
3. Enable both the official COROS connector and COROS Workout in ChatGPT.
4. Sign in to the COROS phone app once after deployment.

## Daily orchestration

1. Read sleep through official COROS MCP OAuth.
2. Normalize the records to the `officialSleepRecords` contract returned by
   `coros_capabilities`.
3. Call `coros_read` with operation `professional_coaching_analysis`.
4. Keep calendar writes in `coros_write` with explicit confirmation.

## Compatibility switch

Setting `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=true` restores the previous mobile
API behavior. This is intentionally opt-in and not recommended because it may
invalidate the official phone-app session.
