import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type {
  AuthData,
  CatalogExercise,
  ExerciseOverrides,
  ExercisePayload,
  RawExercise,
  Region,
  WorkoutPayload,
} from "./types.js";
import {
  REGION_URLS,
  MuscleCode,
  PartCode,
  EquipmentCode,
} from "./types.js";
import { findByName } from "./exercise-catalog.js";
import { analyzeFitBuffer, type FitAnalysisOptions } from "./fit-analysis.js";
import { analyzeActivityContext } from "./activity-context.js";

const CONFIG_DIR = resolve(homedir(), ".config", "coros-workout-mcp");
const AUTH_FILE = resolve(CONFIG_DIR, "auth.json");
const DEFAULT_SOURCE_URL =
  "https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/2fbd46e17bc54bc5873415c9fa767bdc.jpg";
const MOBILE_AES_IV = Buffer.from("weloop3_2015_03#", "ascii");
const MOBILE_URLS: Record<Region, string> = {
  eu: "https://apieu.coros.com",
  us: "https://api.coros.com",
};

// --- Auth ---

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function mobileEncrypt(plaintext: string, appKey: string): string {
  const key = Buffer.from(appKey, "ascii");
  const input = Buffer.from(plaintext, "utf8");
  const xored = Buffer.alloc(input.length);
  input.forEach((value, index) => { xored[index] = value ^ key[index % key.length]; });
  const padding = 16 - (xored.length % 16);
  const padded = Buffer.concat([xored, Buffer.alloc(padding, padding)]);
  const cipher = createCipheriv("aes-128-cbc", key, MOBILE_AES_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function randomMobileKey(): string {
  const bytes = randomBytes(16);
  return [...bytes].map((value, index) => String(index === 0 ? (value % 9) + 1 : value % 10)).join("");
}

async function loginMobile(email: string, password: string, region: Region): Promise<string> {
  const appKey = randomMobileKey();
  const body = {
    account: mobileEncrypt(email, appKey) + "\n",
    accountType: 2,
    appKey,
    clientType: 1,
    hasHrCalibrated: 0,
    kbValidity: 0,
    pwd: mobileEncrypt(md5(password), appKey) + "\n",
    region: "310|Europe/Berlin|US",
    skipValidation: false,
  };
  const res = await fetch(`${MOBILE_URLS[region]}/coros/user/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "okhttp/4.12.0",
      "request-time": String(Date.now()),
      yfheader: JSON.stringify({
        appVersion: 1125917087236096,
        clientType: 1,
        language: "en-US",
        releaseType: 1,
        timezone: 4,
        versionCode: "404080400",
      }),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { result?: string; message?: string; data?: { accessToken?: string } };
  if (data.result !== "0000" || !data.data?.accessToken) {
    throw new Error(`COROS mobile login failed: ${data.message || data.result || res.status}`);
  }
  return data.data.accessToken;
}

export function storeAuth(auth: AuthData): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(auth), { mode: 0o600 });
}

export function loadAuth(): AuthData | null {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  password: string,
  region: Region = "eu"
): Promise<AuthData> {
  const apiUrl = REGION_URLS[region];
  const res = await fetch(`${apiUrl}/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account: email,
      accountType: 2,
      pwd: md5(password),
    }),
  });
  const data = await res.json();
  if (data.result !== "0000") {
    throw new Error(`COROS login failed: ${data.message || data.result}`);
  }

  const auth: AuthData = {
    accessToken: data.data.accessToken,
    userId: data.data.userId,
    region,
    timestamp: Date.now(),
  };
  storeAuth(auth);
  return auth;
}

/** Get valid auth from stored file or env vars */
export async function getValidAuth(): Promise<AuthData | null> {
  // Try stored auth first
  const stored = loadAuth();
  if (stored) return stored;

  // Try env vars
  const email = process.env.COROS_EMAIL;
  const password = process.env.COROS_PASSWORD;
  const region = (process.env.COROS_REGION as Region) || "eu";
  if (email && password) {
    return login(email, password, region);
  }

  return null;
}

// --- API helpers ---

function apiHeaders(auth: AuthData): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (compatible; COROS-Workout-Dashboard/2.1)",
    accesstoken: auth.accessToken,
    yfheader: JSON.stringify({ userId: auth.userId }),
  };
}

let webRefreshPromise: Promise<AuthData> | null = null;

function isInvalidAccessToken(data: Record<string, unknown>): boolean {
  return /access token is invalid|invalid access token/i.test(String(data.message ?? ""));
}

async function refreshWebAuth(auth: AuthData): Promise<void> {
  const email = process.env.COROS_EMAIL;
  const password = process.env.COROS_PASSWORD;
  if (!email || !password) throw new Error("COROS access token expired and environment credentials are unavailable.");
  const mobileAccessToken = auth.mobileAccessToken;
  if (!webRefreshPromise) {
    webRefreshPromise = login(email, password, auth.region).finally(() => { webRefreshPromise = null; });
  }
  const refreshed = await webRefreshPromise;
  auth.accessToken = refreshed.accessToken;
  auth.userId = refreshed.userId;
  auth.timestamp = refreshed.timestamp;
  auth.mobileAccessToken = mobileAccessToken;
  storeAuth(auth);
}

async function apiPost(auth: AuthData, path: string, body: unknown): Promise<unknown> {
  const apiUrl = REGION_URLS[auth.region];
  const request = async () => {
    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: apiHeaders(auth),
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  };
  let data = await request();
  if (isInvalidAccessToken(data)) {
    await refreshWebAuth(auth);
    data = await request();
  }
  if (data.result !== "0000") {
    throw new Error(`COROS API error (${path}): ${data.message || data.result}`);
  }
  return data;
}

