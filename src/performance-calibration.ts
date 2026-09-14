import type { ActivitySummary } from "./coros-api.js";
import { activityKind, analyzeActivityContext } from "./activity-context.js";

export type CalibratedSport = "cycling" | "road_running" | "trail_running" | "walking" | "hiking";

const SPORT_TYPES: Record<CalibratedSport, number[]> = {
  cycling: [200, 203, 204, 9807],
  road_running: [100, 103],
  trail_running: [102],
  walking: [900],
  hiking: [104],
};

const SEARCH_BOUNDS: Record<CalibratedSport, { minSpeed: number; maxSpeed: number; maxAscentPenalty: number }> = {
  cycling: { minSpeed: 10, maxSpeed: 50, maxAscentPenalty: 10 },
  road_running: { minSpeed: 5, maxSpeed: 25, maxAscentPenalty: 15 },
  trail_running: { minSpeed: 3, maxSpeed: 20, maxAscentPenalty: 25 },
  walking: { minSpeed: 2, maxSpeed: 9, maxAscentPenalty: 25 },
  hiking: { minSpeed: 2, maxSpeed: 9, maxAscentPenalty: 25 },
};

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface CalibrationSample {
  activityId: string;
  date: string;
  distanceKm: number;
  elevationGainMeters: number;
  durationMinutes: number;
  observedAverageSpeedKmh: number;
  verticalDensityMetersPerKm: number;
}

export interface SportCalibrationResult {
  available: boolean;
  sport: CalibratedSport;
  reason?: string;
  sampleCount: number;
  excludedCount: number;
  dateRange: { startDate: string | null; endDate: string | null };
  calibratedParameters?: {
    effectiveBaseSpeedKmh: number;
    effectiveBasePaceMinutesPerKm: number;
    ascentPenaltyMinutesPer100m: number;
  };
  fit?: {
    medianAbsoluteErrorPercent: number;
    confidence: "low" | "moderate" | "high";
    elevationDensityRange: number;
    parameterAtSearchBoundary: boolean;
    effectiveSpeedSearchRangeKmh: { minimum: number; maximum: number };
  };
  samples: CalibrationSample[];
  limitations: string[];
}

function validSamples(activities: ActivitySummary[], sport: CalibratedSport): CalibrationSample[] {
  return activities.flatMap((activity): CalibrationSample[] => {
    if (activity.sportType == null || !SPORT_TYPES[sport].includes(activity.sportType)) return [];
    const distanceKm = (activity.distanceMeters ?? 0) / 1000;
    const durationMinutes = (activity.durationSeconds ?? 0) / 60;
    const elevationGainMeters = Math.max(0, activity.elevationGain ?? 0);
    if (distanceKm < 2 || durationMinutes < 20 || durationMinutes > 24 * 60) return [];
    const observedAverageSpeedKmh = distanceKm / (durationMinutes / 60);
    if (!Number.isFinite(observedAverageSpeedKmh) || observedAverageSpeedKmh <= 0) return [];
    return [{
      activityId: activity.activityId,
      date: activity.date,
      distanceKm: round(distanceKm, 2),
      elevationGainMeters: Math.round(elevationGainMeters),
      durationMinutes: round(durationMinutes),
      observedAverageSpeedKmh: round(observedAverageSpeedKmh, 2),
      verticalDensityMetersPerKm: round(elevationGainMeters / distanceKm, 1),
    }];
  });
}

