# COROS Workout MCP 1.10.0

## Operational route planning

Adds `plan_operational_route`, a read-only tool that consolidates:

- optimistic, probable and conservative timing scenarios;
- named stops with duration and notes;
- heuristic climb detection and categorization;
- daylight, civil twilight and night classification by sector;
- carbohydrate, fluid and sodium schedules;
- route weather through Open-Meteo with the MET Norway fallback.

The tool does not discover businesses or opening hours. Service locations must be supplied as named stops until a dependable places provider is integrated.

## Connector metadata

- Version: `1.10.0`
- Expected tools: `50`
