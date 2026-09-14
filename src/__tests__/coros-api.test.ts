import { describe, it, expect } from "vitest";
import {
  buildExercisePayload,
  buildWorkoutPayload,
  resolveExercises,
  normalizeScheduleDate,
  buildScheduleAssignmentPayload,
  buildStructuredWorkoutPayload,
  prepareWorkoutClone,
  detectCalendarConflicts,
  summarizePlannedWorkouts,
  addDaysToScheduleDate,
  buildShiftPreview,
  normalizeActivity,
  calculateAerobicDecoupling,
  previewDailyAdjustment,
  calculateFuelingPlan,
  buildAthleteProfileMetrics,
  fetchSleep,
} from "../coros-api.js";
import type { ScheduledWorkout } from "../coros-api.js";
import type { AuthData } from "../types.js";
import { findByName } from "../exercise-catalog.js";

describe("coros-api payload construction", () => {
  describe("mobile session safety", () => {
    it("blocks unofficial mobile login by default", async () => {
      const previous = process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN;
      delete process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN;
      const auth: AuthData = {
        accessToken: "training-hub-token",
        userId: "athlete-1",
        region: "eu",
        timestamp: Date.now(),
      };

      try {
        await expect(fetchSleep(auth, "2026-09-01", "2026-09-02")).rejects.toThrow(
          "Unofficial COROS mobile login is disabled"
        );
        expect(auth.mobileAccessToken).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN;
        else process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN = previous;
      }
    });
  });

  describe("buildExercisePayload", () => {
    it("builds payload from Push-ups catalog entry with defaults", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1);

      expect(payload.nameText).toBe("Push-ups");
      expect(payload.name).toBe("T1004");
      expect(payload.originId).toBe(pushups.id);
      expect(payload.sortNo).toBe(1);
      expect(payload.id).toBe(1);
      expect(payload.sportType).toBe(4);
      expect(payload.targetType).toBe(3); // reps
      expect(payload.targetValue).toBe(15); // default reps
      expect(payload.sets).toBe(4); // default sets from catalog
      expect(payload.restValue).toBe(30); // default rest
      expect(payload.intensityType).toBe(1);
      expect(payload.intensityValue).toBe(0);
      expect(payload.isGroup).toBe(false);
      expect(payload.groupId).toBe("");
      expect(payload.intensityDisplayUnit).toBe("6");
    });

    it("applies reps override", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, { reps: 20 });

      expect(payload.targetType).toBe(3);
      expect(payload.targetValue).toBe(20);
    });

    it("applies sets override", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, { sets: 5 });

      expect(payload.sets).toBe(5);
    });

    it("applies weight override in grams", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, {
        weightGrams: 10000,
      });

      expect(payload.intensityType).toBe(1);
      expect(payload.intensityValue).toBe(10000);
    });

    it("applies weight override in kg (converts to grams)", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, { weightKg: 20 });

      expect(payload.intensityType).toBe(1);
      expect(payload.intensityValue).toBe(20000);
    });

    it("applies rest override", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, { restSeconds: 60 });

      expect(payload.restType).toBe(1);
      expect(payload.restValue).toBe(60);
    });

    it("applies duration override (changes targetType to 2)", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1, { duration: 45 });

      expect(payload.targetType).toBe(2);
      expect(payload.targetValue).toBe(45);
    });

    it("includes media URLs from catalog", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1);

      expect(payload.thumbnailUrl).toBeTruthy();
      expect(payload.videoInfos.length).toBeGreaterThan(0);
      expect(payload.coverUrlArrStr).toBeTruthy();
    });

    it("includes text fields", () => {
      const pushups = findByName("Push-ups")!;
      const payload = buildExercisePayload(pushups, 1);

      expect(payload.muscleText).toBe("Chest");
      expect(payload.partText).toContain("Chest");
      expect(payload.equipmentText).toBe("Bodyweight");
    });
  });

  describe("buildWorkoutPayload", () => {
    it("builds a workout with correct defaults", () => {
      const pushups = findByName("Push-ups")!;
      const exercise = buildExercisePayload(pushups, 1);

      const workout = buildWorkoutPayload(
        "Test Workout",
        "A test",
        [exercise]
      );

      expect(workout.name).toBe("Test Workout");
      expect(workout.overview).toBe("A test");
      expect(workout.sportType).toBe(4);
      expect(workout.exercises).toHaveLength(1);
      expect(workout.pbVersion).toBe(2);
      expect(workout.access).toBe(1);
      expect(workout.id).toBe("0");
      expect(workout.duration).toBe(0);
      expect(workout.totalSets).toBe(0);
    });
  });

  describe("resolveExercises", () => {
    it("resolves exercise names to payloads", () => {
      const payloads = resolveExercises([
        { name: "Push-ups", sets: 3, reps: 15 },
        { name: "Squats", sets: 3, reps: 10 },
      ]);

      expect(payloads).toHaveLength(2);
      expect(payloads[0].nameText).toBe("Push-ups");
      expect(payloads[0].sortNo).toBe(1);
      expect(payloads[0].sets).toBe(3);
      expect(payloads[0].targetValue).toBe(15);

      expect(payloads[1].nameText).toBe("Squats");
      expect(payloads[1].sortNo).toBe(2);
      expect(payloads[1].sets).toBe(3);
      expect(payloads[1].targetValue).toBe(10);
    });

    it("throws for unknown exercise name", () => {
      expect(() =>
        resolveExercises([{ name: "Nonexistent Exercise" }])
      ).toThrow('Exercise not found in catalog: "Nonexistent Exercise"');
    });
  });

  describe("calendar assignment", () => {
    it("normalizes and validates calendar dates", () => {
      expect(normalizeScheduleDate("2026-09-03")).toBe("20260903");
      expect(normalizeScheduleDate("20260903")).toBe("20260903");
      expect(() => normalizeScheduleDate("2026-02-30")).toThrow(
        "Invalid calendar date"
      );
    });

    it("uses a new id and appends after workouts already on that day", () => {
      const payload = buildScheduleAssignmentPayload(
        { id: "workout-42", name: "Core + Hombros Ultra", pbVersion: 2 },
        "2026-09-03",
        {
          maxIdInPlan: 8,
          entities: [
            { happenDay: "20260903", idInPlan: 7, sortNoInSchedule: 1 },
            { happenDay: "20260903", idInPlan: 8, sortNoInSchedule: 2 },
          ],
        }
      );

      expect(payload.entities).toEqual([
        { happenDay: "20260903", idInPlan: 9, sortNoInSchedule: 3 },
      ]);
      expect(payload.programs[0].idInPlan).toBe(9);
      expect(payload.versionObjects).toEqual([{ id: 9, status: 1 }]);
      expect(payload.pbVersion).toBe(2);
    });
  });

  describe("structured workouts", () => {
    it("builds an HR-based cycling workout with repeat groups", () => {
      const payload = buildStructuredWorkoutPayload("Bike HR", "cycling", [
        { kind: "warmup", targetType: "time", durationSeconds: 600, intensityType: "heart_rate", intensityMin: 105, intensityMax: 115 },
        { repeat: 3, name: "Main", steps: [
          { kind: "interval", targetType: "time", durationSeconds: 300, intensityType: "heart_rate", intensityMin: 125, intensityMax: 135 },
          { kind: "recovery", targetType: "time", durationSeconds: 120, intensityType: "heart_rate", intensityMin: 105, intensityMax: 115 },
        ]},
        { kind: "cooldown", targetType: "time", durationSeconds: 300 },
      ]);
      expect(payload.sportType).toBe(2);
      expect(payload.duration).toBe(2160);
      const exercises = payload.exercises as Array<Record<string, unknown>>;
      expect(exercises).toHaveLength(5);
      expect(exercises[1].isGroup).toBe(true);
      expect(exercises[2].intensityType).toBe(2);
      expect(exercises[2].intensityValue).toBe(125);
    });

    it("converts running distance to COROS distance units", () => {
      const payload = buildStructuredWorkoutPayload("Run", "running", [
        { kind: "training", targetType: "distance", distanceMeters: 1000, intensityType: "pace", intensityMin: 245, intensityMax: 255 },
      ]);
      const exercises = payload.exercises as Array<Record<string, unknown>>;
      expect(payload.sportType).toBe(1);
      expect(payload.distance).toBe(100000);
      expect(exercises[0].targetValue).toBe(100000);
      expect(exercises[0].intensityType).toBe(3);
    });

    it("rejects a reversed intensity range", () => {
      expect(() => buildStructuredWorkoutPayload("Bad HR", "cycling", [
        { kind: "training", targetType: "time", durationSeconds: 600, intensityType: "heart_rate", intensityMin: 140, intensityMax: 120 },
      ])).toThrow("intensityMax must be greater than or equal to intensityMin");
    });
  });

  describe("workout cloning", () => {
    it("clears program identities and preserves group relationships", () => {
      const clone = prepareWorkoutClone({
        id: "99",
        idInPlan: "7",
        name: "Original",
        userId: "42",
        exercises: [
          { id: "10", groupId: "0", programId: "99" },
          { id: "11", groupId: "10", programId: "99" },
        ],
      }, { name: "Copy" });
      expect(clone.id).toBe("0");
      expect(clone.name).toBe("Copy");
      const exercises = clone.exercises as Array<Record<string, unknown>>;
      expect(exercises[0].id).toBe("1");
      expect(exercises[1].id).toBe("2");
      expect(exercises[1].groupId).toBe("1");
    });
  });

  describe("calendar analysis", () => {
    const items: ScheduledWorkout[] = [
      { planId: "p", idInPlan: "1", planProgramId: "a", date: "20260903", sortNo: 1, workoutId: "w1", name: "Ride", sportType: 2, duration: 3600, distance: 5000000 },
      { planId: "p", idInPlan: "2", planProgramId: "b", date: "20260903", sortNo: 2, workoutId: "w2", name: "Core", sportType: 4, duration: 900, distance: 0 },
      { planId: "p", idInPlan: "3", planProgramId: "c", date: "20260904", sortNo: 1, workoutId: "w3", name: "Run", sportType: 1, duration: 1800, distance: 500000 },
    ];

    it("finds dates with multiple planned workouts", () => {
      const conflicts = detectCalendarConflicts(items);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].date).toBe("20260903");
      expect(conflicts[0].count).toBe(2);
    });

    it("summarizes duration and COROS distance by sport", () => {
      const summary = summarizePlannedWorkouts(items);
      expect(summary.workoutCount).toBe(3);
      expect(summary.durationSeconds).toBe(6300);
      expect(summary.distanceMeters).toBe(55000);
      expect(summary.bySport.cycling.count).toBe(1);
    });

    it("builds a shift preview across month boundaries", () => {
      expect(addDaysToScheduleDate("2026-09-30", 1)).toBe("20261001");
      const preview = buildShiftPreview(items.slice(0, 1), -2);
      expect(preview[0]).toMatchObject({ from: "20260903", to: "20260901", name: "Ride" });
    });
  });

  describe("activity normalization", () => {
    it("normalizes a cycling activity summary", () => {
      const activity = normalizeActivity({
        labelId: 42,
        startTime: "1788315436",
        name: "Indoor endurance",
        sportType: 201,
        totalTime: 3600,
        distance: 30000,
        avgHr: 125,
        maxHr: 148,
        calorie: 650000,
        trainingLoad: 72,
      });
      expect(activity.activityId).toBe("42");
      expect(activity.date).toBe("20260902");
      expect(activity.sportName).toBe("Indoor Cycling");
      expect(activity.calories).toBe(650);
    });

    it("calculates time-weighted aerobic decoupling from auto-laps", () => {
      const result = calculateAerobicDecoupling({
        lapList: [{
          type: 12,
          lapItemList: [
            { time: 60000, distance: 100000, avgHr: 100, avgMoveSpeed: 1000 },
            { time: 60000, distance: 100000, avgHr: 100, avgMoveSpeed: 1000 },
            { time: 60000, distance: 100000, avgHr: 110, avgMoveSpeed: 1000 },
            { time: 60000, distance: 100000, avgHr: 110, avgMoveSpeed: 1000 },
          ],
        }],
      }, 0);
      expect(result.available).toBe(true);
      expect(result.analyzedDurationSeconds).toBe(2400);
      expect(result.firstHalf?.averageHeartRate).toBe(100);
      expect(result.secondHalf?.averageHeartRate).toBe(110);
      expect(result.decouplingPercent).toBeCloseTo(9.09, 2);
      expect(result.classification).toBe("high");
    });

    it("reports insufficient lap data instead of inventing a result", () => {
      const result = calculateAerobicDecoupling({
        lapList: [{ type: 12, lapItemList: [{ time: 60000, distance: 100000, avgHr: 120, avgMoveSpeed: 2000 }] }],
      });
      expect(result.available).toBe(false);
      expect(result.reason).toContain("four valid");
    });

    it("previews a reduced day when two conservative warning points are present", () => {
      const preview = previewDailyAdjustment({
        sleepMinutes: 390,
        currentHrv: 38,
        hrvBaseline: 44,
        restingHeartRate: 50,
        restingHeartRate7dAverage: 47,
        trainingLoadRatio: 1.0,
        plannedWorkoutCount: 1,
      });
      expect(preview.action).toBe("reduce");
      expect(preview.suggestedVolumePercent).toBe(60);
      expect(preview.severity).toBe(2);
    });

    it("does not infer an adjustment from insufficient recovery data", () => {
      const preview = previewDailyAdjustment({
        sleepMinutes: null,
        currentHrv: null,
        hrvBaseline: null,
        restingHeartRate: 45,
        restingHeartRate7dAverage: null,
        trainingLoadRatio: 1.0,
        plannedWorkoutCount: 1,
      });
      expect(preview.action).toBe("insufficient_data");
      expect(preview.suggestedVolumePercent).toBeNull();
    });

    it("builds an ultra-endurance fueling range", () => {
      const plan = calculateFuelingPlan({ durationMinutes: 300, intensity: "race", temperatureC: 28 }) as {
        perHour: { carbohydrateGrams: [number, number]; fluidMilliliters: [number, number] };
        totals: { carbohydrateGrams: [number, number] };
      };
      expect(plan.perHour.carbohydrateGrams).toEqual([75, 90]);
      expect(plan.perHour.fluidMilliliters).toEqual([550, 900]);
      expect(plan.totals.carbohydrateGrams).toEqual([375, 450]);
    });

    it("uses measured sweat rate without exceeding the safety cap", () => {
      const plan = calculateFuelingPlan({ durationMinutes: 120, intensity: "endurance", sweatRateMlPerHour: 1400 }) as {
        perHour: { fluidMilliliters: [number, number] };
      };
      expect(plan.perHour.fluidMilliliters).toEqual([1000, 1000]);
    });

    it("consolidates the latest physiological values and period trends", () => {
      const records = Array.from({ length: 14 }, (_, index) => ({
        date: `202608${String(index + 1).padStart(2, "0")}`,
        avgSleepHrv: 45 + index / 10, hrvBaseline: 44, restingHeartRate: 48, trainingLoad: 90,
        trainingLoadRatio: 1.1, fatigueRate: 20, acuteTrainingIndex: 60, chronicTrainingIndex: 55,
        performance: 100, distanceMeters: 50000, durationSeconds: 7200, vo2max: index < 7 ? 52 : 54,
        lactateThresholdHeartRate: index === 0 ? 165 : null, lactateThresholdPace: index === 0 ? 250 : null,
        fitnessLevel: index < 7 ? 70 : 74, fitnessLevel7d: 73,
      }));
      const profile = buildAthleteProfileMetrics(records) as {
        current: { vo2max: { value: number; date: string }; lactateThresholdHeartRateBpm: { value: number; date: string } };
        periodTrend: { vo2max: { recent7dAverage: number; previous7dAverage: number; change: number; changePercent: number } };
        coverage: { thresholdSamples: number };
      };
      expect(profile.current.vo2max).toEqual({ value: 54, date: "20260814" });
      expect(profile.current.lactateThresholdHeartRateBpm).toEqual({ value: 165, date: "20260801" });
      expect(profile.periodTrend.vo2max).toMatchObject({ recent7dAverage: 54, previous7dAverage: 52, change: 2, changePercent: 3.8 });
      expect(profile.coverage.thresholdSamples).toBe(1);
    });
  });
});
