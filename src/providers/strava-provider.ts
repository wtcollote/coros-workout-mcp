import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  ActivityDetailQuery,
  ActivityQuery,
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";
import type { TrainingActivitySummary } from "./training-data-types.js";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const REFRESH_SAFETY_WINDOW_SECONDS = 3600;
const CONFIG_DIR = resolve(homedir(), ".config", "coros-workout-mcp");
const DEFAULT_TOKEN_FILE = resolve(CONFIG_DIR, "strava-auth.json");

interface StravaTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface StravaActivity {
  id?: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  start_date_local?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  kilojoules?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  total_elevation_gain?: number;
}

const STRAVA_CAPABILITIES = new Set<TrainingDataProviderCapability>([
  "activities",
  "activity_detail",
]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Strava provider.`);
  return value;
}

function optionalInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateToEpochSeconds(date: string, endOfDay = false): number {
  const normalized = date.replaceAll("-", "");
  if (!/^\d{8}$/.test(normalized)) throw new Error(`Invalid date: ${date}`);
  const iso = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid date: ${date}`);
  return Math.floor(timestamp / 1000);
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeStravaActivity(activity: StravaActivity): TrainingActivitySummary {
  return {
    activityId: activity.id == null ? "" : String(activity.id),
    date: normalizeDate(activity.start_date_local ?? activity.start_date),
    name: activity.name ?? null,
    sportType: null,
    sportName: activity.sport_type ?? activity.type ?? null,
    startTime: activity.start_date ?? activity.start_date_local ?? null,
    durationSeconds: activity.elapsed_time ?? activity.moving_time ?? null,
    distanceMeters: activity.distance ?? null,
    averageHeartRate: activity.average_heartrate ?? null,
    maximumHeartRate: activity.max_heartrate ?? null,
    calories: activity.kilojoules == null ? null : Math.round(activity.kilojoules * 0.239006),
    trainingLoad: null,
    averagePower: activity.average_watts ?? null,
    normalizedPower: activity.weighted_average_watts ?? null,
    elevationGain: activity.total_elevation_gain ?? null,
  };
}

function isTokenState(value: unknown): value is StravaTokenState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.accessToken === "string"
    && typeof candidate.refreshToken === "string"
    && typeof candidate.expiresAt === "number"
    && Number.isFinite(candidate.expiresAt);
}

export class StravaTrainingDataProvider implements TrainingDataProvider {
  readonly id = "strava";
  readonly displayName = "Strava";
  readonly capabilities = STRAVA_CAPABILITIES;

  private tokenState: StravaTokenState | null = null;

  async isAvailable(): Promise<boolean> {
    if (!process.env.STRAVA_CLIENT_ID?.trim() || !process.env.STRAVA_CLIENT_SECRET?.trim()) return false;
    return Boolean(this.loadStoredToken() || process.env.STRAVA_REFRESH_TOKEN?.trim());
  }

  async getActivities(query: ActivityQuery): Promise<{ activities: TrainingActivitySummary[]; total: number }> {
    const page = query.page ?? 1;
    const perPage = Math.min(Math.max(query.size ?? 30, 1), 200);
    const params = new URLSearchParams({
      after: String(dateToEpochSeconds(query.startDate)),
      before: String(dateToEpochSeconds(query.endDate, true)),
      page: String(page),
      per_page: String(perPage),
    });
    const response = await this.request(`/athlete/activities?${params.toString()}`);
    if (!Array.isArray(response)) throw new Error("Unexpected Strava activities response.");
    const activities = response.map((item) => normalizeStravaActivity(item as StravaActivity));
    return {
      activities,
      total: activities.length < perPage ? (page - 1) * perPage + activities.length : page * perPage + 1,
    };
  }

  async getActivityDetail(query: ActivityDetailQuery): Promise<Record<string, unknown>> {
    const activityId = encodeURIComponent(query.activityId);
    const response = await this.request(`/activities/${activityId}`);
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error("Unexpected Strava activity detail response.");
    }
    return response as Record<string, unknown>;
  }

  private async request(path: string): Promise<unknown> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 429) {
      const limit = response.headers.get("x-ratelimit-limit");
      const usage = response.headers.get("x-ratelimit-usage");
      throw new Error(`Strava rate limit exceeded${limit || usage ? ` (limit=${limit ?? "unknown"}, usage=${usage ?? "unknown"})` : ""}.`);
    }
    if (response.status === 401) {
      this.tokenState = null;
      throw new Error("Strava authorization failed. Reconnect Strava OAuth credentials.");
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Strava API error HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response.json();
  }

  private async getAccessToken(): Promise<string> {
    if (!this.tokenState) this.tokenState = this.loadStoredToken();
    if (this.tokenState && this.tokenState.expiresAt - Math.floor(Date.now() / 1000) > REFRESH_SAFETY_WINDOW_SECONDS) {
      return this.tokenState.accessToken;
    }

    const envAccessToken = process.env.STRAVA_ACCESS_TOKEN?.trim();
    const envExpiresAt = optionalInteger(process.env.STRAVA_EXPIRES_AT);
    if (!this.tokenState && envAccessToken && envExpiresAt && envExpiresAt - Math.floor(Date.now() / 1000) > REFRESH_SAFETY_WINDOW_SECONDS) {
      this.tokenState = {
        accessToken: envAccessToken,
        refreshToken: requiredEnv("STRAVA_REFRESH_TOKEN"),
        expiresAt: envExpiresAt,
      };
      this.storeToken(this.tokenState);
      return envAccessToken;
    }

    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const refreshToken = this.tokenState?.refreshToken ?? process.env.STRAVA_REFRESH_TOKEN?.trim();
    if (!refreshToken) throw new Error("STRAVA_REFRESH_TOKEN is required for the initial Strava authorization.");
    const body = new URLSearchParams({
      client_id: requiredEnv("STRAVA_CLIENT_ID"),
      client_secret: requiredEnv("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Strava token refresh failed HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const token = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    if (!token.access_token || !token.refresh_token || !token.expires_at) {
      throw new Error("Strava token refresh returned an incomplete response.");
    }
    this.tokenState = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
    };
    this.storeToken(this.tokenState);
    return token.access_token;
  }

  private tokenFile(): string {
    return process.env.STRAVA_TOKEN_FILE?.trim() || DEFAULT_TOKEN_FILE;
  }

  private loadStoredToken(): StravaTokenState | null {
    try {
      const parsed = JSON.parse(readFileSync(this.tokenFile(), "utf8")) as unknown;
      return isTokenState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private storeToken(token: StravaTokenState): void {
    const path = this.tokenFile();
    mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(token), { mode: 0o600 });
  }
}
