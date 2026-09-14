import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGpxRoute, analyzeRouteWeather, simulateUltraRoute } from "../route-analysis.js";

const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Test Route</name><trkseg>
<trkpt lat="43.0000" lon="-2.0000"><ele>100</ele></trkpt>
<trkpt lat="43.0100" lon="-2.0000"><ele>120</ele></trkpt>
<trkpt lat="43.0200" lon="-2.0000"><ele>110</ele></trkpt>
</trkseg></trk></gpx>`;

afterEach(() => vi.unstubAllGlobals());

describe("GPX route analysis", () => {
  it("calculates route geometry and bounded sectors", () => {
    const result = analyzeGpxRoute(GPX, 2);
    expect(result.name).toBe("Test Route");
    expect(result.pointCount).toBe(3);
    expect(result.distanceKm).toBeGreaterThan(2.1);
    expect(result.distanceKm).toBeLessThan(2.3);
    expect(result.elevationGainMeters).toBe(20);
    expect(result.elevationLossMeters).toBe(10);
    expect(result.segments).toHaveLength(2);
  });

  it("produces ordered optimistic, probable and conservative scenarios", () => {
    const result = simulateUltraRoute(GPX, "2026-09-04T08:00:00+02:00", 25, 30, 45, 2) as {
      scenarios: Array<{ scenario: string; totalHours: number; checkpoints: unknown[] }>;
    };
    expect(result.scenarios.map((scenario) => scenario.scenario)).toEqual(["optimistic", "probable", "conservative"]);
    expect(result.scenarios[0].totalHours).toBeLessThan(result.scenarios[1].totalHours);
    expect(result.scenarios[1].totalHours).toBeLessThan(result.scenarios[2].totalHours);
    expect(result.scenarios[1].checkpoints).toHaveLength(2);
  });

  it("maps hourly weather and relative wind to each route sector", async () => {
    const route = analyzeGpxRoute(GPX, 2);
    const hourly = {
      time: ["2026-09-04T06:00", "2026-09-04T07:00"],
      temperature_2m: [15, 16], precipitation_probability: [10, 60], precipitation: [0, 1],
      wind_speed_10m: [20, 20], wind_direction_10m: [180, 180], wind_gusts_10m: [45, 45], is_day: [1, 1],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(route.segments.map(() => ({ hourly }))), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await analyzeRouteWeather(GPX, "2026-09-04T06:00:00Z", 20, 0, 2) as { sectors: Array<{ weather: { temperatureCelsius: number }; risks: string[] }> };
    expect(result.sectors).toHaveLength(2);
    expect(result.sectors[0].weather.temperatureCelsius).toBe(15);
    expect(result.sectors.some((sector) => sector.risks.includes("strong-gusts"))).toBe(true);
  });

  it("retries an Open-Meteo rate limit response", async () => {
    const alternateGpx = GPX.replaceAll("-2.0000", "-2.1000");
    const route = analyzeGpxRoute(alternateGpx, 2);
    const hourly = {
      time: ["2026-09-04T06:00"], temperature_2m: [15], precipitation_probability: [0], precipitation: [0],
      wind_speed_10m: [5], wind_direction_10m: [180], wind_gusts_10m: [8], is_day: [1],
    };
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(route.segments.map(() => ({ hourly }))), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mockedFetch);
    const result = await analyzeRouteWeather(alternateGpx, "2026-09-04T06:00:00Z", 20, 0, 2) as { sectors: unknown[] };
    expect(result.sectors).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to MET Norway when Open-Meteo remains rate limited", async () => {
    const fallbackGpx = GPX.replaceAll("-2.0000", "-2.2000");
    let openMeteoCalls = 0;
    const metBody = {
      properties: { timeseries: [{
        time: "2026-09-04T06:00:00Z",
        data: { instant: { details: { air_temperature: 14, wind_speed: 5, wind_from_direction: 180 } }, next_1_hours: { summary: { symbol_code: "cloudy_day" }, details: { precipitation_amount: 0.2 } } },
      }] },
    };
    const mockedFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("open-meteo.com")) {
        openMeteoCalls++;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify(metBody), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", mockedFetch);
    const result = await analyzeRouteWeather(fallbackGpx, "2026-09-04T06:00:00Z", 20, 0, 2) as {
      source: { provider: string; fallbackReason: string };
      sectors: Array<{ weather: { temperatureCelsius: number; windSpeedKmh: number } }>;
    };
    expect(openMeteoCalls).toBe(3);
    expect(result.source.provider).toContain("MET Norway");
    expect(result.source.fallbackReason).toContain("429");
    expect(result.sectors[0].weather.temperatureCelsius).toBe(14);
    expect(result.sectors[0].weather.windSpeedKmh).toBe(18);
  });

  it("rejects malformed GPX instead of estimating a route", () => {
    expect(() => analyzeGpxRoute("not-gpx", 25)).toThrow("not a GPX");
  });
});
