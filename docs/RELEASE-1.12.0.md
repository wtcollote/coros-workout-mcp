# COROS Workout MCP 1.12.0

## Personal performance calibration

Adds `calibrate_sport_performance`. It fits effective base speed/pace and ascent cost from comparable COROS activity summaries using a robust median-error grid search. Sport-specific and observed-speed bounds prevent mathematically good but physiologically implausible parameter pairs. Boundary fits are marked low-confidence. Outdoor cycling calibration excludes indoor cycling.

`plan_operational_route` can apply this calibration automatically with `usePersonalCalibration=true`. Explicit user pace, speed or ascent parameters take precedence. Low-confidence fits are reported but not applied unless `allowLowConfidenceCalibration=true` is explicitly supplied.

## Multisport load

Adds `analyze_multisport_load`:

- COROS cardiovascular training load remains a distinct source metric;
- impact exposure is an explicitly labelled duration heuristic;
- strength is reported as recorded duration, without inventing muscular load;
- active-recovery candidate time is tracked separately;
- activity-kind and recorded-day breakdowns are included.

## Connector metadata

- Version: `1.12.0`
- Expected tools: `53`
