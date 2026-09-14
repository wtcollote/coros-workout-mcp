# COROS Workout MCP 1.9.2

Weather-provider resilience update.

- Keeps Open-Meteo as the primary route forecast provider.
- Falls back automatically to MET Norway Locationforecast after Open-Meteo retries fail.
- Queries at most eight representative route locations on fallback and maps each sector to the nearest sample.
- Uses an identifying User-Agent, four-decimal coordinates, caching and provider attribution as required by MET Norway.
- Reports the active provider and the primary-provider failure reason in every response.
- Keeps the same 49-tool MCP catalog.

MET Norway fallback does not always expose precipitation probability or gusts. Missing values remain `null` and are not estimated.
