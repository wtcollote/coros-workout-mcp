# COROS Workout MCP 1.9.0

## New tools

- `analyze_gpx_route`: parses GPX track/route points and returns distance, elevation and fixed-distance sectors.
- `analyze_route_weather`: combines sector ETAs with hourly Open-Meteo temperature, precipitation, wind, gust, daylight and relative headwind/crosswind.
- `simulate_ultra_route`: creates optimistic, probable and conservative checkpoint and finish-time scenarios.

## Design limits

- GPX input is limited to 8 MB, 200,000 points and 100 returned sectors.
- Weather analysis uses a maximum 16-day forecast and must be refreshed near departure.
- Timing uses explicit speed, stop and climbing-penalty assumptions; it does not claim to predict performance automatically.
- Route weather is read-only and attributes Open-Meteo as the data provider.

## Verification

- TypeScript build passed.
- 50 automated tests passed.
- Live Open-Meteo smoke test passed.
- 49 MCP tools registered.
