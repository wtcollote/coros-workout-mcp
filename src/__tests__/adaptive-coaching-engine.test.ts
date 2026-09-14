import { describe, expect, it } from "vitest";
import { buildAdaptiveCoachingDecision, buildLongitudinalAthleteModel, buildSeasonStrategy, evaluatePriorDecision, simulateTrainingChange } from "../adaptive-coaching-engine.js";
import { loadAthleteProfile } from "../athlete-profile.js";

const profile = loadAthleteProfile();
const metric = (date: string, overrides: any = {}) => ({ date, avgSleepHrv: 50, hrvBaseline: 50, restingHeartRate: 48, trainingLoad: 0, trainingLoadRatio: 1, fatigueRate: 0, acuteTrainingIndex: 60, chronicTrainingIndex: 60, performance: 0, distanceMeters: 0, durationSeconds: 0, vo2max: null, lactateThresholdHeartRate: null, lactateThresholdPace: null, fitnessLevel: null, fitnessLevel7d: null, ...overrides });
const sleep = (date: string, minutes = 480) => ({ date, totalDurationMinutes: minutes, deepMinutes: 90, lightMinutes: 250, remMinutes: 110, awakeMinutes: 30, napMinutes: 0, averageHeartRate: 50, minimumHeartRate: 42, maximumHeartRate: 65, qualityScore: null });
const hrv = (date: string, average = 50, baseline = 50) => ({ date, average, baseline, standardDeviation: 5, intervals: null });
const activity = (date: string, overrides: any = {}) => ({ activityId: `${date}-a`, date, name: "Road bike", sportType: 200, sportName: "Road Bike", startTime: null, durationSeconds: 7200, distanceMeters: 60000, averageHeartRate: 125, maximumHeartRate: 145, calories: 800, trainingLoad: 100, averagePower: null, normalizedPower: null, elevationGain: 700, ...overrides });
const planned = (date: string, overrides: any = {}) => ({ planId: "p", idInPlan: date, planProgramId: date, date, sortNo: 1, workoutId: `w-${date}`, name: "Bici Z2", sportType: 2, duration: 5400, distance: 0, ...overrides });

function base() {
  const dates = Array.from({ length: 28 }, (_, i) => `202608${String(i + 1).padStart(2, "0")}`).filter((d) => Number(d.slice(-2)) <= 28);
  return { date: "20260901", profile, sleep: dates.map((d)=>sleep(d)), hrv: dates.map((d)=>hrv(d)), metrics: dates.map((d)=>metric(d)), activities: [activity("20260825"), activity("20260828")], planned: [planned("20260901")], subjective: {}, sourceErrors: [] } as any;
}

describe("adaptive coaching engine v2", () => {
  it("keeps a healthy day at maintain and never invents extra work", () => {
    const input = base();
    input.sleep.push(sleep("20260901")); input.hrv.push(hrv("20260901")); input.metrics.push(metric("20260901"));
    const result = buildAdaptiveCoachingDecision(input) as any;
    expect(result.decision).toBe("maintain");
    expect(result.recommendation).toContain("Maintain");
  });

  it("lets illness override favorable wearable data", () => {
    const input = base(); input.subjective = { illnessSymptoms: true };
    input.sleep.push(sleep("20260901")); input.hrv.push(hrv("20260901")); input.metrics.push(metric("20260901"));
    expect((buildAdaptiveCoachingDecision(input) as any).decision).toBe("stop_and_assess");
  });

  it("learns only observed longitudinal baselines", () => {
    const model = buildLongitudinalAthleteModel(base()) as any;
    expect(model.modelVersion).toBe("2.1");
    expect(model.observedBaselines.weeklyTrainingLoadMedian).not.toBeUndefined();
    expect(model.learningContract.join(" ")).toContain("does not claim causation");
  });

  it("blocks impact work the day after a very long ride", () => {
    const input = base();
    input.activities.push(activity("20260901", { durationSeconds: 6 * 3600, trainingLoad: 300 }));
    const result = simulateTrainingChange(input, { date: "20260902", name: "Carrera", sportType: 1, durationSeconds: 3600 }) as any;
    expect(result.guard.outcome).toBe("block");
  });

  it("builds a taper season strategy close to an objective", () => {
    const input = base(); input.objective = { name: "A race", eventDate: "20260908", priority: "A" };
    expect((buildSeasonStrategy(input) as any).inferredPhase).toBe("taper");
  });

  it("evaluates prior decisions without claiming causation", () => {
    const result = evaluatePriorDecision({ priorDecision: "reduce", priorDate: "20260901", evaluationDate: "20260904", currentMetrics: [metric("20260902", { trainingLoadRatio: 1.4 }), metric("20260904", { trainingLoadRatio: 1.1 })], activities: [activity("20260903")] }) as any;
    expect(result.verdict).toBe("observed_not_causal");
    expect(result.learningRule).toContain("must not claim");
  });
});
