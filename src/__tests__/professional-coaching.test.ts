import { describe, expect, it } from "vitest";
import type { ActivitySummary, DailyMetricRecord, HrvRecord, SleepRecord } from "../coros-api.js";
import { buildProfessionalCoachingAnalysis, type ProfessionalCoachingInput, type ProfessionalCoachingSources } from "../professional-coaching.js";

function input(overrides: Partial<ProfessionalCoachingInput> = {}): ProfessionalCoachingInput {
  return {
    date: "20260904",
    primaryDiscipline: "ultra_endurance",
    analysisScope: "daily",
    constraints: [],
    subjective: {},
    ...overrides,
  };
}

function metric(overrides: Partial<DailyMetricRecord> = {}): DailyMetricRecord {
  return {
    date: "20260904", avgSleepHrv: 60, hrvBaseline: 60, restingHeartRate: 48,
    trainingLoad: 40, trainingLoadRatio: 1, fatigueRate: 20, acuteTrainingIndex: 50,
    chronicTrainingIndex: 50, performance: 1, distanceMeters: 0, durationSeconds: 0,
    vo2max: 50, lactateThresholdHeartRate: 165, lactateThresholdPace: 270,
    fitnessLevel: 60, fitnessLevel7d: 1, ...overrides,
  };
}

function sleep(overrides: Partial<SleepRecord> = {}): SleepRecord {
  return {
    date: "20260904", totalDurationMinutes: 480, deepMinutes: 90, lightMinutes: 240,
    remMinutes: 120, awakeMinutes: 30, napMinutes: 0, averageHeartRate: 50,
    minimumHeartRate: 42, maximumHeartRate: 70, qualityScore: 85, ...overrides,
  };
}

function hrv(overrides: Partial<HrvRecord> = {}): HrvRecord {
  return { date: "20260904", average: 60, baseline: 60, standardDeviation: 5, intervals: null, ...overrides };
}

function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    activityId: "ride", date: "20260903", name: "Endurance", sportType: 200,
    sportName: "Road Bike", startTime: null, durationSeconds: 7200, distanceMeters: 60000,
    averageHeartRate: 125, maximumHeartRate: 150, calories: 1000, trainingLoad: 90,
    averagePower: null, normalizedPower: null, elevationGain: 800, ...overrides,
  };
}

function sources(overrides: Partial<ProfessionalCoachingSources> = {}): ProfessionalCoachingSources {
  return {
    sleep: [sleep()], hrv: [hrv()], dailyMetrics: [metric()], activities: [activity()],
    plannedWorkouts: [], sourceErrors: [], ...overrides,
  };
}

describe("professional coaching analysis", () => {
  it("keeps observed evidence, interpretation and recommendation separate", () => {
    const result = buildProfessionalCoachingAnalysis(input({ subjective: { perceivedFatigue: 3, pain: 0 } }), sources()) as Record<string, any>;
    expect(result.observedEvidence.current.sleep.totalDurationMinutes).toBe(480);
    expect(result.coachingInterpretation.decision).toBe("maintain");
    expect(result.practicalRecommendation.action).toContain("no workout is invented");
    expect(result.interpretationContract).toContain("Missing values remain null and are never estimated.");
  });

  it("lets illness and severe pain override favorable wearable data", () => {
    const result = buildProfessionalCoachingAnalysis(input({
      constraints: ["hip CAM"],
      subjective: { illnessSymptoms: true, pain: 8, perceivedFatigue: 2 },
    }), sources()) as Record<string, any>;
    expect(result.coachingInterpretation.decision).toBe("stop_and_assess");
    expect(result.coachingInterpretation.warningEvidence.join(" ")).toContain("illness");
    expect(result.coachingInterpretation.sportSpecificPriorities.join(" ")).toContain("hip CAM");
  });

  it("does not make a confident training decision from sparse wearable data alone", () => {
    const result = buildProfessionalCoachingAnalysis(input(), sources({ sleep: [], hrv: [], dailyMetrics: [] })) as Record<string, any>;
    expect(result.coachingInterpretation.decision).toBe("insufficient_data");
    expect(result.coachingInterpretation.confidence).toBe("low");
  });

  it("flags strength and trail limitations instead of treating COROS load as complete", () => {
    const result = buildProfessionalCoachingAnalysis(input({ subjective: { perceivedFatigue: 4 } }), sources({
      activities: [
        activity({ activityId: "strength", sportType: 402, sportName: "Strength", trainingLoad: 5 }),
        activity({ activityId: "trail", sportType: 102, sportName: "Trail Running", trainingLoad: 80 }),
      ],
    })) as Record<string, any>;
    expect(result.uncertaintyAndMissingData.join(" ")).toContain("Strength stress");
    expect(result.uncertaintyAndMissingData.join(" ")).toContain("technicality");
  });

  it("does not recommend modifying a planned workout that already appears completed", () => {
    const planned = {
      planId: "plan", idInPlan: "1", planProgramId: "1", date: "20260904", sortNo: 1,
      workoutId: "workout", name: "Core + Hombros Ultra", sportType: 4, duration: 900, distance: 0,
    };
    const completed = activity({ date: "20260904", name: "Core + Hombros Ultra", sportType: 402, sportName: "Strength" });
    const result = buildProfessionalCoachingAnalysis(input({ subjective: { perceivedFatigue: 7 } }), sources({
      activities: [completed], plannedWorkouts: [planned],
    })) as Record<string, any>;
    expect(result.coachingInterpretation.decision).toBe("reduce");
    expect(result.practicalRecommendation.action).toContain("appears completed");
    expect(result.practicalRecommendation.action).toContain("Do not repeat");
  });
});
