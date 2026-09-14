# COROS Workout MCP — prioritized improvements

## P0 — route execution

1. **Verified route services and POIs**
   - Find fountains, shops, petrol stations, cafés and shelters within a configurable distance of a GPX.
   - Preserve source, coordinates, route deviation, opening hours and verification timestamp.
   - Never label an establishment as available when hours cannot be verified.

2. **Terrain-resolved personal calibration**
   - Learn speed and heart-rate behavior from FIT sectors rather than activity summaries.
   - Separate flat speed, climbing cost, technical descents, stops, heat and wind.
   - Compare predicted versus actual arrival at route checkpoints after every relevant activity.

3. **Operational route dossier**
   - Produce one bounded result containing elevation profile data, climbs, local-time checkpoints, verified services, weather, daylight, fueling and contingency points.
   - Keep calculations machine-readable so ChatGPT can render a chart or table without reparsing prose.

## P1 — daily coaching quality

4. **Persistent athlete preferences — foundation delivered in v1.15.0**
   - The versioned profile now stores stable discipline, metric availability, injury constraint, week convention and objective outside chat memory.
   - Next: add confirmed HR/cadence zones, equipment, nutrition tolerance, bottle capacity and a safe persistent update workflow.

5. **Fueling execution feedback**
   - Record planned versus consumed carbohydrate, fluid and sodium when the athlete supplies it.
   - Track GI tolerance and product combinations without inventing missing intake data.

6. **Strength progression**
   - Track exercise exposure, sets, repetitions and load only when COROS or the user provides them.
   - Detect repeated muscle-group stress and place strength around key endurance sessions.

## P2 — reliability and scale

7. **Mobile-session coexistence — delivered in v1.16.0**
   - Unofficial mobile login is fail-closed by default so the official phone app remains signed in.
   - Official COROS MCP OAuth sleep records can be injected into the professional coaching analysis without storing another token in this service.
   - Next: extend the normalized recovery input to every legacy daily/weekly summary operation.

8. **Multi-user authentication isolation**
   - Replace shared environment credentials with per-user OAuth/token storage before offering the MCP to other people.
   - Encrypt tokens, isolate accounts and add revoke/delete controls.

9. **COROS API contract monitoring**
   - Add scheduled smoke tests for authentication, reads and non-mutating payload validation.
   - Report upstream API changes before they break calendar or activity workflows.

10. **Persistent MCP sessions experiment**
   - Evaluate session-aware Streamable HTTP and tool-list change notifications.
   - Keep the stable compatibility bridge because hosted ChatGPT refresh behavior is not guaranteed.

11. **Optional route dashboard**
    - Add an MCP App widget only when interactive maps and elevation annotations materially improve the workflow.
    - Keep the core connector usable without a UI.
