# COROS Workout MCP 1.8.1

Maintenance release for the FIT and physiological analysis package.

## Improvements

- Ignores apparent stops near the beginning and end of an activity; the boundary is configurable and defaults to 60 seconds.
- Classifies record-level aerobic decoupling as `improved`, `stable`, `moderate`, or `high`.
- Reports percentage changes in heart rate, cadence, and speed between the preceding quarter and final quarter.
- Accepts optional heart-rate and cadence targets and reports final-quarter in-range compliance.
- Replaces first-versus-last physiological trends with recent seven-day averages versus the preceding seven days, plus the complete-period average.
- Rejects reversed heart-rate or cadence target ranges.

## Verification

- TypeScript build passed.
- 46 automated tests passed.
- 46 MCP tools registered.
