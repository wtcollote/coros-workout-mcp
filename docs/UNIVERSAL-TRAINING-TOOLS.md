# Universal training-data operations

**Language:** **English** · [Español](UNIVERSAL-TRAINING-TOOLS-ES.md)

These operations make the connector usable across COROS, Strava, Garmin and FIT files through the existing provider-neutral layer.

They are **not new top-level MCP tools**. The visible MCP catalog remains stable at 56 tools. Discover them with `coros_capabilities`, then call them through `coros_read`.

## Operations

### `training_data_status`
Returns the default provider, configured providers, availability and capabilities without exposing secret values.

```json
{"operation":"training_data_status","input":{}}
```

### `setup_check`
Runs a safe installation/configuration diagnostic for Node, COROS credentials presence, optional Strava/Garmin providers and FIT file analysis.

```json
{"operation":"setup_check","input":{}}
```

No passwords, tokens or credential values are returned.

### `list_training_providers`
Lists the registered providers and their capabilities.

```json
{"operation":"list_training_providers","input":{}}
```

COROS is the default provider. Strava and Garmin are optional. The `file` provider supplies FIT/GPX analysis capabilities.

### `list_provider_activities`
Returns normalized activity summaries from any provider implementing the `activities` capability.

```json
{
  "operation":"list_provider_activities",
  "input":{
    "providerId":"coros",
    "startDate":"2026-08-01",
    "endDate":"2026-09-14",
    "page":1,
    "size":100
  }
}
```

Use `strava` or `garmin` instead of `coros` when those providers are configured.

### `training_trends`
Aggregates normalized volume and load over configurable windows such as 7, 28 and 90 days.

```json
{
  "operation":"training_trends",
  "input":{
    "providerId":"coros",
    "endDate":"2026-09-14",
    "windows":[7,28,90]
  }
}
```

The result includes activity count, duration, distance, elevation, available training load, average HR/power, average speed and sport breakdown.

### `compare_activities`
Compares up to 10 normalized activities. The first selected activity is used as the percentage-change baseline.

```json
{
  "operation":"compare_activities",
  "input":{
    "providerId":"strava",
    "startDate":"2026-08-01",
    "endDate":"2026-09-14",
    "activityIds":["123","456"]
  }
}
```

If `activityIds` is omitted, the first activities returned in the requested range are compared.

### `import_activity_file`
Analyzes a FIT file without requiring a sports-platform account. Supply the FIT bytes as base64.

```json
{
  "operation":"import_activity_file",
  "input":{
    "fitBase64":"<BASE64 FIT BYTES>",
    "name":"Morning ride"
  }
}
```

The result contains the detailed FIT analysis plus a normalized activity summary suitable for common downstream processing.

## Data rules

- Missing provider fields remain `null`; they are not invented.
- COROS remains the default provider unless another `providerId` is requested.
- Strava and Garmin require their own provider configuration.
- FIT import works through the local `file` provider and does not require COROS, Strava or Garmin.
- `import_activity_file` currently imports FIT activity files. GPX remains handled by the route-analysis operations.
- Provider activity pagination is bounded and trend/history reads report when returned data is truncated.

## Recommended first calls

After installation:

1. `coros_capabilities`
2. `coros_read(operation="setup_check")`
3. `coros_read(operation="training_data_status")`
4. `coros_read(operation="list_training_providers")`

Then choose a configured provider for activities, trends and comparisons.