async function apiGet(
  auth: AuthData,
  path: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const apiUrl = REGION_URLS[auth.region];
  const url = new URL(`${apiUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  type GetResult = {
    data: Record<string, unknown> | null;
    status: number;
    contentType: string;
    preview: string;
  };

  const request = async (): Promise<GetResult> => {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: apiHeaders(auth),
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // COROS sometimes returns the Training Hub HTML login page for an expired
      // web token. That must be treated as an auth failure, not as a JSON error.
    }
    return {
      data,
      status: res.status,
      contentType,
      preview: text.replace(/\s+/g, " ").slice(0, 120),
    };
  };

  let result = await request();
  const needsRefresh = !result.data || result.status === 401 || result.status === 403 || isInvalidAccessToken(result.data);
  if (needsRefresh) {
    await refreshWebAuth(auth);
    result = await request();
  }

  if (!result.data) {
    throw new Error(
      `COROS API returned non-JSON for ${path} after auth refresh (HTTP ${result.status}, ${result.contentType || "unknown content-type"}): ${result.preview || "empty response"}`
    );
  }
  if (result.data.result !== "0000") {
    throw new Error(`COROS API error (${path}): ${String(result.data.message ?? result.data.result)}`);
  }
  return result.data;
}

async function apiFormPost(
  auth: AuthData,
  path: string,
  fields: Record<string, string | number>
): Promise<unknown> {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([key, value]) => body.set(key, String(value)));
  const request = async () => {
    const currentHeaders = apiHeaders(auth);
    delete currentHeaders["Content-Type"];
    const res = await fetch(`${REGION_URLS[auth.region]}${path}`, { method: "POST", headers: currentHeaders, body });
    return res.json() as Promise<Record<string, unknown>>;
  };
  let data = await request();
  if (isInvalidAccessToken(data)) {
    await refreshWebAuth(auth);
    data = await request();
  }
  if (data.result !== "0000") {
    throw new Error(`COROS API error (${path}): ${data.message || data.result}`);
  }
  return data;
}

const ACTIVITY_EXPORT_FILE_TYPES = { gpx: 1, tcx: 2, kml: 3, fit: 4, csv: 5 } as const;
export type ActivityExportFormat = keyof typeof ACTIVITY_EXPORT_FILE_TYPES;

export async function fetchActivityExportUrl(
  auth: AuthData,
  activityId: string,
  sportType: number,
  format: ActivityExportFormat = "fit"
): Promise<{ activityId: string; sportType: number; format: ActivityExportFormat; fileUrl: string }> {
  const apiUrl = REGION_URLS[auth.region];
  const request = async () => {
    const url = new URL(`${apiUrl}/activity/detail/download`);
    url.searchParams.set("labelId", activityId);
    url.searchParams.set("sportType", String(sportType));
    url.searchParams.set("fileType", String(ACTIVITY_EXPORT_FILE_TYPES[format]));
    const response = await fetch(url, { method: "POST", headers: apiHeaders(auth) });
    if (!response.ok) throw new Error(`COROS activity export HTTP ${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  let body = await request();
  if (isInvalidAccessToken(body)) {
    await refreshWebAuth(auth);
    body = await request();
  }
  if (body.result !== "0000") throw new Error(`COROS activity export failed: ${String(body.message ?? body.result)}`);
  const data = body.data as Record<string, unknown> | undefined;
  const fileUrl = String(data?.fileUrl ?? "");
  if (!fileUrl) throw new Error("COROS activity export did not return a download URL.");
  return { activityId, sportType, format, fileUrl };
}

export async function fetchAndAnalyzeFitActivity(
  auth: AuthData,
  activityId: string,
  sportType: number,
  options: FitAnalysisOptions = {}
): Promise<Record<string, unknown>> {
  const exported = await fetchActivityExportUrl(auth, activityId, sportType, "fit");
  const response = await fetch(exported.fileUrl);
  if (!response.ok) throw new Error(`FIT download failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 50 * 1024 * 1024) throw new Error("FIT file exceeds the 50 MB safety limit.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 50 * 1024 * 1024) throw new Error("FIT file exceeds the 50 MB safety limit.");
  const analysis = await analyzeFitBuffer(buffer, options);
  return { activityId, sportType, ...analysis };
}

export interface HrvRecord {
  date: string;
  average: number | null;
  baseline: number | null;
  standardDeviation: number | null;
  intervals: number[] | null;
}

function normalizeHrvRecord(item: Record<string, unknown>): HrvRecord {
  return {
    date: String(item.happenDay ?? ""),
    average: item.avgSleepHrv == null ? null : Number(item.avgSleepHrv),
    baseline: item.sleepHrvBase == null ? null : Number(item.sleepHrvBase),
    standardDeviation: item.sleepHrvSd == null ? null : Number(item.sleepHrvSd),
    intervals: Array.isArray(item.sleepHrvIntervalList) ? item.sleepHrvIntervalList.map(Number) : null,
  };
}

export async function fetchHrv(auth: AuthData): Promise<HrvRecord[]> {
  const response = await apiGet(auth, "/dashboard/query") as {
    data?: { summaryInfo?: { sleepHrvData?: Record<string, unknown> } };
  };
  const data = response.data?.summaryInfo?.sleepHrvData ?? {};
  const records = (Array.isArray(data.sleepHrvList) ? data.sleepHrvList : [])
    .map((item) => normalizeHrvRecord(item as Record<string, unknown>));
  const today = String(data.happenDay ?? "");
  if (today && !records.some((record) => record.date === today)) {
    records.push(normalizeHrvRecord({
      ...data,
      sleepHrvIntervalList: data.sleepHrvAllIntervalList,
    }));
  }
  return records.sort((a, b) => a.date.localeCompare(b.date));
}

export interface DailyMetricRecord {
  date: string;
  avgSleepHrv: number | null;
  hrvBaseline: number | null;
  restingHeartRate: number | null;
  trainingLoad: number | null;
  trainingLoadRatio: number | null;
  fatigueRate: number | null;
  acuteTrainingIndex: number | null;
  chronicTrainingIndex: number | null;
  performance: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  vo2max: number | null;
  lactateThresholdHeartRate: number | null;
  lactateThresholdPace: number | null;
  fitnessLevel: number | null;
  fitnessLevel7d: number | null;
}

function nullableNumber(value: unknown): number | null {
  return value == null || value === "" ? null : Number(value);
}

function normalizeDailyMetric(item: Record<string, unknown>): DailyMetricRecord {
  return {
    date: String(item.happenDay ?? ""),
    avgSleepHrv: nullableNumber(item.avgSleepHrv),
    hrvBaseline: nullableNumber(item.sleepHrvBase),
    restingHeartRate: nullableNumber(item.rhr),
    trainingLoad: nullableNumber(item.trainingLoad),
    trainingLoadRatio: nullableNumber(item.trainingLoadRatio),
    fatigueRate: nullableNumber(item.tiredRateNew),
    acuteTrainingIndex: nullableNumber(item.ati),
    chronicTrainingIndex: nullableNumber(item.cti),
    performance: nullableNumber(item.performance),
    distanceMeters: nullableNumber(item.distance),
    durationSeconds: nullableNumber(item.duration),
    vo2max: nullableNumber(item.vo2max),
    lactateThresholdHeartRate: nullableNumber(item.lthr),
    lactateThresholdPace: nullableNumber(item.ltsp),
    fitnessLevel: nullableNumber(item.staminaLevel),
    fitnessLevel7d: nullableNumber(item.staminaLevel7d),
  };
}

export async function fetchDailyMetrics(auth: AuthData, startDate: string, endDate: string): Promise<DailyMetricRecord[]> {
  const startDay = normalizeScheduleDate(startDate);
  const endDay = normalizeScheduleDate(endDate);
  const [detailResponse, analysisResponse] = await Promise.all([
    apiGet(auth, "/analyse/dayDetail/query", { startDay, endDay }),
    apiGet(auth, "/analyse/query"),
  ]) as [
    { data?: { dayList?: Array<Record<string, unknown>> } },
    { data?: { t7dayList?: Array<Record<string, unknown>> } },
  ];
  const records = new Map<string, DailyMetricRecord>();
  for (const item of detailResponse.data?.dayList ?? []) {
    const record = normalizeDailyMetric(item);
    records.set(record.date, record);
  }
  for (const item of analysisResponse.data?.t7dayList ?? []) {
    const date = String(item.happenDay ?? "");
    const record = records.get(date);
    if (!record) continue;
    const recent = normalizeDailyMetric(item);
    record.vo2max = recent.vo2max ?? record.vo2max;
    record.lactateThresholdHeartRate = recent.lactateThresholdHeartRate ?? record.lactateThresholdHeartRate;
    record.lactateThresholdPace = recent.lactateThresholdPace ?? record.lactateThresholdPace;
    record.fitnessLevel = recent.fitnessLevel ?? record.fitnessLevel;
    record.fitnessLevel7d = recent.fitnessLevel7d ?? record.fitnessLevel7d;
  }
  return [...records.values()]
    .filter((record) => record.date >= startDay && record.date <= endDay)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildAthleteProfileMetrics(records: DailyMetricRecord[]): Record<string, unknown> {
  const ordered = [...records].filter((record) => record.date).sort((a, b) => a.date.localeCompare(b.date));
  const latestValue = (select: (record: DailyMetricRecord) => number | null) => {
    for (let index = ordered.length - 1; index >= 0; index--) {
      const value = select(ordered[index]);
      if (value != null) return { value, date: ordered[index].date };
    }
    return { value: null, date: null };
  };
  const trend = (select: (record: DailyMetricRecord) => number | null) => {
    const values = ordered.flatMap((record) => {
      const value = select(record);
      return value == null ? [] : [{ date: record.date, value }];
    });
    if (values.length < 2) return { recent7dAverage: values.length ? values[0].value : null, previous7dAverage: null, periodAverage: values.length ? values[0].value : null, change: null, changePercent: null, samples: values.length, method: "7-day averages" };
    const recent = values.slice(-7);
    const previous = values.slice(-14, -7);
    const recentAverage = recent.reduce((sum, item) => sum + item.value, 0) / recent.length;
    const previousAverage = previous.length ? previous.reduce((sum, item) => sum + item.value, 0) / previous.length : null;
    const periodAverage = values.reduce((sum, item) => sum + item.value, 0) / values.length;
    return {
      recent7dAverage: Number(recentAverage.toFixed(2)),
      previous7dAverage: previousAverage == null ? null : Number(previousAverage.toFixed(2)),
      periodAverage: Number(periodAverage.toFixed(2)),
      change: previousAverage == null ? null : Number((recentAverage - previousAverage).toFixed(2)),
      changePercent: previousAverage == null || previousAverage === 0 ? null : Number(((recentAverage - previousAverage) / previousAverage * 100).toFixed(1)),
      samples: values.length,
      method: "recent 7-day average versus preceding 7-day average",
    };
  };
  return {
    dateRange: ordered.length ? { startDate: ordered[0].date, endDate: ordered[ordered.length - 1].date, daysReturned: ordered.length } : null,
    current: {
      vo2max: latestValue((record) => record.vo2max),
      lactateThresholdHeartRateBpm: latestValue((record) => record.lactateThresholdHeartRate),
      lactateThresholdPaceSecondsPerKm: latestValue((record) => record.lactateThresholdPace),
      baseFitness: latestValue((record) => record.fitnessLevel),
      fitnessTrend7d: latestValue((record) => record.fitnessLevel7d),
      acuteTrainingIndex: latestValue((record) => record.acuteTrainingIndex),
      chronicTrainingIndex: latestValue((record) => record.chronicTrainingIndex),
      trainingLoadRatio: latestValue((record) => record.trainingLoadRatio),
      fatigueRate: latestValue((record) => record.fatigueRate),
      restingHeartRateBpm: latestValue((record) => record.restingHeartRate),
      hrvMilliseconds: latestValue((record) => record.avgSleepHrv),
      hrvBaselineMilliseconds: latestValue((record) => record.hrvBaseline),
    },
    periodTrend: {
      vo2max: trend((record) => record.vo2max),
      baseFitness: trend((record) => record.fitnessLevel),
      restingHeartRate: trend((record) => record.restingHeartRate),
      hrv: trend((record) => record.avgSleepHrv),
      chronicTrainingIndex: trend((record) => record.chronicTrainingIndex),
    },
    coverage: {
      records: ordered.length,
      vo2maxSamples: ordered.filter((record) => record.vo2max != null).length,
      thresholdSamples: ordered.filter((record) => record.lactateThresholdHeartRate != null || record.lactateThresholdPace != null).length,
      recoverySamples: ordered.filter((record) => record.avgSleepHrv != null || record.restingHeartRate != null).length,
    },
    note: "Values are consolidated from COROS daily analysis. Missing metrics remain null; no physiological values are estimated.",
  };
}

export interface SleepRecord {
  date: string;
  totalDurationMinutes: number | null;
  deepMinutes: number | null;
  lightMinutes: number | null;
  remMinutes: number | null;
  awakeMinutes: number | null;
  napMinutes: number | null;
  averageHeartRate: number | null;
  minimumHeartRate: number | null;
  maximumHeartRate: number | null;
  qualityScore: number | null;
}

async function ensureMobileToken(auth: AuthData): Promise<string> {
  if (auth.mobileAccessToken) return auth.mobileAccessToken;
  const email = process.env.COROS_EMAIL;
  const password = process.env.COROS_PASSWORD;
  if (!email || !password) throw new Error("Sleep requires COROS_EMAIL and COROS_PASSWORD environment variables.");
  auth.mobileAccessToken = await loginMobile(email, password, auth.region);
  storeAuth(auth);
  return auth.mobileAccessToken;
}

export async function fetchSleep(auth: AuthData, startDate: string, endDate: string): Promise<SleepRecord[]> {
  if (process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN !== "true") {
    throw new Error(
      "Unofficial COROS mobile login is disabled to preserve the official mobile-app session. " +
      "Read sleep through COROS MCP OAuth and pass normalized officialSleepRecords to professional_coaching_analysis."
    );
  }
  const token = await ensureMobileToken(auth);
  const payload = {
    allDeviceSleep: 1,
    dataType: [5],
    dataVersion: 0,
    startTime: Number(normalizeScheduleDate(startDate)),
    endTime: Number(normalizeScheduleDate(endDate)),
    statisticType: 1,
  };
  const request = async (accessToken: string) => {
    const url = new URL(`${MOBILE_URLS[auth.region]}/coros/data/statistic/daily`);
    url.searchParams.set("accessToken", accessToken);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", accesstoken: accessToken },
      body: JSON.stringify(payload),
    });
    return res.json() as Promise<Record<string, unknown>>;
  };
  let body = await request(token);
  if (body.result === "1019") {
    auth.mobileAccessToken = undefined;
    const refreshed = await ensureMobileToken(auth);
    body = await request(refreshed);
  }
  if (body.result !== "0000") throw new Error(`COROS sleep API error: ${String(body.message ?? body.result)}`);
  const data = body.data as { statisticData?: { dayDataList?: Array<Record<string, unknown>> } } | undefined;
  return (data?.statisticData?.dayDataList ?? []).map((item) => {
    const sleep = (item.sleepData ?? {}) as Record<string, unknown>;
    const quality = nullableNumber(item.performance);
    return {
      date: String(item.happenDay ?? ""),
      totalDurationMinutes: nullableNumber(sleep.totalSleepTime),
      deepMinutes: nullableNumber(sleep.deepTime),
      lightMinutes: nullableNumber(sleep.lightTime),
      remMinutes: nullableNumber(sleep.eyeTime),
      awakeMinutes: nullableNumber(sleep.wakeTime),
      napMinutes: nullableNumber(sleep.shortSleepTime),
      averageHeartRate: nullableNumber(sleep.avgHeartRate),
      minimumHeartRate: nullableNumber(sleep.minHeartRate),
      maximumHeartRate: nullableNumber(sleep.maxHeartRate),
      qualityScore: quality === -1 ? null : quality,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

const ACTIVITY_SPORT_NAMES: Record<number, string> = {
  100: "Running", 102: "Trail Running", 103: "Track Running", 104: "Hiking",
  200: "Road Bike", 201: "Indoor Cycling", 203: "Gravel Bike", 204: "MTB",
  400: "Cardio", 402: "Strength", 403: "Yoga", 900: "Walking", 9807: "Bike Commute",
};

export interface ActivitySummary {
  activityId: string;
  date: string;
  name: string | null;
  sportType: number | null;
  sportName: string | null;
  startTime: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  calories: number | null;
  trainingLoad: number | null;
  averagePower: number | null;
  normalizedPower: number | null;
  elevationGain: number | null;
}

function inferActivityDate(item: Record<string, unknown>): string {
  if (item.happenDay) return String(item.happenDay).replaceAll("-", "").slice(0, 8);
  const raw = String(item.startTime ?? "");
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString().slice(0, 10).replaceAll("-", "");
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replaceAll("-", "");
  if (/^\d{8}/.test(raw)) return raw.slice(0, 8);
  return "";
}

export function normalizeActivity(item: Record<string, unknown>): ActivitySummary {
  const sportType = nullableNumber(item.sportType);
  const caloriesRaw = nullableNumber(item.calorie ?? item.totalCalorie);
  return {
    activityId: String(item.labelId ?? ""),
    date: inferActivityDate(item),
    name: item.name == null && item.remark == null ? null : String(item.name ?? item.remark),
    sportType,
    sportName: sportType == null ? null : ACTIVITY_SPORT_NAMES[sportType] ?? `Sport ${sportType}`,
    startTime: item.startTime == null ? null : String(item.startTime),
    durationSeconds: nullableNumber(item.totalTime),
    distanceMeters: nullableNumber(item.distance ?? item.totalDistance),
    averageHeartRate: nullableNumber(item.avgHr),
    maximumHeartRate: nullableNumber(item.maxHr),
    calories: caloriesRaw == null ? null : Math.round(caloriesRaw / 1000),
    trainingLoad: nullableNumber(item.trainingLoad),
    averagePower: nullableNumber(item.avgPower),
    normalizedPower: nullableNumber(item.np),
    elevationGain: nullableNumber(item.ascent ?? item.totalAscent ?? item.elevationGain),
  };
}

export async function fetchActivities(
  auth: AuthData,
  startDate: string,
  endDate: string,
  page: number = 1,
  size: number = 30
): Promise<{ activities: ActivitySummary[]; total: number }> {
  const response = await apiGet(auth, "/activity/query", {
    startDay: normalizeScheduleDate(startDate),
    endDay: normalizeScheduleDate(endDate),
    pageNumber: page,
    size,
  }) as { data?: { dataList?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>>; totalCount?: number; count?: number } };
  const items = response.data?.dataList ?? response.data?.list ?? [];
  return {
    activities: items.map(normalizeActivity),
    total: Number(response.data?.totalCount ?? response.data?.count ?? items.length),
  };
}

async function fetchRawActivityDetail(auth: AuthData, activityId: string, sportType: number): Promise<Record<string, unknown>> {
  const response = await apiFormPost(auth, "/activity/detail/query", {
    labelId: activityId,
    userId: auth.userId,
    sportType,
  }) as { data?: Record<string, unknown> };
  return response.data ?? {};
}

export async function fetchActivityDetail(auth: AuthData, activityId: string, sportType: number): Promise<Record<string, unknown>> {
  const data = await fetchRawActivityDetail(auth, activityId, sportType);
  delete data.graphList;
  delete data.frequencyList;
  delete data.gpsLightDuration;
  return data;
}

interface DecouplingLap {
  duration: number;
  heartRate: number;
  speed: number;
}

export interface AerobicDecouplingResult {
  available: boolean;
  reason?: string;
  method: string;
  analyzedDurationSeconds?: number;
  sampleCount?: number;
  trimPercent?: number;
  firstHalf?: { averageHeartRate: number; averageSpeedMetersPerSecond: number; efficiencyFactor: number };
  secondHalf?: { averageHeartRate: number; averageSpeedMetersPerSecond: number; efficiencyFactor: number };
  decouplingPercent?: number;
  classification?: "improved" | "stable" | "moderate" | "high";
}

function decouplingLaps(detail: Record<string, unknown>): DecouplingLap[] {
  const summary = (detail.summary ?? {}) as Record<string, unknown>;
  const sportType = Number(summary.sportType ?? 0);
  const running = [100, 102, 103].includes(sportType);
  const cycling = [200, 201, 203, 204, 9807].includes(sportType);
  const groups = Array.isArray(detail.lapList) ? detail.lapList as Array<Record<string, unknown>> : [];
  const candidates = groups.map((group) => {
    const items = Array.isArray(group.lapItemList) ? group.lapItemList as Array<Record<string, unknown>> : [];
    return items.flatMap((item): DecouplingLap[] => {
      const duration = Number(item.time ?? 0);
      const heartRate = Number(item.avgHr ?? 0);
      const motionRaw = Number(item.avgMoveSpeed ?? item.avgSpeedV2 ?? item.avgSpeed ?? 0);
      const speed = motionRaw <= 0 ? 0 : running ? 1000 / motionRaw : cycling ? motionRaw / 360 : motionRaw;
      const distance = Number(item.distance ?? 0);
      return duration > 0 && heartRate > 0 && speed > 0 && distance > 0
        ? [{ duration, heartRate, speed }]
        : [];
    });
  });
  return candidates.sort((a, b) => b.length - a.length)[0] ?? [];
}

/**
 * Calculate aerobic decoupling from COROS auto-laps. COROS reports lap time in
 * centiseconds. Running pace (seconds/km) and cycling speed (hundredths of
 * km/h) are normalized to m/s before comparing speed/heart-rate efficiency.
 */
export function calculateAerobicDecoupling(
  detail: Record<string, unknown>,
  trimPercent: number = 10
): AerobicDecouplingResult {
  const method = "time-weighted speed(m/s)/heart-rate efficiency from COROS auto-laps";
  if (!Number.isFinite(trimPercent) || trimPercent < 0 || trimPercent >= 40) {
    return { available: false, reason: "trimPercent must be between 0 and 39", method };
  }
  const laps = decouplingLaps(detail);
  if (laps.length < 4) {
    return { available: false, reason: "At least four valid distance laps with heart rate and speed are required", method };
  }
  const total = laps.reduce((sum, lap) => sum + lap.duration, 0);
  const start = total * trimPercent / 100;
  const end = total * (1 - trimPercent / 100);
  const midpoint = (start + end) / 2;

  const aggregate = (from: number, to: number) => {
    let cursor = 0;
    let duration = 0;
    let heartRate = 0;
    let speed = 0;
    for (const lap of laps) {
      const lapStart = cursor;
      const lapEnd = cursor + lap.duration;
      const overlap = Math.max(0, Math.min(lapEnd, to) - Math.max(lapStart, from));
      if (overlap > 0) {
        duration += overlap;
        heartRate += lap.heartRate * overlap;
        speed += lap.speed * overlap;
      }
      cursor = lapEnd;
    }
    const averageHeartRate = heartRate / duration;
    const averageSpeedMetersPerSecond = speed / duration;
    return { averageHeartRate, averageSpeedMetersPerSecond, efficiencyFactor: averageSpeedMetersPerSecond / averageHeartRate };
  };

  const firstHalf = aggregate(start, midpoint);
  const secondHalf = aggregate(midpoint, end);
  const decouplingPercent = ((firstHalf.efficiencyFactor - secondHalf.efficiencyFactor) / firstHalf.efficiencyFactor) * 100;
  const classification = decouplingPercent < 0
    ? "improved"
    : decouplingPercent <= 3
      ? "stable"
      : decouplingPercent <= 5
        ? "moderate"
        : "high";
  const round = (value: number, digits: number = 2) => Number(value.toFixed(digits));
  return {
    available: true,
    method,
    analyzedDurationSeconds: round((end - start) / 100, 0),
    sampleCount: laps.length,
    trimPercent,
    firstHalf: {
      averageHeartRate: round(firstHalf.averageHeartRate, 1),
      averageSpeedMetersPerSecond: round(firstHalf.averageSpeedMetersPerSecond, 3),
      efficiencyFactor: round(firstHalf.efficiencyFactor, 4),
    },
    secondHalf: {
      averageHeartRate: round(secondHalf.averageHeartRate, 1),
      averageSpeedMetersPerSecond: round(secondHalf.averageSpeedMetersPerSecond, 3),
      efficiencyFactor: round(secondHalf.efficiencyFactor, 4),
    },
    decouplingPercent: round(decouplingPercent),
    classification,
  };
}

export async function fetchAerobicDecoupling(
  auth: AuthData,
  activityId: string,
  sportType: number,
  trimPercent: number = 10
): Promise<AerobicDecouplingResult> {
  return calculateAerobicDecoupling(await fetchRawActivityDetail(auth, activityId, sportType), trimPercent);
}

export interface DailyAdjustmentInput {
  sleepMinutes: number | null;
  currentHrv: number | null;
  hrvBaseline: number | null;
  restingHeartRate: number | null;
  restingHeartRate7dAverage: number | null;
  trainingLoadRatio: number | null;
  plannedWorkoutCount: number;
}

export interface FuelingPlanInput {
  durationMinutes: number;
  intensity: "recovery" | "endurance" | "tempo" | "race";
  temperatureC?: number;
  sweatRateMlPerHour?: number;
  sodiumLossMgPerLiter?: number;
}

export function calculateFuelingPlan(input: FuelingPlanInput): Record<string, unknown> {
  const hours = input.durationMinutes / 60;
  let carbohydrateRange: [number, number];
  if (input.durationMinutes < 60) carbohydrateRange = [0, 30];
  else if (input.durationMinutes <= 150) carbohydrateRange = input.intensity === "recovery" ? [20, 40] : [30, 60];
  else if (input.intensity === "race") carbohydrateRange = [75, 90];
  else if (input.intensity === "tempo") carbohydrateRange = [60, 90];
  else carbohydrateRange = [45, 75];

  let fluidRange: [number, number];
  if (input.sweatRateMlPerHour != null) {
    fluidRange = [
      Math.max(300, Math.round(input.sweatRateMlPerHour * 0.7 / 50) * 50),
      Math.min(1000, Math.round(input.sweatRateMlPerHour * 0.9 / 50) * 50),
    ];
  } else {
    const adjustment = input.temperatureC == null ? 0 : input.temperatureC >= 25 ? 150 : input.temperatureC < 10 ? -100 : 0;
    fluidRange = [Math.max(300, 400 + adjustment), Math.min(1000, 750 + adjustment)];
  }
  const sodiumConcentration = input.sodiumLossMgPerLiter ?? 500;
  const sodiumRange: [number, number] = [
    Math.round(fluidRange[0] / 1000 * sodiumConcentration),
    Math.round(fluidRange[1] / 1000 * sodiumConcentration),
  ];
  const totalRange = (range: [number, number]) => range.map((value) => Math.round(value * hours)) as [number, number];
  return {
    durationHours: Number(hours.toFixed(2)),
    perHour: {
      carbohydrateGrams: carbohydrateRange,
      fluidMilliliters: fluidRange,
      sodiumMilligrams: sodiumRange,
    },
    totals: {
      carbohydrateGrams: totalRange(carbohydrateRange),
      fluidMilliliters: totalRange(fluidRange),
      sodiumMilligrams: totalRange(sodiumRange),
    },
    assumptions: {
      temperatureC: input.temperatureC ?? null,
      sweatRateMlPerHour: input.sweatRateMlPerHour ?? null,
      sodiumConcentrationMgPerLiter: sodiumConcentration,
    },
    warnings: [
      "Ranges are planning estimates; test gastrointestinal tolerance in training.",
      "Do not drink beyond measured sweat losses or gain body weight during exercise.",
      "Personal sweat and sodium testing should replace defaults when available.",
    ],
  };
}

export interface DailyAdjustmentPreview {
  action: "maintain" | "reduce" | "recovery_or_rest" | "insufficient_data";
  severity: number;
  reasons: string[];
  suggestedVolumePercent: number | null;
  note: string;
}

/** Conservative, transparent rules for previewing a daily adjustment. */
export function previewDailyAdjustment(input: DailyAdjustmentInput): DailyAdjustmentPreview {
  const reasons: string[] = [];
  let severity = 0;
  let availableSignals = 0;
  if (input.sleepMinutes != null) {
    availableSignals++;
    if (input.sleepMinutes < 360) { severity += 2; reasons.push(`Sleep below 6 h (${input.sleepMinutes} min)`); }
    else if (input.sleepMinutes < 420) { severity += 1; reasons.push(`Sleep below 7 h (${input.sleepMinutes} min)`); }
  }
  if (input.currentHrv != null && input.hrvBaseline != null && input.hrvBaseline > 0) {
    availableSignals++;
    const ratio = input.currentHrv / input.hrvBaseline;
    if (ratio < 0.8) { severity += 2; reasons.push(`HRV is ${Math.round((1 - ratio) * 100)}% below baseline`); }
    else if (ratio < 0.9) { severity += 1; reasons.push(`HRV is ${Math.round((1 - ratio) * 100)}% below baseline`); }
  }
  if (input.restingHeartRate != null && input.restingHeartRate7dAverage != null) {
    availableSignals++;
    const difference = input.restingHeartRate - input.restingHeartRate7dAverage;
    if (difference >= 8) { severity += 2; reasons.push(`Resting HR is ${difference.toFixed(0)} bpm above 7-day average`); }
    else if (difference >= 5) { severity += 1; reasons.push(`Resting HR is ${difference.toFixed(0)} bpm above 7-day average`); }
  }
  if (input.trainingLoadRatio != null) {
    availableSignals++;
    if (input.trainingLoadRatio > 1.5) { severity += 2; reasons.push(`Training-load ratio is high (${input.trainingLoadRatio})`); }
    else if (input.trainingLoadRatio > 1.3) { severity += 1; reasons.push(`Training-load ratio is elevated (${input.trainingLoadRatio})`); }
  }
  if (availableSignals < 2) {
    return { action: "insufficient_data", severity, reasons, suggestedVolumePercent: null, note: "Fewer than two recovery signals are available; no adjustment is inferred." };
  }
  if (severity >= 4) {
    return { action: "recovery_or_rest", severity, reasons, suggestedVolumePercent: input.plannedWorkoutCount ? 0 : null, note: "Preview only. Confirm symptoms and perceived fatigue before changing COROS." };
  }
  if (severity >= 2) {
    return { action: "reduce", severity, reasons, suggestedVolumePercent: input.plannedWorkoutCount ? 60 : null, note: "Preview only. Keep intensity easy and confirm before changing COROS." };
  }
  return { action: "maintain", severity, reasons: reasons.length ? reasons : ["No conservative warning threshold was reached"], suggestedVolumePercent: input.plannedWorkoutCount ? 100 : null, note: "Preview only; subjective symptoms override wearable data." };
}

export async function fetchCompactActivityAnalysis(
  auth: AuthData,
  activityId: string,
  sportType: number
): Promise<Record<string, unknown>> {
  const detail = await fetchRawActivityDetail(auth, activityId, sportType);
  const running = [100, 102, 103].includes(sportType);
  const paceBased = [100, 102, 103, 104, 900].includes(sportType);
  const cycling = [200, 201, 203, 204, 9807].includes(sportType);
  const summary = (detail.summary ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(detail.lapList) ? detail.lapList as Array<Record<string, unknown>> : [];
  const lapItems = groups
    .map((group) => Array.isArray(group.lapItemList) ? group.lapItemList as Array<Record<string, unknown>> : [])
    .sort((a, b) => b.length - a.length)[0] ?? [];
  const stride = Math.max(1, Math.ceil(lapItems.length / 20));
  const selectedLaps = lapItems.filter((_, index) => index % stride === 0 || index === lapItems.length - 1);
  const compactLap = (item: Record<string, unknown>) => {
    const motion = nullableNumber(item.avgMoveSpeed ?? item.avgSpeedV2 ?? item.avgSpeed);
    return ({
    lap: nullableNumber(item.lapIndex),
    durationSeconds: nullableNumber(item.time) == null ? null : Number(item.time) / 100,
    distanceMeters: nullableNumber(item.distance) == null ? null : Number(item.distance) / 100,
    averageHeartRate: nullableNumber(item.avgHr),
    maximumHeartRate: nullableNumber(item.maxHr),
    averageCadence: nullableNumber(item.avgCadence),
    paceSecondsPerKm: paceBased ? motion : null,
    averageSpeedKmh: cycling && motion != null ? motion / 100 : null,
    averagePower: nullableNumber(item.avgPower),
    elevationGainMeters: nullableNumber(item.elevGain),
  });
  };
  const summaryMotion = nullableNumber(summary.avgMoveSpeed ?? summary.avgSpeed);
  const normalizedSummary = {
      name: summary.name ?? null,
      sportType: nullableNumber(summary.sportType),
      durationSeconds: nullableNumber(summary.totalTime) == null ? null : Number(summary.totalTime) / 100,
      distanceMeters: nullableNumber(summary.distance) == null ? null : Number(summary.distance) / 100,
      averageHeartRate: nullableNumber(summary.avgHr),
      maximumHeartRate: nullableNumber(summary.maxHr),
      averageCadence: nullableNumber(summary.avgCadence),
      paceSecondsPerKm: paceBased ? summaryMotion : null,
      averageSpeedKmh: cycling && summaryMotion != null ? summaryMotion / 100 : null,
      averagePower: nullableNumber(summary.avgPower),
      normalizedPower: nullableNumber(summary.np),
      elevationGainMeters: nullableNumber(summary.elevGain),
      trainingLoad: nullableNumber(summary.trainingLoad),
      aerobicEffect: nullableNumber(summary.aerobicEffect),
      anaerobicEffect: nullableNumber(summary.anaerobicEffect),
      performance: nullableNumber(summary.performance),
  };
  const strengthDetails = sportType === 402 ? {
    exercises: nullableNumber(summary.exercises),
    sets: nullableNumber(summary.sets),
    totalReps: nullableNumber(summary.totalReps),
    totalWeight: nullableNumber(summary.totalWeight),
    gymDurationSeconds: nullableNumber(summary.gymDuration) == null ? null : Number(summary.gymDuration) / 100,
  } : null;
  return {
    summary: normalizedSummary,
    activityContext: analyzeActivityContext({
      activityId,
      name: normalizedSummary.name == null ? null : String(normalizedSummary.name),
      sportType: normalizedSummary.sportType,
      durationSeconds: normalizedSummary.durationSeconds,
      distanceMeters: normalizedSummary.distanceMeters,
      averageHeartRate: normalizedSummary.averageHeartRate,
      maximumHeartRate: normalizedSummary.maximumHeartRate,
      trainingLoad: normalizedSummary.trainingLoad,
      elevationGain: normalizedSummary.elevationGainMeters,
      aerobicEffect: normalizedSummary.aerobicEffect,
      anaerobicEffect: normalizedSummary.anaerobicEffect,
      strengthDetails,
    }),
    aerobicDecoupling: calculateAerobicDecoupling(detail),
    zones: detail.zoneList ?? [],
    laps: { total: lapItems.length, returned: selectedLaps.length, sampled: stride > 1, items: selectedLaps.map(compactLap) },
  };
}

export async function fetchWorkoutExecutionAnalysis(
  auth: AuthData,
  workoutId: string,
  activityId: string,
  sportType: number
): Promise<Record<string, unknown>> {
  const [workout, activity] = await Promise.all([
    getWorkoutDetail(auth, workoutId),
    fetchRawActivityDetail(auth, activityId, sportType),
  ]);
  const planned = Array.isArray(workout.exercises) ? workout.exercises as Array<Record<string, unknown>> : [];
  const groups = Array.isArray(activity.lapList) ? activity.lapList as Array<Record<string, unknown>> : [];
  const actualCandidates = groups.map((group) => {
    const items = Array.isArray(group.lapItemList) ? group.lapItemList as Array<Record<string, unknown>> : [];
    return items.filter((item) => Number(item.programExerciseIndex) >= 0 && Number(item.programExerciseIndex) < 255);
  });
  const actual = actualCandidates.sort((a, b) => b.length - a.length)[0] ?? [];
  const byProgram = new Map<number, Array<Record<string, unknown>>>();
  for (const item of actual) {
    const index = Number(item.programExerciseIndex);
    byProgram.set(index, [...(byProgram.get(index) ?? []), item]);
  }
  const blocks = planned.map((step, index) => {
    const samples = byProgram.get(index) ?? byProgram.get(index + 1) ?? [];
    const totalTime = samples.reduce((sum, item) => sum + Number(item.time ?? 0), 0);
    const weighted = (key: string) => totalTime > 0
      ? samples.reduce((sum, item) => sum + Number(item[key] ?? 0) * Number(item.time ?? 0), 0) / totalTime
      : null;
    const targetType = Number(step.targetType ?? 0);
    const intensityType = Number(step.intensityType ?? 0);
    const plannedDuration = targetType === 2 ? Number(step.targetValue ?? 0) : null;
    const actualDuration = totalTime > 0 ? totalTime / 100 : null;
    const averageHeartRate = weighted("avgHr");
    const averageCadence = weighted("avgCadence");
    const targetMin = Number(step.intensityValue ?? 0) || null;
    const targetMax = Number(step.intensityValueExtend ?? step.intensityValue ?? 0) || null;
    const observed = intensityType === 2 ? averageHeartRate : intensityType === 7 ? averageCadence : null;
    return {
      index,
      name: step.nameText ?? step.name ?? `Block ${index + 1}`,
      planned: { targetType, durationSeconds: plannedDuration, intensityType, targetMin, targetMax },
      actual: {
        matched: samples.length > 0,
        sampleCount: samples.length,
        durationSeconds: actualDuration == null ? null : Number(actualDuration.toFixed(1)),
        distanceMeters: samples.reduce((sum, item) => sum + Number(item.distance ?? 0), 0) / 100,
        averageHeartRate: averageHeartRate == null ? null : Number(averageHeartRate.toFixed(1)),
        averageCadence: averageCadence == null ? null : Number(averageCadence.toFixed(1)),
      },
      compliance: {
        durationPercent: plannedDuration && actualDuration != null ? Number((actualDuration / plannedDuration * 100).toFixed(1)) : null,
        intensityWithinTarget: observed != null && targetMin != null && targetMax != null ? observed >= targetMin && observed <= targetMax : null,
      },
    };
  });
  return {
    workoutId,
    activityId,
    plannedName: workout.name ?? null,
    blockCount: blocks.length,
    matchedBlockCount: blocks.filter((block) => block.actual.matched).length,
    blocks,
    note: actual.length ? "Blocks are matched using COROS programExerciseIndex." : "COROS did not expose block-to-program linkage for this activity.",
  };
}

/** Fetch the full exercise catalog from COROS API */
export async function queryExerciseCatalog(
  auth: AuthData,
  sportType: number = 4
): Promise<RawExercise[]> {
  const result = (await apiGet(auth, "/training/exercise/query", {
    userId: auth.userId,
    sportType,
  })) as { data: RawExercise[] };
  return result.data;
}

/** Fetch i18n strings from the COROS static CDN (no auth needed) */
export async function fetchI18nStrings(): Promise<Record<string, string>> {
  const url = "https://static.coros.com/locale/coros-traininghub-v2/en-US.prod.js";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch i18n strings: ${res.status} ${res.statusText}`);
  }
  let text = await res.text();
  // Strip "window.en_US=" prefix and trailing semicolon
  text = text.replace(/^window\.en_US\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(text);
}

/**
 * Transform raw exercises + i18n map into CatalogExercise[].
 * Name resolution order: i18n[codeName] → existingCatalog[codeName].name → codeName
 * The i18n file only covers ~100 of ~383 exercises, so the existing catalog
 * provides names for exercises that predate the i18n system.
 */
export function buildCatalogFromRaw(
  rawExercises: RawExercise[],
  i18n: Record<string, string>,
  existingCatalog: CatalogExercise[] = []
): { catalog: CatalogExercise[]; i18nMisses: string[] } {
  const i18nMisses: string[] = [];
  const catalog: CatalogExercise[] = [];

  // Build lookup from existing catalog by codeName for fallback
  const existingByCode = new Map<string, CatalogExercise>();
  for (const e of existingCatalog) {
    existingByCode.set(e.codeName, e);
  }

  for (const r of rawExercises) {
    // Resolve human-readable name:
    // 1. i18n (code name key, e.g. "T1300" → "Weighted Jump Squats")
    // 2. Existing catalog entry (for older exercises without i18n)
    // 3. Fall back to raw code name
    let humanName = i18n[r.name];
    if (!humanName) {
      const existing = existingByCode.get(r.name);
      if (existing) {
        humanName = existing.name;
      } else {
        humanName = r.name;
        i18nMisses.push(r.name);
      }
    }

    // Resolve description from i18n
    const desc = i18n[r.name + "_desc"] || "";

    // Build text fields from numeric codes
    const muscle = r.muscle || [];
    const muscleRelevance = r.muscleRelevance || [];
    const part = r.part || [];
    const equipment = r.equipment || [];
    const primaryMuscle = muscle[0];
    const secondaryMuscles = muscleRelevance.filter((m) => m !== primaryMuscle);
    const muscleText = primaryMuscle
      ? (MuscleCode as Record<number, string>)[primaryMuscle] || String(primaryMuscle)
      : "";
    const secondaryMuscleText = secondaryMuscles
      .map((m) => (MuscleCode as Record<number, string>)[m] || String(m))
      .join(",");
    const partText = part
      .map((p) => (PartCode as Record<number, string>)[p] || String(p))
      .join(",");
    const equipmentText = equipment
      .map((e) => (EquipmentCode as Record<number, string>)[e] || String(e))
      .join(",");

    catalog.push({
      id: r.id,
      name: humanName.trim(),
      codeName: r.name,
      overview: r.overview,
      animationId: r.animationId,
      muscle,
      muscleRelevance,
      part,
      equipment,
      exerciseType: r.exerciseType,
      targetType: r.targetType,
      targetValue: r.targetValue,
      intensityType: r.intensityType,
      intensityValue: r.intensityValue,
      restType: r.restType,
      restValue: r.restValue,
      sets: r.sets,
      sortNo: r.sortNo,
      sportType: r.sportType,
      status: r.status,
      createTimestamp: r.createTimestamp,
      thumbnailUrl: r.thumbnailUrl || "",
      sourceUrl: r.sourceUrl,
      videoUrl: r.videoUrl,
      coverUrlArrStr: r.coverUrlArrStr,
      videoUrlArrStr: r.videoUrlArrStr,
      videoInfos: r.videoInfos,
      muscleText,
      secondaryMuscleText,
      partText,
      equipmentText,
      desc,
    });
  }

  // Sort alphabetically by name
  catalog.sort((a, b) => a.name.localeCompare(b.name));

  return { catalog, i18nMisses };
}

// --- Payload construction ---

export function buildExercisePayload(
  exercise: CatalogExercise,
  sortNo: number,
  overrides: Partial<ExerciseOverrides> = {}
): ExercisePayload {
  const sets = overrides.sets ?? exercise.sets;
  let targetType = exercise.targetType;
  let targetValue = exercise.targetValue;
  if (overrides.reps !== undefined) {
    targetType = 3;
    targetValue = overrides.reps;
  } else if (overrides.duration !== undefined) {
    targetType = 2;
    targetValue = overrides.duration;
  }

  const restValue = overrides.restSeconds ?? exercise.restValue;

  let intensityType = exercise.intensityType;
  let intensityValue = exercise.intensityValue;
  if (overrides.weightGrams !== undefined) {
    intensityType = 1;
    intensityValue = overrides.weightGrams;
  } else if (overrides.weightKg !== undefined) {
    intensityType = 1;
    intensityValue = overrides.weightKg * 1000;
  }

  // Build text fields from codes
  const primaryMuscle = exercise.muscle[0];
  const secondaryMuscles = (exercise.muscleRelevance || []).filter(
    (m) => m !== primaryMuscle
  );
  const muscleText =
    exercise.muscleText ||
    (primaryMuscle
      ? (MuscleCode as Record<number, string>)[primaryMuscle] || ""
      : "");
  const secondaryMuscleText =
    exercise.secondaryMuscleText ||
    secondaryMuscles
      .map((m) => (MuscleCode as Record<number, string>)[m] || "")
      .filter(Boolean)
      .join(",");
  const partText =
    exercise.partText ||
    exercise.part
      .map((p) => (PartCode as Record<number, string>)[p] || "")
      .filter(Boolean)
      .join(",");
  const equipmentText =
    exercise.equipmentText ||
    exercise.equipment
      .map((e) => (EquipmentCode as Record<number, string>)[e] || "")
      .filter(Boolean)
      .join(",");

  return {
    access: 0,
    animationId: exercise.animationId ?? 0,
    coverUrlArrStr: exercise.coverUrlArrStr,
    createTimestamp: exercise.createTimestamp,
    defaultOrder: 0,
    equipment: exercise.equipment,
    exerciseType: exercise.exerciseType,
    id: sortNo, // sequential 1-based index used in API
    intensityCustom: 0,
    intensityType,
    intensityValue,
    isDefaultAdd: 0,
    isGroup: false,
    isIntensityPercent: false,
    muscle: exercise.muscle,
    muscleRelevance: exercise.muscleRelevance || [],
    name: exercise.codeName,
    overview: exercise.overview,
    part: exercise.part,
    restType: 1,
    restValue,
    sets,
    sortNo,
    sourceUrl: exercise.sourceUrl,
    sportType: 4,
    status: 1,
    targetType,
    targetValue,
    thumbnailUrl: exercise.thumbnailUrl,
    userId: 0,
    videoInfos: exercise.videoInfos,
    videoUrl: exercise.videoUrl,
    videoUrlArrStr: exercise.videoUrlArrStr,
    nameText: exercise.name,
    desc: exercise.desc,
    descText: exercise.desc,
    partText,
    muscleText,
    secondaryMuscleText,
    equipmentText,
    groupId: "",
    originId: exercise.id,
    targetDisplayUnit: 0,
    hrType: 0,
    intensityValueExtend: 0,
    intensityMultiplier: 0,
    intensityPercent: 0,
    intensityPercentExtend: 0,
    intensityDisplayUnit: "6",
  };
}

export function buildWorkoutPayload(
  name: string,
  overview: string,
  exercisePayloads: ExercisePayload[]
): WorkoutPayload {
  return {
    access: 1,
    authorId: "0",
    createTimestamp: 0,
    distance: 0,
    duration: 0,
    essence: 0,
    estimatedType: 0,
    estimatedValue: 0,
    exerciseNum: 0,
    exercises: exercisePayloads,
    headPic: "",
    id: "0",
    idInPlan: "0",
    name,
    nickname: "",
    originEssence: 0,
    overview,
    pbVersion: 2,
    planIdIndex: 0,
    poolLength: 2500,
    profile: "",
    referExercise: { intensityType: 1, hrType: 0, valueType: 1 },
    sex: 0,
    shareUrl: "",
    simple: false,
    sourceUrl: DEFAULT_SOURCE_URL,
    sportType: 4,
    star: 0,
    subType: 65535,
    targetType: 0,
    targetValue: 0,
    thirdPartyId: 0,
    totalSets: 0,
    trainingLoad: 0,
    type: 0,
    unit: 0,
    userId: "0",
    version: 0,
    videoCoverUrl: "",
    videoUrl: "",
    fastIntensityTypeName: "weight",
    poolLengthId: 1,
    poolLengthUnit: 2,
    sourceId: "425868133463670784",
  };
}

/** Resolve exercise overrides to catalog entries and build payloads */
export function resolveExercises(
  exercises: ExerciseOverrides[]
): ExercisePayload[] {
  return exercises.map((override, index) => {
    const catalog = findByName(override.name);
    if (!catalog) {
      throw new Error(`Exercise not found in catalog: "${override.name}"`);
    }
    return buildExercisePayload(catalog, index + 1, override);
  });
}

// --- Workout API ---

export interface CalculateResult {
  duration: number;
  totalSets: number;
  trainingLoad: number;
}

export async function calculateWorkout(
  auth: AuthData,
  name: string,
  overview: string,
  exercisePayloads: ExercisePayload[]
): Promise<CalculateResult> {
  const payload = buildWorkoutPayload(name, overview, exercisePayloads);
  const result = await apiPost(auth, "/training/program/calculate", payload) as Record<string, unknown>;
  const findNumber = (value: unknown, key: string): number | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const object = value as Record<string, unknown>;
    if (object[key] !== undefined && Number.isFinite(Number(object[key]))) return Number(object[key]);
    for (const child of Object.values(object)) {
      const found = findNumber(child, key);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const fallbackSets = exercisePayloads.reduce((sum, exercise) => sum + Math.max(1, Number(exercise.sets) || 1), 0);
  const fallbackDuration = Math.max(60, exercisePayloads.reduce((sum, exercise) => {
    const sets = Math.max(1, Number(exercise.sets) || 1);
    const workSeconds = exercise.targetType === 2
      ? Number(exercise.targetValue) || 0
      : (Number(exercise.targetValue) || 0) * 3;
    return sum + workSeconds * sets + Math.max(0, sets - 1) * (Number(exercise.restValue) || 0);
  }, 0));
  return {
    duration: findNumber(result, "duration") ?? fallbackDuration,
    totalSets: findNumber(result, "totalSets") ?? fallbackSets,
    trainingLoad: findNumber(result, "trainingLoad") ?? 0,
  };
}

export async function addWorkout(
  auth: AuthData,
  name: string,
  overview: string,
  exercisePayloads: ExercisePayload[],
  calculated: CalculateResult
): Promise<unknown> {
  const payload = buildWorkoutPayload(name, overview, exercisePayloads);
  // Apply calculated values
  payload.duration = calculated.duration;
  payload.totalSets = calculated.totalSets;
  payload.distance = "0"; // String in add (number in calculate)
  payload.sets = calculated.totalSets;
  payload.pitch = 0;
  return apiPost(auth, "/training/program/add", payload);
}

export interface QueryOptions {
  name?: string;
  sportType?: number;
  startNo?: number;
  limitSize?: number;
}

export async function queryWorkouts(
  auth: AuthData,
  options: QueryOptions = {}
): Promise<unknown> {
  const body = {
    name: options.name || "",
    supportRestExercise: 1,
    startNo: options.startNo ?? 0,
    limitSize: options.limitSize ?? 10,
    sportType: options.sportType ?? 0,
  };
  return apiPost(auth, "/training/program/query", body);
}

// --- Training calendar API ---

export interface ScheduleEntity {
  happenDay: string;
  idInPlan: number | string;
  sortNoInSchedule?: number;
  [key: string]: unknown;
}

export interface ScheduleQueryData {
  entities?: ScheduleEntity[];
  maxIdInPlan?: number | string;
  programs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ScheduleAssignmentPayload {
  entities: Array<{
    happenDay: string;
    idInPlan: number;
    sortNoInSchedule: number;
  }>;
  programs: Array<Record<string, unknown>>;
  versionObjects: Array<{ id: number; status: number }>;
  pbVersion: number;
}

/** Convert YYYY-MM-DD or YYYYMMDD to COROS' YYYYMMDD calendar format. */
export function normalizeScheduleDate(date: string): string {
  const compact = date.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error("Invalid date. Use YYYY-MM-DD or YYYYMMDD.");
  }

  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date.");
  }
  return compact;
}

/** Build the payload used by COROS Training Hub when a workout is added to a day. */
export function buildScheduleAssignmentPayload(
  workout: Record<string, unknown>,
  date: string,
  schedule: ScheduleQueryData
): ScheduleAssignmentPayload {
  const happenDay = normalizeScheduleDate(date);
  const entities = schedule.entities ?? [];
  const entityMax = entities.reduce(
    (max, entity) => Math.max(max, Number(entity.idInPlan) || 0),
    0
  );
  const idInPlan = Math.max(Number(schedule.maxIdInPlan) || 0, entityMax) + 1;
  const sortNoInSchedule =
    entities
      .filter((entity) => String(entity.happenDay) === happenDay)
      .reduce(
        (max, entity) => Math.max(max, Number(entity.sortNoInSchedule) || 0),
        0
      ) + 1;
  const program = { ...workout, idInPlan };

  return {
    entities: [{ happenDay, idInPlan, sortNoInSchedule }],
    programs: [program],
    versionObjects: [{ id: idInPlan, status: 1 }],
    pbVersion: Number(workout.pbVersion) || 2,
  };
}

export async function querySchedule(
  auth: AuthData,
  startDate: string,
  endDate: string = startDate
): Promise<ScheduleQueryData> {
  const start = normalizeScheduleDate(startDate);
  const end = normalizeScheduleDate(endDate);
  const result = (await apiGet(auth, "/training/schedule/query", {
    startDate: start,
    endDate: end,
    supportRestExercise: 1,
  })) as { data: ScheduleQueryData };
  return result.data;
}

export async function getWorkoutDetail(
  auth: AuthData,
  workoutId: string
): Promise<Record<string, unknown>> {
  const result = (await apiGet(auth, "/training/program/detail", {
    id: workoutId,
    supportRestExercise: 1,
  })) as { data: Record<string, unknown> };
  return result.data;
}

export async function assignWorkoutToCalendar(
  auth: AuthData,
  workoutId: string,
  date: string
): Promise<{ date: string; idInPlan: number; response: unknown }> {
  const happenDay = normalizeScheduleDate(date);
  const [schedule, workout] = await Promise.all([
    querySchedule(auth, happenDay),
    getWorkoutDetail(auth, workoutId),
  ]);
  const payload = buildScheduleAssignmentPayload(workout, happenDay, schedule);
  const response = await apiPost(auth, "/training/schedule/update", payload);
  return {
    date: happenDay,
    idInPlan: payload.entities[0].idInPlan,
    response,
  };
}

export interface StructuredSegment {
  kind: "warmup" | "training" | "interval" | "recovery" | "rest" | "cooldown";
  name?: string;
  targetType: "time" | "distance" | "open";
  durationSeconds?: number;
  distanceMeters?: number;
  intensityType?: "open" | "heart_rate" | "pace" | "power" | "cadence" | "speed";
  intensityMin?: number;
  intensityMax?: number;
}

export interface StructuredRepeat {
  repeat: number;
  name?: string;
  steps: StructuredSegment[];
}

export type StructuredStep = StructuredSegment | StructuredRepeat;

const EXERCISE_TYPES: Record<StructuredSegment["kind"], number> = {
  warmup: 1,
  training: 2,
  interval: 2,
  recovery: 4,
  rest: 4,
  cooldown: 3,
};

const INTENSITY_TYPES: Record<NonNullable<StructuredSegment["intensityType"]>, number> = {
  open: 0,
  heart_rate: 2,
  pace: 3,
  speed: 4,
  power: 6,
  cadence: 7,
};

function buildStructuredSegment(
  step: StructuredSegment,
  sportType: number,
  id: number,
  sortNo: number,
  groupId: string = "0"
): { exercise: Record<string, unknown>; time: number; distance: number } {
  let targetType: number;
  let targetValue: number;
  if (step.targetType === "open") {
    targetType = 1;
    targetValue = 0;
  } else if (step.targetType === "distance") {
    if (!step.distanceMeters || step.distanceMeters <= 0) {
      throw new Error("Distance steps require distanceMeters > 0.");
    }
    targetType = 5;
    targetValue = Math.round(step.distanceMeters * 100);
  } else {
    if (!step.durationSeconds || step.durationSeconds <= 0) {
      throw new Error("Time steps require durationSeconds > 0.");
    }
    targetType = 2;
    targetValue = Math.round(step.durationSeconds);
  }

  const intensityName = step.intensityType ?? "open";
  const intensityType = INTENSITY_TYPES[intensityName];
  const intensityValue = Math.round(step.intensityMin ?? 0);
  const intensityValueExtend = Math.round(step.intensityMax ?? step.intensityMin ?? 0);
  if (intensityType !== 0 && (!intensityValue || !intensityValueExtend)) {
    throw new Error(`${intensityName} intensity requires intensityMin and intensityMax.`);
  }
  if (intensityType !== 0 && intensityValueExtend < intensityValue) {
    throw new Error(`${intensityName} intensityMax must be greater than or equal to intensityMin.`);
  }

  const sportPrefix = sportType === 1 ? "run" : "bike";
  const overviewKind =
    step.kind === "warmup" ? "warm_up" :
    step.kind === "cooldown" ? "cool_down" :
    ["rest", "recovery"].includes(step.kind) ? "rest" : "training";
  const overview = `sid_${sportPrefix}_${overviewKind}${targetType === 5 && overviewKind !== "training" ? "_dist" : ""}`;

  return {
    exercise: {
      id,
      name: step.name ?? step.kind,
      overview,
      exerciseType: EXERCISE_TYPES[step.kind],
      sportType,
      intensityType,
      intensityValue,
      intensityValueExtend,
      intensityDisplayUnit: intensityName === "pace" ? 2 : 0,
      hrType: intensityName === "heart_rate" ? 3 : 0,
      isIntensityPercent: false,
      targetType,
      targetValue,
      targetDisplayUnit: targetType === 5 ? 3 : 0,
      sets: 1,
      sortNo,
      restType: 3,
      restValue: 0,
      groupId,
      isGroup: false,
      originId: "0",
    },
    time: targetType === 2 ? targetValue : 0,
    distance: targetType === 5 ? targetValue : 0,
  };
}

/** Build a COROS run/bike program, including one-level repeat groups. */
export function buildStructuredWorkoutPayload(
  name: string,
  sport: "running" | "cycling",
  steps: StructuredStep[],
  overview: string = ""
): Record<string, unknown> {
  if (!steps.length) throw new Error("At least one workout step is required.");
  const sportType = sport === "running" ? 1 : 2;
  const exercises: Array<Record<string, unknown>> = [];
  let topIndex = 0;
  let exerciseId = 0;
  let totalTime = 0;
  let totalDistance = 0;

  for (const step of steps) {
    topIndex += 1;
    const baseSort = 16777216 * topIndex;
    if ("repeat" in step) {
      if (step.repeat < 2 || !step.steps.length) {
        throw new Error("Repeat groups require repeat >= 2 and at least one step.");
      }
      exerciseId += 1;
      const groupId = exerciseId;
      let groupTime = 0;
      let groupDistance = 0;
      const children: Array<Record<string, unknown>> = [];
      step.steps.forEach((child, index) => {
        exerciseId += 1;
        const built = buildStructuredSegment(
          child,
          sportType,
          exerciseId,
          baseSort + 65536 * (index + 1),
          String(groupId)
        );
        children.push(built.exercise);
        groupTime += built.time;
        groupDistance += built.distance;
      });
      exercises.push({
        id: groupId,
        name: step.name ?? "Repeat",
        overview: `sid_${sport === "running" ? "run" : "bike"}_training`,
        exerciseType: 0,
        sportType,
        intensityType: 0,
        intensityValue: 0,
        intensityValueExtend: 0,
        targetType: groupDistance ? 5 : 2,
        targetValue: groupDistance || groupTime,
        targetDisplayUnit: groupDistance ? 3 : 0,
        sets: Math.round(step.repeat),
        sortNo: baseSort,
        restType: 3,
        restValue: 0,
        groupId: "0",
        isGroup: true,
        originId: "0",
      });
      exercises.push(...children);
      totalTime += groupTime * step.repeat;
      totalDistance += groupDistance * step.repeat;
    } else {
      exerciseId += 1;
      const built = buildStructuredSegment(step, sportType, exerciseId, baseSort);
      exercises.push(built.exercise);
      totalTime += built.time;
      totalDistance += built.distance;
    }
  }

  return {
    access: 1,
    authorId: "0",
    createTimestamp: 0,
    deleted: 0,
    distance: totalDistance,
    duration: totalTime,
    estimatedDistance: totalDistance,
    estimatedTime: totalTime,
    estimatedType: totalDistance ? 6 : 0,
    exerciseNum: exercises.length,
    exercises,
    id: "0",
    idInPlan: "0",
    name,
    overview,
    pbVersion: 2,
    simple: false,
    sportType,
    status: 1,
    targetType: totalDistance ? 5 : 2,
    targetValue: totalDistance || totalTime,
    totalSets: exercises.length,
    trainingLoad: 0,
    userId: "0",
    version: 0,
  };
}

export async function createStructuredWorkout(
  auth: AuthData,
  name: string,
  sport: "running" | "cycling",
  steps: StructuredStep[],
  overview: string = ""
): Promise<string> {
  const payload = buildStructuredWorkoutPayload(name, sport, steps, overview);
  const result = (await apiPost(auth, "/training/program/add", payload)) as { data: string | number };
  return String(result.data);
}

/** Prepare a Training Hub program detail response to be saved as a new workout. */
export function prepareWorkoutClone(
  workout: Record<string, unknown>,
  changes: { name?: string; overview?: string } = {}
): Record<string, unknown> {
  const payload = structuredClone(workout);
  delete payload.exerciseBarChart;
  delete payload.officalConfig;
  payload.id = "0";
  payload.idInPlan = "0";
  payload.authorId = "0";
  payload.userId = "0";
  payload.createTimestamp = 0;
  payload.deleted = 0;
  payload.status = 1;
  payload.version = 0;
  payload.star = 0;
  payload.nickname = "";
  if (changes.name !== undefined) payload.name = changes.name;
  if (changes.overview !== undefined) payload.overview = changes.overview;

  const exercises = Array.isArray(payload.exercises)
    ? payload.exercises as Array<Record<string, unknown>>
    : [];
  const idMap = new Map<string, string>();
  exercises.forEach((exercise, index) => {
    idMap.set(String(exercise.id ?? index + 1), String(index + 1));
  });
  exercises.forEach((exercise, index) => {
    exercise.id = String(index + 1);
    exercise.programId = "0";
    exercise.userId = 0;
    exercise.createTimestamp = 0;
    exercise.deleted = 0;
    exercise.status = 1;
    exercise.defaultOrder = index;
    const oldGroupId = String(exercise.groupId ?? "0");
    exercise.groupId = idMap.get(oldGroupId) ?? oldGroupId;
  });
  return payload;
}

export async function cloneWorkout(
  auth: AuthData,
  workoutId: string,
  changes: { name?: string; overview?: string } = {}
): Promise<string> {
  const source = await getWorkoutDetail(auth, workoutId);
  const payload = prepareWorkoutClone(source, changes);
  const result = (await apiPost(auth, "/training/program/add", payload)) as { data: string | number };
  return String(result.data);
}

export async function createWorkoutFromRaw(
  auth: AuthData,
  workout: Record<string, unknown>,
  changes: { name?: string; overview?: string } = {}
): Promise<string> {
  const payload = prepareWorkoutClone(workout, changes);
  const result = (await apiPost(auth, "/training/program/add", payload)) as { data: string | number };
  return String(result.data);
}

export async function replaceStructuredWorkout(
  auth: AuthData,
  workoutId: string,
  name: string,
  sport: "running" | "cycling",
  steps: StructuredStep[],
  overview: string = "",
  deleteOriginal: boolean = false
): Promise<string> {
  const newWorkoutId = await createStructuredWorkout(auth, name, sport, steps, overview);
  if (deleteOriginal) await deleteWorkout(auth, workoutId);
  return newWorkoutId;
}

export async function deleteWorkout(auth: AuthData, workoutId: string): Promise<void> {
  await apiPost(auth, "/training/program/delete", [workoutId]);
}

export interface ScheduledWorkout {
  planId: string;
  idInPlan: string;
  planProgramId: string;
  date: string;
  sortNo: number;
  workoutId: string;
  name: string;
  sportType: number;
  duration: number;
  distance: number;
}

export async function listScheduledWorkouts(
  auth: AuthData,
  startDate: string,
  endDate: string
): Promise<ScheduledWorkout[]> {
  const data = await querySchedule(auth, startDate, endDate);
  const programs = data.programs ?? [];
  const byIdInPlan = new Map(programs.map((p) => [String(p.idInPlan ?? ""), p]));
  const byId = new Map(programs.map((p) => [String(p.id ?? ""), p]));
  return (data.entities ?? []).map((entity, index) => {
    const planProgramId = String(entity.planProgramId ?? "");
    const program =
      byIdInPlan.get(String(entity.idInPlan)) ??
      byId.get(planProgramId) ??
      programs[index] ?? {};
    return {
      planId: String(entity.planId ?? ""),
      idInPlan: String(entity.idInPlan ?? ""),
      planProgramId,
      date: String(entity.happenDay ?? ""),
      sortNo: Number(entity.sortNoInSchedule) || 1,
      workoutId: String(program.id ?? planProgramId),
      name: String(program.name ?? "Unnamed workout"),
      sportType: Number(program.sportType) || 0,
      duration: Number(program.estimatedTime ?? program.duration) || 0,
      distance: Number(program.estimatedDistance ?? program.distance) || 0,
    };
  });
}

export interface CalendarConflict {
  date: string;
  count: number;
  workouts: Array<{ idInPlan: string; name: string; sportType: number }>;
}

export function detectCalendarConflicts(items: ScheduledWorkout[]): CalendarConflict[] {
  const byDate = new Map<string, ScheduledWorkout[]>();
  for (const item of items) {
    const group = byDate.get(item.date) ?? [];
    group.push(item);
    byDate.set(item.date, group);
  }
  return [...byDate.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([date, group]) => ({
      date,
      count: group.length,
      workouts: group.map(({ idInPlan, name, sportType }) => ({ idInPlan, name, sportType })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface PlannedSummary {
  workoutCount: number;
  durationSeconds: number;
  distanceMeters: number;
  bySport: Record<string, { count: number; durationSeconds: number; distanceMeters: number }>;
}

export function summarizePlannedWorkouts(items: ScheduledWorkout[]): PlannedSummary {
  const result: PlannedSummary = { workoutCount: 0, durationSeconds: 0, distanceMeters: 0, bySport: {} };
  const sportNames: Record<number, string> = { 1: "running", 2: "cycling", 4: "strength" };
  for (const item of items) {
    const sport = sportNames[item.sportType] ?? `sport_${item.sportType}`;
    const duration = Math.max(0, item.duration || 0);
    // COROS stores structured-workout distance in hundredths of a metre.
    const distanceMeters = Math.max(0, item.distance || 0) / 100;
    const bucket = result.bySport[sport] ?? { count: 0, durationSeconds: 0, distanceMeters: 0 };
    bucket.count += 1;
    bucket.durationSeconds += duration;
    bucket.distanceMeters += distanceMeters;
    result.bySport[sport] = bucket;
    result.workoutCount += 1;
    result.durationSeconds += duration;
    result.distanceMeters += distanceMeters;
  }
  return result;
}

export function addDaysToScheduleDate(date: string, days: number): string {
  const compact = normalizeScheduleDate(date);
  const value = new Date(Date.UTC(
    Number(compact.slice(0, 4)),
    Number(compact.slice(4, 6)) - 1,
    Number(compact.slice(6, 8))
  ));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

export interface CalendarMovePreview {
  idInPlan: string;
  name: string;
  from: string;
  to: string;
}

export function buildShiftPreview(items: ScheduledWorkout[], days: number): CalendarMovePreview[] {
  if (!Number.isInteger(days) || days === 0) throw new Error("days must be a non-zero integer.");
  return items.map((item) => ({
    idInPlan: item.idInPlan,
    name: item.name,
    from: item.date,
    to: addDaysToScheduleDate(item.date, days),
  }));
}

export async function replaceScheduledWorkout(
  auth: AuthData,
  sourceDate: string,
  idInPlan: string,
  replacementWorkoutId: string
): Promise<{ newIdInPlan: number }> {
  const data = await querySchedule(auth, sourceDate, sourceDate);
  const entity = (data.entities ?? []).find((candidate) => String(candidate.idInPlan) === idInPlan);
  if (!entity) throw new Error(`Scheduled entry ${idInPlan} not found on ${sourceDate}.`);
  // Add first, remove second: a failed add never destroys the existing calendar entry.
  const added = await assignWorkoutToCalendar(auth, replacementWorkoutId, sourceDate);
  await removeScheduledWorkout(
    auth,
    String(entity.planId ?? ""),
    idInPlan,
    String(entity.planProgramId ?? "")
  );
  return { newIdInPlan: added.idInPlan };
}

export async function shiftCalendarRange(
  auth: AuthData,
  startDate: string,
  endDate: string,
  days: number
): Promise<CalendarMovePreview[]> {
  const items = await listScheduledWorkouts(auth, startDate, endDate);
  const preview = buildShiftPreview(items, days);
  // Avoid invalidating the source lookup when source and target ranges overlap.
  const ordered = [...preview].sort((a, b) =>
    days > 0 ? b.from.localeCompare(a.from) : a.from.localeCompare(b.from)
  );
  for (const move of ordered) {
    await moveScheduledWorkout(auth, move.from, move.idInPlan, move.to);
  }
  return preview;
}

export async function swapScheduledWorkouts(
  auth: AuthData,
  firstDate: string,
  firstIdInPlan: string,
  secondDate: string,
  secondIdInPlan: string
): Promise<void> {
  const first = normalizeScheduleDate(firstDate);
  const second = normalizeScheduleDate(secondDate);
  if (first === second) throw new Error("Swapping two entries on the same date is not supported; use move_scheduled_workout to change their order.");
  const initial = await listScheduledWorkouts(auth, first < second ? first : second, first < second ? second : first);
  if (!initial.some((item) => item.idInPlan === firstIdInPlan && item.date === first) ||
      !initial.some((item) => item.idInPlan === secondIdInPlan && item.date === second)) {
    throw new Error("One or both scheduled entries were not found on the specified dates.");
  }

  let temporaryDate = "";
  const base = first > second ? first : second;
  for (let offset = 1; offset <= 31; offset += 1) {
    const candidate = addDaysToScheduleDate(base, offset);
    const schedule = await querySchedule(auth, candidate, candidate);
    if (!(schedule.entities ?? []).length) {
      temporaryDate = candidate;
      break;
    }
  }
  if (!temporaryDate) throw new Error("Could not find an empty temporary calendar day within 31 days.");

  let firstMovedToTemporary = false;
  let secondMovedToFirst = false;
  try {
    await moveScheduledWorkout(auth, first, firstIdInPlan, temporaryDate);
    firstMovedToTemporary = true;
    await moveScheduledWorkout(auth, second, secondIdInPlan, first);
    secondMovedToFirst = true;
    await moveScheduledWorkout(auth, temporaryDate, firstIdInPlan, second);
  } catch (error) {
    // Best-effort rollback in reverse order so a partial swap does not remain hidden.
    try {
      if (secondMovedToFirst) await moveScheduledWorkout(auth, first, secondIdInPlan, second);
      if (firstMovedToTemporary) await moveScheduledWorkout(auth, temporaryDate, firstIdInPlan, first);
    } catch {
      throw new Error(`Swap failed and automatic rollback was incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}

export async function removeScheduledWorkout(
  auth: AuthData,
  planId: string,
  idInPlan: string,
  planProgramId?: string
): Promise<void> {
  await apiPost(auth, "/training/schedule/update", {
    versionObjects: [{
      id: idInPlan,
      planId,
      planProgramId: planProgramId || idInPlan,
      status: 3,
    }],
    pbVersion: 2,
  });
}

export async function moveScheduledWorkout(
  auth: AuthData,
  sourceDate: string,
  idInPlan: string,
  newDate: string
): Promise<void> {
  const data = await querySchedule(auth, sourceDate, sourceDate);
  const entity = (data.entities ?? []).find((e) => String(e.idInPlan) === String(idInPlan));
  if (!entity) throw new Error(`Scheduled entry ${idInPlan} not found on ${sourceDate}.`);
  const planProgramId = String(entity.planProgramId ?? "");
  const program = (data.programs ?? []).find(
    (p) => String(p.idInPlan ?? "") === String(idInPlan) || String(p.id ?? "") === planProgramId
  );
  if (!program) throw new Error(`Program for scheduled entry ${idInPlan} was not returned by COROS.`);
  const targetDate = normalizeScheduleDate(newDate);
  const target = await querySchedule(auth, targetDate, targetDate);
  const sortNo = (target.entities ?? []).reduce(
    (max, e) => Math.max(max, Number(e.sortNoInSchedule) || 0),
    0
  ) + 1;
  const movedEntity = { ...entity, happenDay: targetDate, sortNoInSchedule: sortNo };
  await apiPost(auth, "/training/schedule/update", {
    entities: [movedEntity],
    programs: [program],
    versionObjects: [{
      type: 0,
      id: entity.idInPlan,
      planId: entity.planId,
      planProgramId: entity.planProgramId,
      status: 2,
    }],
    pbVersion: Number(program.pbVersion) || 2,
  });
}
