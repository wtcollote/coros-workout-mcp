import { describe, expect, it } from "vitest";
import type { ActivitySummary, ScheduledWorkout } from "../coros-api.js";
import { loadAthleteProfile } from "../athlete-profile.js";
import { buildTrainingContextAnalysis } from "../training-context.js";

function planned(overrides: Partial<ScheduledWorkout> = {}): ScheduledWorkout {
  return {
    planId: "plan", idInPlan: "1", planProgramId: "1", date: "20260905", sortNo: 1,
    workoutId: "workout", name: "Fondo específico RAS", sportType: 2, duration: 21600, distance: 0,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    activityId: "activity", date: "20260904", name: "Bici Z2", sportType: 200,
    sportName: "Road Bike", startTime: null, durationSeconds: 5400, distanceMeters: 40000,
    averageHeartRate: 125, maximumHeartRate: 145, calories: 600, trainingLoad: 70,
    averagePower: null, normalizedPower: null, elevationGain: 500, ...overrides,
  };
}

function analyze(overrides: Record<string, unknown> = {}) {
  return buildTrainingContextAnalysis({
    referenceDate: "20260906",
    window: { startDate: "20260823", endDate: "20260920", lookbackDays: 14, lookaheadDays: 14 },
    profile: loadAthleteProfile(), activities: [], planned: [], ...overrides,
  } as any) as Record<string, any>;
}

describe("full training context and professional calendar guard", () => {
  it("blocks strength on the day after a planned six-hour ride", () => {
    const result = analyze({
      planned: [planned()],
      proposed: { date: "20260906", name: "Fuerza funcional", sportType: 4, durationSeconds: 1500 },
    });
    expect(result.guard.outcome).toBe("block");
    expect(result.guard.canWrite).toBe(false);
    expect(result.guard.issues.some((item: any) => item.code === "post_long_recovery")).toBe(true);
  });

  it("allows an explicitly named recovery ride after the same long ride", () => {
    const result = analyze({
      planned: [planned()],
      proposed: { date: "20260906", name: "Recuperación suave", sportType: 2, durationSeconds: 2700 },
    });
    expect(result.guard.outcome).toBe("allow");
    expect(result.guard.canWrite).toBe(true);
  });

  it("fails closed when activity or calendar context cannot be loaded", () => {
    const result = analyze({
      sourceErrors: [{ source: "activities", error: "COROS timeout" }],
      proposed: { date: "20260906", name: "Rodaje", sportType: 1, durationSeconds: 2700 },
    });
    expect(result.guard.outcome).toBe("block");
    expect(result.guard.issues.some((item: any) => item.code === "insufficient_context")).toBe(true);
  });

  it("reports residual stress from a completed ultra-duration ride", () => {
    const result = analyze({ activities: [activity({ date: "20260905", durationSeconds: 7 * 3600, trainingLoad: 300 })] });
    expect(result.panorama.residualStress).toHaveLength(1);
    expect(result.panorama.residualStress[0].recoveryWindowHours).toBe(72);
  });

  it("matches completed and planned work but labels sport-only matching as provisional", () => {
    const result = analyze({
      activities: [activity({ date: "20260904", name: "Salida exterior" })],
      planned: [planned({ date: "20260904", name: "Bici Z2 programada", duration: 5400 })],
    });
    expect(result.panorama.planVsActual[0].status).toBe("matched_by_sport");
    expect(result.panorama.planVsActual[0].limitation).toContain("provisional");
  });

  it("loads a privacy-safe generic bundled profile by default", () => {
    const previous = process.env.ATHLETE_PROFILE_JSON;
    delete process.env.ATHLETE_PROFILE_JSON;
    try {
      const profile = loadAthleteProfile();
      expect(profile.profileId).toBe("example-athlete");
      expect(profile.primaryDiscipline).toBe("general_endurance");
      expect(profile.availableMetrics.power).toBeNull();
      expect(profile.preferredMetrics).toEqual([]);
      expect(profile.constraints).toEqual([]);
      expect(profile.objectives).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ATHLETE_PROFILE_JSON;
      else process.env.ATHLETE_PROFILE_JSON = previous;
    }
  });

  it("allows a deployment-private athlete profile through ATHLETE_PROFILE_JSON", () => {
    const previous = process.env.ATHLETE_PROFILE_JSON;
    process.env.ATHLETE_PROFILE_JSON = JSON.stringify({
      schemaVersion: "1",
      profileId: "deployment-athlete",
      primaryDiscipline: "cycling",
      secondaryDisciplines: ["running"],
      preferredMetrics: ["heart_rate"],
      availableMetrics: { power: true, heartRate: true, cadence: true },
      constraints: [],
      planning: { weekStartsOn: "monday", protectLongSessionRecovery: true, requireContextGuardForCalendarWrites: true },
      objectives: [],
      provenance: { source: "test environment", lastReviewed: "2026-09-14", unknownValuesRemainNull: true },
    });
    try {
      const profile = loadAthleteProfile();
      expect(profile.profileId).toBe("deployment-athlete");
      expect(profile.primaryDiscipline).toBe("cycling");
      expect(profile.preferredMetrics).toEqual(["heart_rate"]);
    } finally {
      if (previous === undefined) delete process.env.ATHLETE_PROFILE_JSON;
      else process.env.ATHLETE_PROFILE_JSON = previous;
    }
  });
});
