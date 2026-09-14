# coros-workout-mcp

> ⚠️ **Unofficial, community-led project — not affiliated with COROS.**
> COROS now offers an official MCP server at
> [coroslab/COROS-MCP](https://github.com/coroslab/COROS-MCP). If you want a
> supported, first-party option, use that. This project remains an independent,
> community-built tool.

MCP server for creating and managing COROS strength, running and cycling workouts through the Training Hub API. It includes calendar management, weekly planning, validation and backups. This fork adds a Streamable HTTP endpoint for a private ChatGPT plugin while preserving stdio compatibility.

**Zero-cost connection guide:** [English](docs/FREE-CONNECTION-GUIDE.md) · [Español](docs/FREE-CONNECTION-GUIDE-ES.md)


## Version 2.0 — Adaptive Coaching Engine

Version 2.0 keeps the 56 visible MCP tools stable but turns the compatibility bridge into a complete long-term coaching layer. It can build athlete-specific baselines, make an explainable daily decision, simulate training changes before calendar writes, place the current week inside a season strategy, and evaluate what happened after prior decisions. See [docs/RELEASE-2.0.0.md](docs/RELEASE-2.0.0.md) and [docs/V2-SMOKE-TEST.md](docs/V2-SMOKE-TEST.md).

## Private ChatGPT setup

This is a tool-only plugin: it does not add a widget. It exposes the MCP endpoint at `/mcp` and a health response at `/`.

1. Deploy the included Docker image to a host with persistent storage and HTTPS.
2. Configure these secrets in the host (do not commit them):

   - `COROS_EMAIL`
   - `COROS_PASSWORD`
   - `COROS_REGION=eu`

   Leave `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN` unset or set it to `false`.
   This prevents the private connector from opening a competing COROS mobile
   session and allows the official COROS phone app to remain signed in.

3. In ChatGPT, enable Developer mode and create a private plugin using:

   `https://YOUR-HOST.example/mcp`

The host sets `PORT` automatically on most platforms. Locally it defaults to `8787`.

```bash
npm install
npm run build
npm start
```

For a Docker smoke test:

```bash
docker build -t coros-workout-chatgpt .
docker run --rm -p 8787:8787 --env-file .env coros-workout-chatgpt
```

Important: the upstream project uses a reverse-engineered COROS API. API login can invalidate an active COROS Training Hub web session. This private deployment is intended for one COROS account; do not expose the endpoint publicly without an authentication layer.

See the MCP in action: [YouTube walkthrough](https://www.youtube.com/watch?v=I2I2p7hNZjM)

## Disclaimer

This is an **unofficial**, community-driven project. It is **not affiliated with, endorsed by, or connected to COROS** in any way. For an official, COROS-supported MCP server, see [coroslab/COROS-MCP](https://github.com/coroslab/COROS-MCP).

This server communicates with the COROS Training Hub using a **reverse-engineered, undocumented API** that may change or break without notice. Use it at your own risk.

COROS is a trademark of COROS Wearables, Inc. This project is provided as-is with no warranty — see [LICENSE](LICENSE) for details.

## Setup

```bash
cd coros-workout-mcp
npm install
npm run build
```

## Usage with Claude Code

```bash
claude mcp add coros-workout -- node /path/to/coros-workout-mcp/dist/src/index.js
```

To use env var auth (avoids typing credentials in conversation):

```bash
claude mcp add coros-workout -e COROS_EMAIL=you@example.com -e COROS_PASSWORD=yourpass -e COROS_REGION=eu -- node /path/to/coros-workout-mcp/dist/src/index.js
```

## Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coros-workout": {
      "command": "/path/to/node",
      "args": ["/path/to/coros-workout-mcp/dist/src/index.js"],
      "env": {
        "COROS_EMAIL": "you@example.com",
        "COROS_PASSWORD": "yourpass",
        "COROS_REGION": "eu"
      }
    }
  }
}
```

> **Node.js 18+ required** — this server uses native `fetch()` which was added in Node 18.

> **Troubleshooting `fetch is not defined`:** Claude Desktop is a GUI app that doesn't inherit your shell PATH, so node binaries installed via version managers (mise, nvm, fnm, volta) won't be found. Use the full absolute path to your node binary in `"command"`:
>
> ```bash
> which node        # e.g. /Users/you/.mise/shims/node
> node --version    # confirm it's 18+
> ```
>
> Common locations:
> - **mise**: `~/.local/share/mise/installs/node/<version>/bin/node`
> - **nvm**: `~/.nvm/versions/node/<version>/bin/node`
> - **fnm**: `~/.local/share/fnm/node-versions/<version>/installation/bin/node`
> - **Homebrew**: `/opt/homebrew/bin/node`

## Tools

| Tool | Description |
|------|-------------|
| `authenticate_coros` | Log in with email/password (or auto-login from env vars) |
| `check_coros_auth` | Verify current auth status |
| `search_exercises` | Search ~383 exercises by name, muscle, body part, equipment |
| `create_workout` | Build and push a strength workout to COROS |
| `update_exercises` | Fetch the latest exercise catalog from COROS and rebuild locally |
| `list_workouts` | List existing workouts |
| `assign_workout_to_calendar` | Assign an existing workout after a professional ±14-day context guard |
| `create_structured_workout` | Create and optionally schedule structured run/bike workouts |
| `list_scheduled_workouts` | Read the COROS calendar and return management IDs |
| `move_scheduled_workout` | Move a scheduled workout after the same context guard |
| `remove_scheduled_workout` | Remove one occurrence from the calendar |
| `delete_workout` | Delete a saved workout from the library |
| `duplicate_workout` | Copy any workout and optionally schedule the copy |
| `update_workout` | Create an edited replacement clone; optionally delete the original |
| `create_week_plan` | Validate, create and schedule up to 14 run/bike workouts |
| `check_calendar_conflicts` | Detect days containing multiple scheduled workouts |
| `summarize_planned_load` | Summarize planned duration and distance by sport |
| `swap_calendar_workouts` | Exchange two scheduled workouts between dates |
| `validate_structured_workout` | Validate structure and totals without writing to COROS |
| `export_coros_backup` | Export workout metadata and raw calendar data as JSON |
| `get_workout_details` | Inspect every step and target of one workout |
| `replace_scheduled_workout` | Safely replace one calendar occurrence |
| `shift_calendar_range` | Preview or shift a date range by N days |
| `copy_calendar_range` | Preview or copy a scheduled period to new dates |
| `clear_calendar_range` | Preview or clear a range with explicit confirmation |
| `audit_calendar` | Audit conflicts, management IDs and planned volume |
| `get_hrv_data` | Read recent nightly HRV and baseline |
| `get_daily_metrics` | Read resting HR, fatigue, load and fitness metrics |
| `get_sleep_data` | Legacy mobile sleep read; safely disabled by default in v1.16.0 |
| `list_activities` | List completed activities and principal metrics |
| `get_activity_detail` | Read laps, zones and detailed activity metrics |
| `analyze_aerobic_decoupling` | Compare speed/HR efficiency between both halves of an endurance activity |
| `analyze_completed_activity` | Return compact metrics, zones, representative laps and decoupling |
| `analyze_training_day` | Classify recorded strength, endurance, walking, mobility and active-recovery sessions for one day |
| `daily_training_briefing` | Combine seven-day sleep, HRV, load, activities, calendar and decoupling in one call |
| `preview_daily_adjustment` | Preview maintain/reduce/recovery using transparent conservative thresholds |
| `calculate_fueling_plan` | Estimate carbohydrate, fluid and sodium ranges for an endurance session |
| `compare_activity_history` | Compare normalized metrics and decoupling across similar activities |
| `weekly_training_report` | Compare the latest seven days with the preceding week across training and recovery |
| `analyze_workout_execution` | Compare planned blocks with the completed activity when COROS exposes linkage |
| `taper_readiness` | Review load decline, recovery signals and planned work before an event |
| `connector_status` | Report version, authentication and expected tool count |
| `get_activity_export_url` | Get a temporary FIT / GPX / TCX / KML / CSV download URL for a completed activity |
| `analyze_fit_activity` | Analyze record-level FIT data without returning bulky raw samples |
| `get_athlete_profile_metrics` | Consolidate VO₂max, thresholds, fitness, training indices, HRV and resting HR |
| `analyze_gpx_route` | Analyze distance, elevation, grade, bearing and fixed-distance GPX sectors |
| `analyze_route_weather` | Add forecast weather, wind components, daylight and risks to GPX sectors |
| `simulate_ultra_route` | Produce three transparent timing scenarios and checkpoint ETAs from a GPX route |
| `plan_operational_route` | Build cycling, running, trail, walking or hiking scenarios with stops, terrain, daylight, fueling and weather |
| `calibrate_sport_performance` | Fit effective speed/pace and ascent cost from comparable COROS history |
| `analyze_multisport_load` | Separate COROS cardiovascular load, impact exposure, strength duration and recovery activity |
| `get_readiness_summary` | Combine sleep, HRV, load, activities and calendar for one day |
| `compare_plan_to_actual` | Compare planned and completed volume by date |
| `coros_capabilities` | Return the live compatibility-bridge operation catalog and input contracts |
| `coros_read` | Execute allowlisted read operations through a stable schema for older chats |
| `coros_write` | Execute allowlisted writes through a stable schema with explicit confirmation |

The stable `coros_read` bridge exposes `professional_coaching_analysis`, `coaching_methodology_catalog`, `get_athlete_profile`, `training_context_analysis`, `validate_calendar_change` and the v2 operations `adaptive_coaching_engine`, `longitudinal_athlete_model`, `simulate_training_change`, `season_strategy` and `evaluate_prior_decision`. The coaching analysis performs a multisource review of sleep, HRV, resting heart rate, COROS load and fitness fields, completed activities, impact exposure, strength, active recovery and the future calendar. The context analysis uses a default 14-day lookback and 14-day lookahead. Results deliberately separate observed evidence, coaching interpretation, practical recommendation and missing-data uncertainty for cycling, running, trail and ultra-endurance.

### Stable compatibility bridge

ChatGPT conversations can retain an older MCP tool catalog. Version 1.13.0 added a stable bridge so future server capabilities can be used without adding another top-level tool name. Versions 1.14.x through 1.16.0 added coaching, context and safe recovery-data ingestion. Version 2.0.0 adds adaptive decision-making, longitudinal athlete modeling, season strategy, pre-write simulation and post-decision evaluation while the visible tool count remains 56. Call `coros_capabilities`, then use `coros_read` or `coros_write` with the returned operation and input contract.

The bridge does not replace the dedicated tools. It is a compatibility fallback. Its `operation` field intentionally remains a free string so adding server-side operations does not change the cached schema. Writes are allowlisted and require `CONFIRM` or `DELETE` as specified by `coros_capabilities`.

An old conversation must load version 1.13.0 once before it can use the bridge. A conversation that never loaded this plugin cannot be updated by the MCP server itself.

See [docs/NEXT-IMPROVEMENTS.md](docs/NEXT-IMPROVEMENTS.md) for the prioritized roadmap. For zero-cost hosting and connection options, see [docs/FREE-CONNECTION-GUIDE.md](docs/FREE-CONNECTION-GUIDE.md).

`update_workout` uses clone-and-replace semantics because COROS does not expose a stable documented in-place editing API. The original is retained by default. `summarize_planned_load` reports planned volume; it is not COROS physiological Training Load.

### Mobile-app coexistence and sleep data

Version 1.16.0 disables the reverse-engineered COROS mobile login by default. ChatGPT should read sleep through the official COROS MCP OAuth connector, normalize those records and pass them to `coros_read(operation="professional_coaching_analysis")` as `officialSleepRecords`. COROS Workout then combines them with Training Hub load, HRV, activities and calendar data for the professional interpretation. OAuth credentials remain managed by the calling ChatGPT connector and are not copied into this service.

The compatibility escape hatch `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=true` restores the old `get_sleep_data` behavior, but it is not recommended: it can compete with or invalidate the phone application's session. Daily summaries expose COROS' raw fatigue and load fields; the server deliberately does not manufacture its own recovery score.

`daily_training_briefing` is optimized for a scheduled morning report: it performs the required COROS reads in parallel, reports partial-source errors, summarizes seven-day trends and includes decoupling for the latest run or ride when sufficient auto-lap data exists. `analyze_aerobic_decoupling` compares time-weighted speed/heart-rate efficiency after trimming 10% from both ends by default; the result is unavailable rather than estimated when COROS lacks enough valid laps.

`preview_daily_adjustment` never writes to COROS. It applies explicit conservative thresholds to sleep, HRV, resting heart rate and training-load ratio, requires at least two available signals and returns the exact reasons behind its suggestion. Subjective symptoms and user confirmation always take precedence. `analyze_completed_activity` keeps the useful summary, zones and a maximum of roughly 20 representative laps instead of returning COROS' very large raw activity payload.

`professional_coaching_analysis` keeps exhaustive measurement and professional interpretation as two separate layers. Its coaching hierarchy gives priority to reported pain or illness, then acute recovery, multisport load and impact, calendar purpose, event proximity and discipline specificity. It supports multiple periodization and intensity-distribution models but never selects one automatically from a single metric. Known constraints and subjective state must be passed in because they are not reliably stored by COROS. It provides decision support, not medical diagnosis, and calendar changes remain separate confirmed writes.

### Persistent athlete profile and calendar safety

Version 1.15.0 supports a versioned athlete profile so stable facts do not depend on chat memory. The public repository ships only a generic example profile with unknown values left unset. Supply your own private profile with `ATHLETE_PROFILE_PATH` or `ATHLETE_PROFILE_JSON`, and inspect it with `coros_read(operation="get_athlete_profile")`.

Override the bundled profile with `ATHLETE_PROFILE_PATH` or `ATHLETE_PROFILE_JSON`. Do not place credentials in this profile. Current pain, illness, fatigue, equipment changes and other time-varying facts must still be supplied at decision time.

Calendar assignments, moves, swaps, structured-workout scheduling, duplication, week plans, range shifts and range copies are preflighted against the preceding and following 14 days. A missing COROS activity or calendar source makes a proposed write fail closed. Hard conflicts are blocked; warnings remain visible and never silently change another session.

If COROS invalidates the Training Hub access token, API calls automatically authenticate once with the configured environment credentials and retry. Concurrent refresh attempts are coalesced to avoid tokens invalidating each other.

Calendar swaps use three verified single-entry moves through a temporary empty day because COROS rejects simultaneous two-entry updates. If an intermediate move fails, the server attempts to roll both entries back to their original dates.

## Example conversation

> "Search for chest exercises with bodyweight"
>
> "Create a workout called 'Quick Push' with 4x15 Push-ups, 3x10 Diamond Push-ups, and 3x20 Decline Push-ups with 45s rest"

## Updating the exercise catalog

The bundled exercise catalog (`data/exercises.json`) is a static snapshot. If COROS adds new exercises, use the `update_exercises` tool to refresh it. This fetches the latest exercises from the COROS API and i18n strings from the CDN, rebuilds the catalog, and reloads the in-memory cache — all in a single tool call. Requires authentication.

## Auth notes

- **Region**: `eu` (Europe) or `us` (US). Defaults to `eu`.
- **Session conflict**: Logging in via this API invalidates your COROS web app session, and vice versa.
- Auth tokens are stored at `~/.config/coros-workout-mcp/auth.json` (mode 0600).

## Development

```bash
npm test           # Run unit tests
npm run test:watch # Watch mode
npm run build      # Compile TypeScript
```

## v2.1.0 — Athlete Intelligence

v2.1 extends the stable compatibility bridge without increasing the 56-tool MCP catalog. New read operations are available through `coros_read`:

- `athlete_intelligence` — combined intelligence report.
- `personal_recovery_model` — observed 24/48/72 h recovery response by session type.
- `residual_fatigue_model` — decaying residual planning stress from recent sessions.
- `session_fingerprints` — athlete-specific session distributions.
- `performance_trend` — recent vs prior endurance trend with terrain/weather caveat.
- `training_dose_optimizer` — conservative personalized dose factor.
- `event_readiness` — explainable event-preparation index, not an outcome probability.
- `anomaly_data_quality` — personal-baseline anomaly and source-completeness checks.

The season engine now enters taper at <=14 days before a dated objective. Athlete Intelligence never imputes missing physiological fields and labels heuristic/associational outputs explicitly.

### Deployment verification

After deploying, verify `connector_status.version === 2.1.0`, call `coros_capabilities`, then smoke-test `athlete_intelligence` for a recent date. Existing write operations and the 56 visible MCP tools are unchanged.


## v2.1.1 precision patch

Performance trends are discipline-specific; event readiness separates current state from projected event-date freshness; priority-A late long sessions are blocked by simulation in the final 10 days. Official sleep remains supplied through the official COROS MCP OAuth calling platform via `officialSleepRecords`; the server never re-enables unofficial mobile login.
