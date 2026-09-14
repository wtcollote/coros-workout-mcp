# COROS Workout MCP 1.14.0

## Professional coaching analysis

Adds `professional_coaching_analysis` as a read operation inside the stable `coros_read` bridge. No new top-level MCP tool is introduced, so the expected visible catalog remains at 56 tools and chats that already loaded version 1.13.0 can discover the operation through `coros_capabilities`.

Also adds `coaching_methodology_catalog`, which makes the versioned coaching doctrine inspectable and filterable by sport, category and evidence maturity. Its governance metadata includes the evidence-review date and explicitly separates established, context-dependent, emerging and historical methods.

The operation gathers up to 28 days of:

- sleep duration, stages and quality;
- HRV and COROS baseline;
- resting heart rate, training load, load ratio, fatigue and fitness fields;
- completed cycling, running, trail, walking, hiking, strength and mobility activities;
- cardiovascular load, impact exposure, strength duration and active-recovery candidates;
- the target day and next seven days of the COROS calendar;
- optional subjective fatigue, soreness, pain, illness, constraints, objective and event context.

The response separates:

1. recorded evidence and calculated trends;
2. professional coaching interpretation;
3. a practical training recommendation;
4. uncertainty, missing sources and known analytical limitations.

## Coaching policy

The server now instructs compatible clients to interpret analytical results as professional endurance-coaching decision support for cycling, road running, trail running, strength integration and ultra-endurance. The hierarchy is explicit: reported pain/illness, acute recovery, multisport load and impact, calendar/session purpose, event proximity and sport specificity.

The method recognizes traditional and block periodization, polarized, pyramidal and threshold-focused intensity distributions, and event-specific tapering. It does not declare any one model universally superior or infer a prescription from a single metric. Missing values remain null, subjective symptoms override favorable wearable metrics, and medical diagnosis is outside scope.

## Safety and compatibility

- Read-only operation; it never changes the COROS calendar.
- A separate confirmed write is still required for scheduling changes.
- No synthetic readiness score, heart-rate zone or muscular-load score is manufactured.
- Partial upstream failures are returned as source-specific uncertainty.
- Version: `1.14.0`
- Expected top-level tools: `56`
- Compatibility bridge: `1`
