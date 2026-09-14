import { resolveTrainingDataProvider, getTrainingDataProviderStatus, DEFAULT_TRAINING_DATA_PROVIDER_ID } from "./training-data-service.js";
import type { TrainingActivitySummary } from "./training-data-types.js";

export interface UniversalActivityQuery {
  providerId?: string;
  startDate: string;
  endDate: string;
  page?: number;
  size?: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits = 2): number | null {
  return value == null ? null : Number(value.toFixed(digits));
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (finite(value) ?? 0), 0);
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.map(finite).filter((value): value is number => value != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid date: ${date}`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return dateOnly(parsed);
}

export async function trainingDataStatus() {
  const providers = await getTrainingDataProviderStatus();
  return {
    defaultProviderId: DEFAULT_TRAINING_DATA_PROVIDER_ID,
    providers,
    availableProviders: providers.filter((provider) => provider.available).map((provider) => provider.id),
    activityProviders: providers.filter((provider) => provider.capabilities.includes("activities")).map((provider) => provider.id),
    fileProviders: providers.filter((provider) => provider.capabilities.includes("activity_file_analysis")).map((provider) => provider.id),
  };
}

export async function setupCheck() {
  const status = await trainingDataStatus();
  const checks = [
    { id: "node", ok: Number(process.versions.node.split(".")[0]) >= 18, detail: process.versions.node },
    { id: "coros_credentials", ok: Boolean(process.env.COROS_EMAIL && process.env.COROS_PASSWORD), detail: process.env.COROS_EMAIL && process.env.COROS_PASSWORD ? "configured" : "not configured" },
    { id: "strava", ok: status.availableProviders.includes("strava"), detail: status.availableProviders.includes("strava") ? "available" : "optional/not configured" },
    { id: "garmin", ok: status.availableProviders.includes("garmin"), detail: status.availableProviders.includes("garmin") ? "available" : "optional/not configured" },
    { id: "file_analysis", ok: status.fileProviders.length > 0, detail: status.fileProviders.join(", ") || "unavailable" },
  ];
  return {
    ready: status.availableProviders.length > 0 && checks.find((check) => check.id === "file_analysis")?.ok === true,
    checks,
    status,
    notes: [
      "Provider availability is capability-based; optional providers may remain unconfigured.",
      "No secret values are returned by this diagnostic.",
    ],
  };
}

export async function listProviderActivities(query: UniversalActivityQuery) {
  const providerId = query.providerId ?? DEFAULT_TRAINING_DATA_PROVIDER_ID;
  const provider = resolveTrainingDataProvider(providerId, "activities");
  if (!provider.getActivities) throw new Error(`Provider ${providerId} does not implement activities.`);
  const result = await provider.getActivities({
    startDate: query.startDate,
    endDate: query.endDate,
    page: query.page ?? 1,
    size: query.size ?? 100,
  });
  return { providerId, ...result };
}

export async function fetchProviderActivities(providerId: string, startDate: string, endDate: string, maxActivities = 1000) {
  const provider = resolveTrainingDataProvider(providerId, "activities");
  if (!provider.getActivities) throw new Error(`Provider ${providerId} does not implement activities.`);
  const activities: TrainingActivitySummary[] = [];
  const pageSize = 100;
  for (let page = 1; activities.length < maxActivities; page++) {
    const result = await provider.getActivities({ startDate, endDate, page, size: pageSize });
    activities.push(...result.activities);
    if (result.activities.length < pageSize || activities.length >= result.total) {
      return { activities: activities.slice(0, maxActivities), total: result.total, truncated: result.total > maxActivities };
    }
  }
  return { activities: activities.slice(0, maxActivities), total: activities.length, truncated: true };
}

export function summarizeActivities(activities: TrainingActivitySummary[]) {
  const durationSeconds = sum(activities.map((a) => a.durationSeconds));
  const distanceMeters = sum(activities.map((a) => a.distanceMeters));
  return {
    count: activities.length,
    durationSeconds,
    distanceMeters,
    elevationGainMeters: sum(activities.map((a) => a.elevationGain)),
    trainingLoad: sum(activities.map((a) => a.trainingLoad)),
    averageHeartRate: round(average(activities.map((a) => a.averageHeartRate)), 1),
    averagePower: round(average(activities.map((a) => a.averagePower)), 0),
    averageSpeedMetersPerSecond: durationSeconds > 0 && distanceMeters > 0 ? round(distanceMeters / durationSeconds, 3) : null,
    bySport: Object.entries(activities.reduce<Record<string, { count: number; durationSeconds: number; distanceMeters: number }>>((acc, activity) => {
      const key = activity.sportName ?? (activity.sportType == null ? "unknown" : String(activity.sportType));
      const current = acc[key] ?? { count: 0, durationSeconds: 0, distanceMeters: 0 };
      current.count += 1;
      current.durationSeconds += finite(activity.durationSeconds) ?? 0;
      current.distanceMeters += finite(activity.distanceMeters) ?? 0;
      acc[key] = current;
      return acc;
    }, {})).map(([sport, value]) => ({ sport, ...value })),
  };
}

export async function trainingTrends(providerId: string, endDate: string, windows = [7, 28, 90]) {
  const normalizedWindows = [...new Set(windows)].filter((days) => Number.isInteger(days) && days >= 1 && days <= 365).sort((a, b) => a - b);
  if (!normalizedWindows.length) throw new Error("At least one trend window between 1 and 365 days is required.");
  const maxDays = Math.max(...normalizedWindows);
  const startDate = addDays(endDate, -(maxDays - 1));
  const history = await fetchProviderActivities(providerId, startDate, endDate);
  return {
    providerId,
    requestedRange: { startDate, endDate },
    windows: normalizedWindows.map((days) => {
      const windowStart = addDays(endDate, -(days - 1));
      const activities = history.activities.filter((activity) => activity.date >= windowStart && activity.date <= endDate);
      return { days, startDate: windowStart, endDate, ...summarizeActivities(activities) };
    }),
    source: { returnedActivities: history.activities.length, total: history.total, truncated: history.truncated },
  };
}

export async function compareActivities(providerId: string, startDate: string, endDate: string, activityIds?: string[]) {
  const history = await fetchProviderActivities(providerId, startDate, endDate);
  const selected = (activityIds?.length ? history.activities.filter((activity) => activityIds.includes(activity.activityId)) : history.activities).slice(0, 10);
  if (!selected.length) throw new Error("No activities matched the comparison request.");
  const baseline = selected[0];
  const ratio = (value: number | null, base: number | null) => value != null && base != null && base !== 0 ? round((value - base) / base * 100, 1) : null;
  return {
    providerId,
    baselineActivityId: baseline.activityId,
    activities: selected.map((activity) => ({
      ...activity,
      derived: {
        averageSpeedMetersPerSecond: activity.distanceMeters != null && activity.durationSeconds && activity.durationSeconds > 0 ? round(activity.distanceMeters / activity.durationSeconds, 3) : null,
        distanceVsBaselinePercent: ratio(activity.distanceMeters, baseline.distanceMeters),
        durationVsBaselinePercent: ratio(activity.durationSeconds, baseline.durationSeconds),
        heartRateVsBaselinePercent: ratio(activity.averageHeartRate, baseline.averageHeartRate),
        powerVsBaselinePercent: ratio(activity.averagePower, baseline.averagePower),
        elevationVsBaselinePercent: ratio(activity.elevationGain, baseline.elevationGain),
        trainingLoadVsBaselinePercent: ratio(activity.trainingLoad, baseline.trainingLoad),
      },
    })),
    summary: summarizeActivities(selected),
    limitations: ["Only metrics supplied by the selected provider are compared; missing values remain null.", "The first selected activity is the percentage-change baseline."],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function importActivityFile(fitBase64: string, name = "Imported FIT activity") {
  if (!fitBase64.trim()) throw new Error("fitBase64 is required.");
  const buffer = Buffer.from(fitBase64, "base64");
  if (!buffer.length) throw new Error("Decoded FIT file is empty.");
  const provider = resolveTrainingDataProvider("file", "activity_file_analysis");
  if (!provider.analyzeActivityFile) throw new Error("File provider does not implement FIT analysis.");
  const analysis = await provider.analyzeActivityFile({ format: "fit", data: buffer });
  const session = asRecord(analysis.session);
  const startTime = typeof session.startTime === "string" ? session.startTime : null;
  const neutralActivity: TrainingActivitySummary = {
    activityId: `fit:${startTime ?? "unknown"}:${buffer.byteLength}`,
    date: startTime?.slice(0, 10) ?? "unknown",
    name,
    sportType: null,
    sportName: null,
    startTime,
    durationSeconds: numberField(session, "durationSeconds"),
    distanceMeters: numberField(session, "distanceMeters"),
    averageHeartRate: numberField(session, "averageHeartRate"),
    maximumHeartRate: numberField(session, "maximumHeartRate"),
    calories: null,
    trainingLoad: null,
    averagePower: numberField(session, "averagePowerWatts"),
    normalizedPower: numberField(session, "normalizedPowerWatts"),
    elevationGain: numberField(session, "elevationGainMeters"),
  };
  return { providerId: "file", neutralActivity, analysis };
}
