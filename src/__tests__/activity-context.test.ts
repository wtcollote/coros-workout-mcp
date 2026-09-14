import { describe, expect, it } from "vitest";
import { analyzeActivityContext, classifyTrainingDay } from "../activity-context.js";

describe("general activity context", () => {
  it("does not mistake low cardiovascular strength load for active recovery", () => {
    const result = analyzeActivityContext({
      activityId: "strength-1", name: "Fuerza", sportType: 402,
      durationSeconds: 2100, distanceMeters: 0, averageHeartRate: 94, trainingLoad: 5, calories: 348,
    });
    expect(result.activityKind).toBe("strength");
    expect(result.activeRecovery.candidate).toBe(false);
    expect(result.strengthAnalysis).not.toBeNull();
    expect(result.limitations.join(" ")).toContain("Muscular load");
    expect(result.recordedMetrics.trainingLoad).toBe(5);
  });

  it("marks a short low-load walk as an active-recovery candidate", () => {
    const result = analyzeActivityContext({
      activityId: "walk-1", name: "Paseo suave", sportType: 900,
      durationSeconds: 5400, distanceMeters: 6000, averageHeartRate: 90, trainingLoad: 20, elevationGain: 60,
    });
    expect(result.activityKind).toBe("walking");
    expect(result.activeRecovery.candidate).toBe(true);
    expect(result.derivedMetrics.paceMinutesPerKm).toBe(15);
  });

  it("does not classify a very long walk as recovery solely because load is low", () => {
    const result = analyzeActivityContext({
      name: "Long walk", sportType: 900,
      durationSeconds: 3 * 3600, distanceMeters: 15000, averageHeartRate: 79, trainingLoad: 9,
    });
    expect(result.activeRecovery.candidate).toBe(false);
    expect(result.activeRecovery.cautions.join(" ")).toContain("two hours");
  });

  it("classifies a day made only of qualifying recovery sessions", () => {
    const walk = analyzeActivityContext({ name: "Recuperación", sportType: 900, durationSeconds: 3600, distanceMeters: 4000, averageHeartRate: 85, trainingLoad: 10 });
    expect(classifyTrainingDay([walk]).classification).toBe("active-recovery-day");
    expect(classifyTrainingDay([]).classification).toBe("no-recorded-training");
  });
});
