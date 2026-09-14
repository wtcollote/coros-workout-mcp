import { describe, expect, it } from "vitest";
import { detectRouteClimbs, getSolarPhase, planOperationalRoute } from "../operational-route.js";

const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Operational test</name><trkseg>
<trkpt lat="43.0000" lon="-2.0000"><ele>50</ele></trkpt>
<trkpt lat="43.0100" lon="-2.0000"><ele>90</ele></trkpt>
<trkpt lat="43.0200" lon="-2.0000"><ele>140</ele></trkpt>
<trkpt lat="43.0300" lon="-2.0000"><ele>210</ele></trkpt>
<trkpt lat="43.0400" lon="-2.0000"><ele>250</ele></trkpt>
<trkpt lat="43.0500" lon="-2.0000"><ele>210</ele></trkpt>
<trkpt lat="43.0600" lon="-2.0000"><ele>160</ele></trkpt>
<trkpt lat="43.0700" lon="-2.0000"><ele>170</ele></trkpt>
<trkpt lat="43.0800" lon="-2.0000"><ele>160</ele></trkpt>
<trkpt lat="43.0900" lon="-2.0000"><ele>150</ele></trkpt>
</trkseg></trk></gpx>`;

describe("operational route planning", () => {
  it("detects a material climb from GPX elevation", () => {
    const climbs = detectRouteClimbs(GPX);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].accumulatedGainMeters).toBe(200);
    expect(climbs[0].category).toBe("4");
  });

  it("combines scenarios, stops, daylight and fueling without weather", async () => {
    const result = await planOperationalRoute(GPX, {
      startTimeIso: "2026-09-05T08:00:00+02:00",
      flatSpeedKmh: 20,
      segmentDistanceKm: 5,
      unallocatedStopMinutes: 10,
      plannedStops: [{ name: "Refill", km: 7, durationMinutes: 15 }],
      carbsGramsPerHour: 80,
      fluidMlPerHour: 500,
      sodiumMgPerHour: 500,
      fuelingIntervalMinutes: 30,
      includeWeather: false,
    }) as {
      scenarios: Array<{ scenario: string; totalHours: number; checkpoints: Array<{ scheduledStops: Array<{ name: string }> }>; stopSchedule: Array<{ name: string; arrivalTime: string; departureTime: string }> }>;
      daylight: { timeline: Array<{ phase: string }> };
      fueling: { schedule: unknown[]; probableTotals: { carbohydrateGrams: number } };
      weather: { status: string };
    };
    expect(result.scenarios.map((scenario) => scenario.scenario)).toEqual(["optimistic", "probable", "conservative"]);
    expect(result.scenarios[0].totalHours).toBeLessThan(result.scenarios[1].totalHours);
    expect(result.scenarios[1].totalHours).toBeLessThan(result.scenarios[2].totalHours);
    expect(result.scenarios[1].checkpoints.some((checkpoint) => checkpoint.scheduledStops.some((stop) => stop.name === "Refill"))).toBe(true);
    expect(result.scenarios[1].stopSchedule[0].name).toBe("Refill");
    expect(new Date(result.scenarios[1].stopSchedule[0].departureTime).getTime()).toBeGreaterThan(new Date(result.scenarios[1].stopSchedule[0].arrivalTime).getTime());
    expect(result.daylight.timeline.every((entry) => entry.phase === "day")).toBe(true);
    expect(result.fueling.schedule.length).toBeGreaterThan(0);
    expect(result.fueling.probableTotals.carbohydrateGrams).toBeGreaterThan(0);
    expect(result.weather.status).toBe("not-requested");
  });

  it("classifies midnight as night at the route latitude", () => {
    expect(getSolarPhase(new Date("2026-09-05T00:00:00Z"), { latitude: 43, longitude: -2 }).phase).toBe("night");
  });

  it("applies a slower trail model with ascent, descent and terrain costs", async () => {
    const road = await planOperationalRoute(GPX, {
      startTimeIso: "2026-09-05T08:00:00+02:00",
      activityType: "road_running",
      basePaceMinutesPerKm: 6,
      segmentDistanceKm: 5,
      includeWeather: false,
    }) as { scenarios: Array<{ scenario: string; totalHours: number }>; assumptions: { activityType: string } };
    const trail = await planOperationalRoute(GPX, {
      startTimeIso: "2026-09-05T08:00:00+02:00",
      activityType: "trail_running",
      basePaceMinutesPerKm: 6,
      segmentDistanceKm: 5,
      includeWeather: false,
    }) as { scenarios: Array<{ scenario: string; totalHours: number }>; assumptions: { activityType: string } };
    expect(road.assumptions.activityType).toBe("road_running");
    expect(trail.assumptions.activityType).toBe("trail_running");
    expect(trail.scenarios[1].totalHours).toBeGreaterThan(road.scenarios[1].totalHours);
  });

  it("rejects a named stop beyond the finish", async () => {
    await expect(planOperationalRoute(GPX, {
      startTimeIso: "2026-09-05T08:00:00+02:00",
      flatSpeedKmh: 20,
      plannedStops: [{ name: "Impossible", km: 500, durationMinutes: 10 }],
      includeWeather: false,
    })).rejects.toThrow("outside the route distance");
  });
});
