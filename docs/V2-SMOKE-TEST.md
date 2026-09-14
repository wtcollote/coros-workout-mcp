# COROS Workout v2.0 — production smoke test

Run these after Render reports a healthy deployment.

1. `connector_status`
   - version: `2.0.0`
   - expectedToolCount: `56`
   - authenticated: expected account state
   - features include `adaptive-coaching-engine` and `longitudinal-athlete-learning`

2. `coros_capabilities`
   - bridgeVersion: `2`
   - read operations include all five v2 operations

3. `coros_read: longitudinal_athlete_model`
   - returns modelVersion `2.0`
   - confidence present
   - missing values remain null

4. `coros_read: adaptive_coaching_engine`
   - returns one decision + confidence + evidence + recommendation
   - does not invent a workout when calendar is empty

5. `coros_read: simulate_training_change`
   - simulationOnly = true
   - no calendar mutation
   - guard outcome present

6. `coros_read: season_strategy`
   - objective / daysToObjective / inferredPhase present

7. `coros_read: evaluate_prior_decision`
   - verdict is observational and does not claim causation

8. Existing regression checks
   - list activities
   - read daily metrics
   - list calendar
   - analyze FIT activity
   - professional coaching analysis
   - training context analysis
   - validate calendar change

9. Write smoke test (only after explicit user confirmation)
   - validate a harmless future change first
   - perform one calendar write
   - re-read calendar and confirm exact date/workout identity