export function calibrateSportPerformance(activities: ActivitySummary[], sport: CalibratedSport): SportCalibrationResult {
  const samples = validSamples(activities, sport);
  const dates = samples.map((sample) => sample.date).filter(Boolean).sort();
  const base = {
    sport,
    sampleCount: samples.length,
    excludedCount: activities.length - samples.length,
    dateRange: { startDate: dates[0] ?? null, endDate: dates.at(-1) ?? null },
    samples,
    limitations: [
      "Calibration uses COROS activity summaries, not terrain-resolved FIT samples.",
      "Recorded duration may include pauses, so the fitted base speed is an effective planning speed.",
      "Weather, surface, drafting, fatigue and technical difficulty are not isolated by this model.",
    ],
  };
  if (samples.length < 3) return { available: false, reason: "At least three comparable activities are required.", ...base };

  const bounds = SEARCH_BOUNDS[sport];
  const observedSpeeds = samples.map((sample) => sample.observedAverageSpeedKmh);
  const dynamicMinimumSpeed = Math.max(bounds.minSpeed, median(observedSpeeds) * 0.9);
  const dynamicMaximumSpeed = Math.min(bounds.maxSpeed, Math.max(dynamicMinimumSpeed + 0.5, Math.max(...observedSpeeds) * 1.15));
  let best = { speed: dynamicMinimumSpeed, ascentPenalty: 0, error: Number.POSITIVE_INFINITY };
  for (let speed = dynamicMinimumSpeed; speed <= dynamicMaximumSpeed + 0.001; speed += 0.1) {
    for (let ascentPenalty = 0; ascentPenalty <= bounds.maxAscentPenalty + 0.001; ascentPenalty += 0.25) {
      const errors = samples.map((sample) => {
        const predicted = sample.distanceKm / speed * 60 + sample.elevationGainMeters / 100 * ascentPenalty;
        return Math.abs(predicted - sample.durationMinutes) / sample.durationMinutes * 100;
      });
      const error = median(errors);
      if (error < best.error) best = { speed, ascentPenalty, error };
    }
  }
  const densities = samples.map((sample) => sample.verticalDensityMetersPerKm);
  const elevationDensityRange = Math.max(...densities) - Math.min(...densities);
  const parameterAtSearchBoundary = best.speed >= dynamicMaximumSpeed - 0.25 || best.speed <= dynamicMinimumSpeed + 0.25 || best.ascentPenalty >= bounds.maxAscentPenalty - 0.01;
  const confidence = !parameterAtSearchBoundary && samples.length >= 8 && elevationDensityRange >= 10 && best.error <= 15
    ? "high"
    : !parameterAtSearchBoundary && samples.length >= 4 && elevationDensityRange >= 5 && best.error <= 25
      ? "moderate"
      : "low";
  return {
    available: true,
    ...base,
    calibratedParameters: {
      effectiveBaseSpeedKmh: round(best.speed, 2),
      effectiveBasePaceMinutesPerKm: round(60 / best.speed, 2),
      ascentPenaltyMinutesPer100m: round(best.ascentPenalty, 2),
    },
    fit: {
      medianAbsoluteErrorPercent: round(best.error, 1), confidence, elevationDensityRange: round(elevationDensityRange, 1), parameterAtSearchBoundary,
      effectiveSpeedSearchRangeKmh: { minimum: round(dynamicMinimumSpeed, 2), maximum: round(dynamicMaximumSpeed, 2) },
    },
  };
}

