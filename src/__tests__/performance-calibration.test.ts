import { describe, expect, it } from "vitest";
import type { ActivitySummary } from "../coros-api.js";
import { buildMultisportLoadReport, calibrateSportPerformance } from "../performance-calibration.js";

function activity(overrides: Partial<ActivitySummary>): ActivitySummary {
  return {
    activityId: "a", date: "20260901", name: "Test", sportType: 200, sportName: "Road Bike",
    startTime: null, durationSeconds: 3600, distanceMeters: 30000, averageHeartRate: 120,
    maximumHeartRate: null, calories: 500, trainingLoad: 50, averagePower: null,
    normalizedPower: null, elevationGain: 0, ...overrides,
  };
}

describe("personal performance calibration", () => {
  it("recovers an effective speed and ascent cost from varied cycling samples", () => {
    const distanceAndGain = [[60, 200], [80, 800], [100, 1500], [120, 2400], [45, 50], [90, 400], [130, 2200], [70, 1200]];
    const activities = distanceAndGain.map(([distanceKm, gain], index) => activity({
      activityId: `ride-${index}`,
      date: `202608${String(index + 1).padStart(2, "0")}`,
      distanceMeters: distanceKm * 1000,
      elevationGain: gain,
      durationSeconds: (distanceKm / 30 * 60 + gain / 100 * 3) * 60,
    }));
    const result = calibrateSportPerformance(activities, "cycling");
    expect(result.available).toBe(true);
    expect(result.calibratedParameters?.effectiveBaseSpeedKmh).toBeCloseTo(30, 1);
    expect(result.calibratedParameters?.ascentPenaltyMinutesPer100m).toBeCloseTo(3, 1);
    expect(result.fit?.confidence).toBe("high");
  });

  it("excludes indoor cycling and refuses fewer than three comparable samples", () => {
    const result = calibrateSportPerformance([
      activity({ activityId: "outdoor" }),
      activity({ activityId: "indoor", sportType: 201, sportName: "Indoor Cycling" }),
    ], "cycling");
    expect(result.available).toBe(false);
    expect(result.sampleCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it("marks a boundary-limited homogeneous fit as low confidence", () => {
    const activities = [60, 80, 100, 120].map((distanceKm, index) => activity({
      activityId: `hilly-${index}`,
      date: `202608${String(index + 1).padStart(2, "0")}`,
      distanceMeters: distanceKm * 1000,
      elevationGain: distanceKm * 18,
      durationSeconds: distanceKm / 22 * 3600,
    }));
    const result = calibrateSportPerformance(activities, "cycling");
    expect(result.available).toBe(true);
    expect(result.fit?.confidence).toBe("low");
  });

  it("keeps COROS load, impact exposure and strength duration separate", () => {
    const report = buildMultisportLoadReport([
      activity({ activityId: "run", sportType: 100, sportName: "Running", durationSeconds: 3600, distanceMeters: 10000, trainingLoad: 100 }),
      activity({ activityId: "strength", sportType: 402, sportName: "Strength", durationSeconds: 1800, distanceMeters: 0, trainingLoad: 5 }),
      activity({ activityId: "walk", sportType: 900, sportName: "Walking", durationSeconds: 3600, distanceMeters: 5000, trainingLoad: 15 }),
    ]) as { totals: { corosCardiovascularTrainingLoad: number; impactExposureMinutesEquivalent: number; strengthDurationMinutes: number } };
    expect(report.totals.corosCardiovascularTrainingLoad).toBe(120);
    expect(report.totals.impactExposureMinutesEquivalent).toBe(81);
    expect(report.totals.strengthDurationMinutes).toBe(30);
  });
});
