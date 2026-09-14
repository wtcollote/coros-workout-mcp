import { describe, expect, it } from "vitest";
import { summarizeActivities } from "../providers/training-data-analytics.js";
import type { TrainingActivitySummary } from "../providers/training-data-types.js";

const activity = (id: string, overrides: Partial<TrainingActivitySummary> = {}): TrainingActivitySummary => ({
  activityId: id, date: "2026-09-01", name: id, sportType: null, sportName: "cycling", startTime: null,
  durationSeconds: 3600, distanceMeters: 30000, averageHeartRate: 140, maximumHeartRate: 170,
  calories: null, trainingLoad: 100, averagePower: 200, normalizedPower: 220, elevationGain: 500, ...overrides,
});

describe("universal training analytics", () => {
  it("summarizes normalized activities without inventing missing data", () => {
    const result = summarizeActivities([activity("a"), activity("b", { durationSeconds: 1800, distanceMeters: 10000, trainingLoad: null })]);
    expect(result.count).toBe(2);
    expect(result.durationSeconds).toBe(5400);
    expect(result.distanceMeters).toBe(40000);
    expect(result.trainingLoad).toBe(100);
    expect(result.bySport[0]).toMatchObject({ sport: "cycling", count: 2 });
  });
});
