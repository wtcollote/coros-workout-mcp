export interface ActivityContextInput {
  activityId?: string;
  date?: string;
  name?: string | null;
  sportType: number | null;
  sportName?: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averageHeartRate: number | null;
  maximumHeartRate?: number | null;
  calories?: number | null;
  trainingLoad: number | null;
  elevationGain?: number | null;
  aerobicEffect?: number | null;
  anaerobicEffect?: number | null;
  strengthDetails?: {
    exercises?: number | null;
    sets?: number | null;
    totalReps?: number | null;
    totalWeight?: number | null;
    gymDurationSeconds?: number | null;
  } | null;
}

export interface ActivityContextResult {
  activityId?: string;
  date?: string;
  name?: string | null;
  sportType: number | null;
  sportName?: string | null;
  activityKind: "cycling" | "running" | "trail-running" | "walking" | "hiking" | "strength" | "mobility" | "cardio" | "other";
  recordedMetrics: {
    durationSeconds: number | null;
    distanceMeters: number | null;
    averageHeartRate: number | null;
    maximumHeartRate: number | null;
    calories: number | null;
    trainingLoad: number | null;
    elevationGainMeters: number | null;
    aerobicEffect: number | null;
    anaerobicEffect: number | null;
  };
  derivedMetrics: Record<string, number | null>;
  loadInterpretation: { cardiovascularLoad: "low" | "moderate" | "high" | "unknown"; basis: string };
  activeRecovery: { candidate: boolean; reasons: string[]; cautions: string[] };
  strengthAnalysis: Record<string, unknown> | null;
  limitations: string[];
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

export function activityKind(sportType: number | null): ActivityContextResult["activityKind"] {
  if ([200, 201, 203, 204, 9807].includes(sportType ?? -1)) return "cycling";
  if ([100, 103].includes(sportType ?? -1)) return "running";
  if (sportType === 102) return "trail-running";
  if (sportType === 900) return "walking";
  if (sportType === 104) return "hiking";
  if (sportType === 402) return "strength";
  if (sportType === 403) return "mobility";
  if (sportType === 400) return "cardio";
  return "other";
}

export function analyzeActivityContext(input: ActivityContextInput): ActivityContextResult {
  const kind = activityKind(input.sportType);
  const durationHours = input.durationSeconds != null && input.durationSeconds > 0 ? input.durationSeconds / 3600 : null;
  const distanceKm = input.distanceMeters != null ? input.distanceMeters / 1000 : null;
  const paceMinutesPerKm = durationHours != null && distanceKm != null && distanceKm > 0 ? durationHours * 60 / distanceKm : null;
  const speedKmh = durationHours != null && distanceKm != null && durationHours > 0 ? distanceKm / durationHours : null;
  const loadDensity = durationHours != null && input.trainingLoad != null && durationHours > 0 ? input.trainingLoad / durationHours : null;
  const elevationPerKm = distanceKm != null && distanceKm > 0 && input.elevationGain != null ? input.elevationGain / distanceKm : null;
  const load = input.trainingLoad;
  const cardiovascularLoad = load == null ? "unknown" : load <= 40 ? "low" : load <= 120 ? "moderate" : "high";
  const reasons: string[] = [];
  const cautions: string[] = [];
  const normalizedName = (input.name ?? "").toLowerCase();
  const recoveryNamed = /(recuper|regener|recovery|suave|easy|movilidad)/i.test(normalizedName);
  const durationMinutes = durationHours == null ? null : durationHours * 60;
  let candidate = false;
  if (kind === "walking" && load != null && load <= 40 && durationMinutes != null && durationMinutes <= 120) {
    candidate = true;
    reasons.push("Walking with COROS training load at or below 40 and duration at or below 120 minutes.");
  } else if (kind === "mobility" && (load == null || load <= 40) && durationMinutes != null && durationMinutes <= 90) {
    candidate = true;
    reasons.push("Mobility/yoga session with limited duration and no high recorded load.");
  } else if (["cycling", "running"].includes(kind) && recoveryNamed && load != null && load <= 50 && durationMinutes != null && durationMinutes <= 90) {
    candidate = true;
    reasons.push("Session name indicates recovery/easy intent and recorded load is at or below 50.");
  }
  if (kind === "strength") cautions.push("Strength is not classified as active recovery because cardiovascular load does not represent muscular load.");
  if (kind === "hiking" || kind === "trail-running") cautions.push("Terrain and eccentric muscle damage can make recovery cost higher than COROS training load suggests.");
  if (durationMinutes != null && durationMinutes > 120) cautions.push("Duration exceeds two hours and may add meaningful musculoskeletal fatigue despite low cardiovascular load.");
  if (!candidate && reasons.length === 0) reasons.push("The transparent active-recovery criteria were not met.");

  const limitations: string[] = [];
  if (input.averageHeartRate == null) limitations.push("Average heart rate is unavailable.");
  if (load == null) limitations.push("COROS training load is unavailable.");
  if (kind === "strength") limitations.push("Muscular load cannot be inferred from heart rate or COROS training load alone.");
  if (["walking", "hiking", "trail-running"].includes(kind)) limitations.push("Surface and technical difficulty are not present in the activity summary.");
  const strengthDetails = input.strengthDetails ?? null;
  const strengthAnalysis = kind === "strength" ? {
    availableFields: strengthDetails,
    cardiovascularResponse: { averageHeartRate: input.averageHeartRate, maximumHeartRate: input.maximumHeartRate ?? null, trainingLoad: load },
    interpretation: strengthDetails && [strengthDetails.exercises, strengthDetails.sets, strengthDetails.totalReps].some((value) => value != null && value > 0)
      ? "Exercise-volume fields are available; muscular quality still requires planned weights/repetitions or perceived effort."
      : "Only general session metrics are available; sets, repetitions and resistance must not be estimated.",
  } : null;

  return {
    activityId: input.activityId,
    date: input.date,
    name: input.name,
    sportType: input.sportType,
    sportName: input.sportName,
    activityKind: kind,
    recordedMetrics: {
      durationSeconds: input.durationSeconds,
      distanceMeters: input.distanceMeters,
      averageHeartRate: input.averageHeartRate,
      maximumHeartRate: input.maximumHeartRate ?? null,
      calories: input.calories ?? null,
      trainingLoad: input.trainingLoad,
      elevationGainMeters: input.elevationGain ?? null,
      aerobicEffect: input.aerobicEffect ?? null,
      anaerobicEffect: input.anaerobicEffect ?? null,
    },
    derivedMetrics: {
      durationMinutes: durationMinutes == null ? null : round(durationMinutes),
      distanceKm: distanceKm == null ? null : round(distanceKm, 2),
      averageSpeedKmh: speedKmh == null ? null : round(speedKmh, 2),
      paceMinutesPerKm: paceMinutesPerKm == null ? null : round(paceMinutesPerKm, 2),
      elevationGainMetersPerKm: elevationPerKm == null ? null : round(elevationPerKm, 1),
      trainingLoadPerHour: loadDensity == null ? null : round(loadDensity, 1),
    },
    loadInterpretation: { cardiovascularLoad, basis: "COROS training load only: <=40 low, 41-120 moderate, >120 high." },
    activeRecovery: { candidate, reasons, cautions },
    strengthAnalysis,
    limitations,
  };
}

export function classifyTrainingDay(analyses: ActivityContextResult[]): Record<string, unknown> {
  if (!analyses.length) return { classification: "no-recorded-training", basis: "No completed COROS activity was found; unrecorded activity cannot be excluded." };
  const totalTrainingLoad = analyses.reduce((sum, item) => sum + (item.recordedMetrics.trainingLoad ?? 0), 0);
  const allRecovery = analyses.every((item) => item.activeRecovery.candidate);
  const allStrength = analyses.every((item) => item.activityKind === "strength");
  const classification = allRecovery ? "active-recovery-day" : allStrength ? "strength-day" : totalTrainingLoad > 150 ? "high-load-training-day" : "training-day";
  return {
    classification,
    activityCount: analyses.length,
    approximateTotalTrainingLoad: round(totalTrainingLoad),
    basis: "Classification uses recorded sport, duration, COROS training load and explicit recovery-name rules; it is not a recovery/readiness score.",
  };
}