export function buildMultisportLoadReport(activities: ActivitySummary[]): Record<string, unknown> {
  const analyses = activities.map((activity) => analyzeActivityContext(activity));
  const byKind: Record<string, { sessions: number; durationMinutes: number; distanceKm: number; elevationGainMeters: number; corosTrainingLoad: number }> = {};
  const byDate: Record<string, { sessions: number; durationMinutes: number; corosTrainingLoad: number }> = {};
  let impactExposureMinutesEquivalent = 0;
  let strengthDurationMinutes = 0;
  let activeRecoveryDurationMinutes = 0;
  for (let index = 0; index < activities.length; index++) {
    const activity = activities[index];
    const analysis = analyses[index];
    const kind = activityKind(activity.sportType);
    const durationMinutes = (activity.durationSeconds ?? 0) / 60;
    const bucket = byKind[kind] ?? { sessions: 0, durationMinutes: 0, distanceKm: 0, elevationGainMeters: 0, corosTrainingLoad: 0 };
    bucket.sessions++;
    bucket.durationMinutes += durationMinutes;
    bucket.distanceKm += (activity.distanceMeters ?? 0) / 1000;
    bucket.elevationGainMeters += activity.elevationGain ?? 0;
    bucket.corosTrainingLoad += activity.trainingLoad ?? 0;
    byKind[kind] = bucket;
    const day = byDate[activity.date] ?? { sessions: 0, durationMinutes: 0, corosTrainingLoad: 0 };
    day.sessions++;
    day.durationMinutes += durationMinutes;
    day.corosTrainingLoad += activity.trainingLoad ?? 0;
    byDate[activity.date] = day;
    const impactFactor = kind === "trail-running" ? 1.25 : kind === "running" ? 1 : kind === "hiking" ? 0.6 : kind === "walking" ? 0.35 : 0;
    impactExposureMinutesEquivalent += durationMinutes * impactFactor;
    if (kind === "strength") strengthDurationMinutes += durationMinutes;
    if (analysis.activeRecovery.candidate) activeRecoveryDurationMinutes += durationMinutes;
  }
  for (const bucket of Object.values(byKind)) {
    bucket.durationMinutes = round(bucket.durationMinutes);
    bucket.distanceKm = round(bucket.distanceKm, 2);
    bucket.elevationGainMeters = Math.round(bucket.elevationGainMeters);
    bucket.corosTrainingLoad = round(bucket.corosTrainingLoad);
  }
  for (const day of Object.values(byDate)) {
    day.durationMinutes = round(day.durationMinutes);
    day.corosTrainingLoad = round(day.corosTrainingLoad);
  }
  const dates = Object.keys(byDate).sort();
  const endDate = dates.at(-1) ?? null;
  const shiftDate = (date: string, days: number) => {
    const compact = date.replaceAll("-", "");
    const value = new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))));
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10).replaceAll("-", "");
  };
  const latestSevenDates = endDate ? Array.from({ length: 7 }, (_, index) => shiftDate(endDate, index - 6)) : [];
  const previousTwentyOneDates = endDate ? Array.from({ length: 21 }, (_, index) => shiftDate(endDate, index - 27)) : [];
  const sumLoad = (selected: string[]) => selected.reduce((sum, date) => sum + (byDate[date]?.corosTrainingLoad ?? 0), 0);
  const acuteLoad = sumLoad(latestSevenDates);
  const priorWeeklyAverage = previousTwentyOneDates.length ? sumLoad(previousTwentyOneDates) / previousTwentyOneDates.length * 7 : null;
  return {
    range: { startDate: dates[0] ?? null, endDate, recordedDays: dates.length },
    totals: {
      sessions: activities.length,
      durationMinutes: round(activities.reduce((sum, activity) => sum + (activity.durationSeconds ?? 0) / 60, 0)),
      corosCardiovascularTrainingLoad: round(activities.reduce((sum, activity) => sum + (activity.trainingLoad ?? 0), 0)),
      impactExposureMinutesEquivalent: round(impactExposureMinutesEquivalent),
      strengthDurationMinutes: round(strengthDurationMinutes),
      activeRecoveryCandidateMinutes: round(activeRecoveryDurationMinutes),
    },
    byActivityKind: byKind,
    byRecordedDate: byDate,
    loadTrend: {
      latestSevenRecordedDaysLoad: round(acuteLoad),
      previousTwentyOneRecordedDaysWeeklyAverage: priorWeeklyAverage == null ? null : round(priorWeeklyAverage),
      ratio: priorWeeklyAverage && priorWeeklyAverage > 0 ? round(acuteLoad / priorWeeklyAverage, 2) : null,
      limitation: "The ratio uses the last seven calendar days versus the preceding 21-day weekly average within the returned data; truncated source data reduces reliability.",
    },
    definitions: {
      corosCardiovascularTrainingLoad: "Sum of COROS trainingLoad; strength muscular stress may be underrepresented.",
      impactExposureMinutesEquivalent: "Heuristic duration weighting: road running 1.0, trail 1.25, hiking 0.6, walking 0.35; cycling/strength 0. This is exposure, not validated physiological load.",
      strengthDurationMinutes: "Recorded strength time only; no muscular-load score is invented.",
    },
  };
}
