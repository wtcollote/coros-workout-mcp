# COROS Workout MCP 1.8.0

## New tools

- `get_activity_export_url`: requests a temporary COROS export URL in FIT, GPX, TCX, KML or CSV.
- `analyze_fit_activity`: downloads FIT data and returns compact record-level analysis of heart rate, cadence, speed, power, temperature, stops, climbs, aerobic decoupling and finish quality.
- `get_athlete_profile_metrics`: consolidates VO2max, lactate-threshold values, fitness, training indices, HRV and resting heart rate with coverage and period trends.

## Safety and output limits

- FIT downloads are limited to 50 MB.
- Raw second-by-second records are never returned through MCP.
- Stops are capped at 20 and climbs at a caller-selected maximum of 20.
- Missing sensor or physiological values remain `null`; they are not estimated.
- All three tools are read-only.

## Deployment

Upload the repository contents to the existing GitHub repository. Render should rebuild automatically from `package-lock.json` using Node 22. After deployment, refresh the ChatGPT connector so its catalog changes from 43 to 46 tools.

## Verification

- TypeScript build: passed.
- Automated tests: 46 passed.
- Registered MCP tools: 46.
- A live COROS FIT download was not executed in the build workspace because account credentials were not available there.
