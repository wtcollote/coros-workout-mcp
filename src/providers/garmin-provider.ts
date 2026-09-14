import type {
  ActivityDetailQuery,
  ActivityQuery,
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";
import type { TrainingActivitySummary } from "./training-data-types.js";

const GARMIN_CAPABILITIES = new Set<TrainingDataProviderCapability>([
  "activities",
  "activity_detail",
]);

interface GarminActivityLike extends Record<string, unknown> {
  activityId?: string | number;
  activityIdStr?: string;
  id?: string | number;
  activityName?: string;
  name?: string;
  activityType?: unknown;
  activityTypeKey?: string;
  sportType?: string;
  startTimeInSeconds?: number;
  startTimeLocal?: string;
  startTimeGMT?: string;
  startTime?: string;
  durationInSeconds?: number;
  duration?: number;
  elapsedDuration?: number;
  distanceInMeters?: number;
  distance?: number;
  averageHeartRateInBeatsPerMinute?: number;
  averageHR?: number;
  avgHr?: number;
  maxHeartRateInBeatsPerMinute?: number;
  maxHR?: number;
  maxHr?: number;
  activeKilocalories?: number;
  calories?: number;
  averagePowerInWatts?: number;
  averagePower?: number;
  normalizedPowerInWatts?: number;
  normalizedPower?: number;
  totalElevationGainInMeters?: number;
  elevationGain?: number;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Garmin provider.`);
  return value;
}

function nullableNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function activityTypeName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringValue(record.typeKey, record.type, record.name);
  }
  return null;
}

function dateFromActivity(activity: GarminActivityLike): { date: string; startTime: string | null } {
  const epochSeconds = nullableNumber(activity.startTimeInSeconds);
  if (epochSeconds != null) {
    const iso = new Date(epochSeconds * 1000).toISOString();
    return { date: iso.slice(0, 10).replaceAll("-", ""), startTime: iso };
  }

  const raw = stringValue(activity.startTimeGMT, activity.startTimeLocal, activity.startTime);
  if (!raw) return { date: "", startTime: null };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { date: "", startTime: raw };
  return { date: parsed.toISOString().slice(0, 10).replaceAll("-", ""), startTime: raw };
}

export function normalizeGarminActivity(activity: GarminActivityLike): TrainingActivitySummary {
  const start = dateFromActivity(activity);
  return {
    activityId: stringValue(activity.activityId, activity.activityIdStr, activity.id) ?? "",
    date: start.date,
    name: stringValue(activity.activityName, activity.name),
    sportType: null,
    sportName: activityTypeName(activity.activityType) ?? stringValue(activity.activityTypeKey, activity.sportType),
    startTime: start.startTime,
    durationSeconds: nullableNumber(activity.durationInSeconds, activity.duration, activity.elapsedDuration),
    distanceMeters: nullableNumber(activity.distanceInMeters, activity.distance),
    averageHeartRate: nullableNumber(activity.averageHeartRateInBeatsPerMinute, activity.averageHR, activity.avgHr),
    maximumHeartRate: nullableNumber(activity.maxHeartRateInBeatsPerMinute, activity.maxHR, activity.maxHr),
    calories: nullableNumber(activity.activeKilocalories, activity.calories),
    trainingLoad: null,
    averagePower: nullableNumber(activity.averagePowerInWatts, activity.averagePower),
    normalizedPower: nullableNumber(activity.normalizedPowerInWatts, activity.normalizedPower),
    elevationGain: nullableNumber(activity.totalElevationGainInMeters, activity.elevationGain),
  };
}

function renderTemplate(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return result;
}

function activityList(payload: unknown): GarminActivityLike[] {
  if (Array.isArray(payload)) return payload as GarminActivityLike[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["activities", "activitySummaries", "summaries", "data"]) {
    if (Array.isArray(record[key])) return record[key] as GarminActivityLike[];
  }
  return [];
}

export class GarminTrainingDataProvider implements TrainingDataProvider {
  readonly id = "garmin";
  readonly displayName = "Garmin Connect";
  readonly capabilities = GARMIN_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return Boolean(
      process.env.GARMIN_ACCESS_TOKEN?.trim()
      && process.env.GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE?.trim()
      && process.env.GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE?.trim(),
    );
  }

  async getActivities(query: ActivityQuery): Promise<{ activities: TrainingActivitySummary[]; total: number }> {
    const page = Math.max(query.page ?? 1, 1);
    const size = Math.min(Math.max(query.size ?? 30, 1), 200);
    const url = renderTemplate(env("GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE"), {
      startDate: query.startDate.replaceAll("-", ""),
      endDate: query.endDate.replaceAll("-", ""),
      page,
      size,
    });
    const response = await this.request(url);
    const raw = activityList(response);
    const activities = raw.map(normalizeGarminActivity);
    const explicitTotal = response && typeof response === "object" && !Array.isArray(response)
      ? nullableNumber(
          (response as Record<string, unknown>).total,
          (response as Record<string, unknown>).totalCount,
          (response as Record<string, unknown>).count,
        )
      : null;
    return {
      activities,
      total: explicitTotal ?? (activities.length < size ? (page - 1) * size + activities.length : page * size + 1),
    };
  }

  async getActivityDetail(query: ActivityDetailQuery): Promise<Record<string, unknown>> {
    const url = renderTemplate(env("GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE"), {
      activityId: query.activityId,
      sportType: query.sportType,
    });
    const response = await this.request(url);
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error("Unexpected Garmin activity detail response.");
    }
    return response as Record<string, unknown>;
  }

  private async request(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env("GARMIN_ACCESS_TOKEN")}`,
        Accept: "application/json",
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("Garmin authorization failed. Re-authorize the approved Garmin Connect Developer Program integration.");
    }
    if (response.status === 429) {
      throw new Error("Garmin API rate limit exceeded. Retry according to the limits assigned to the approved Garmin project.");
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Garmin API error HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  }
}
