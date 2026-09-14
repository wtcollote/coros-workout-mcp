import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCorosWorkoutServer } from "../index.js";
import { executeCompatibilityRead, READ_OPERATIONS } from "../compatibility-bridge.js";
import { OfficialSleepRecordSchema, resolveSleepRecords } from "../sleep-source.js";
import { fetchSleep, getValidAuth } from "../coros-api.js";

vi.mock("../coros-api.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../coros-api.js")>(),
  getValidAuth: vi.fn(async () => ({ accessToken: "test", userId: "test", region: "eu" })),
  fetchSleep: vi.fn(async () => { throw new Error("Mobile sleep must not be called"); }),
  fetchHrv: vi.fn(async () => [{ date: "20260908", average: 50, baseline: 50 }]),
  fetchDailyMetrics: vi.fn(async () => [{ date: "20260908", restingHeartRate: 50, trainingLoadRatio: 1 }]),
  fetchActivities: vi.fn(async () => ({ activities: [{ activityId: "test", date: "20260908", sportType: 400, durationSeconds: 1800, trainingLoad: 20 }], total: 1 })),
  listScheduledWorkouts: vi.fn(async () => []),
}));

const official = {
  date: "2026-09-08", totalDurationMinutes: 418, deepMinutes: 75,
  lightMinutes: 234, remMinutes: 104, awakeMinutes: 5, napMinutes: 0,
  averageHeartRate: null, minimumHeartRate: null, maximumHeartRate: null, qualityScore: 98,
};
const normalized = { ...official, date: "20260908" };
const range = { startDate: "2026-09-08", endDate: "2026-09-08" };
const closeables: Array<{ close(): Promise<void> }> = [];
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN", "false"); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); })); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.allSettled(closeables.splice(0).map((item) => item.close())); });
async function client() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createCorosWorkoutServer();
  const client = new Client({ name: "sleep-test", version: "1" });
  closeables.push(client, server);
  await server.connect(st); await client.connect(ct);
  return client;
}
async function call(name: string, args: Record<string, unknown>) {
  const result = await (await client()).callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

describe("central official sleep resolution", () => {
  it("normalizes, sorts and filters dates, preserving null and zero without mutation", async () => {
    const records = [official, { ...official, date: "20260907" }, { ...official, date: "20260909" }];
    const result = await resolveSleepRecords({ startDate: "20260907", endDate: "2026-09-08", officialSleepRecords: records });
    expect(result.records.map((r) => r.date)).toEqual(["20260907", "20260908"]);
    expect(result.records[1]).toEqual(normalized);
    expect(records[0].date).toBe("2026-09-08");
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it.each([undefined, [], [{ ...official, date: "20260901" }]])("returns unavailable for absent or out-of-range records (%j)", async (officialSleepRecords) => {
    const result = await resolveSleepRecords({ ...range, officialSleepRecords });
    expect(result.status).toBe("unavailable"); expect(result.records).toEqual([]);
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it.each(["", "false", "TRUE", "1"])("does not enable mobile login with flag %j", async (flag) => {
    vi.stubEnv("COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN", flag);
    await resolveSleepRecords({ ...range, auth: await getValidAuth() });
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("uses official records even when the optional mobile flag is true", async () => {
    vi.stubEnv("COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN", "true");
    for (const records of [[official], []]) await resolveSleepRecords({ ...range, officialSleepRecords: records, auth: await getValidAuth() });
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("keeps unofficial mobile sleep disabled even when legacy opt-in is true", async () => {
    vi.stubEnv("COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN", "true");
    const result = await resolveSleepRecords({ ...range, auth: await getValidAuth() });
    expect(result.status).toBe("unavailable");
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("does not enable mobile login when the flag is unset", async () => {
    delete process.env.COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN;
    expect((await resolveSleepRecords({ ...range, auth: await getValidAuth() })).status).toBe("unavailable");
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("does not resolve unofficial mobile sleep under legacy opt-in", async () => {
    vi.stubEnv("COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN", "true");
    vi.mocked(fetchSleep).mockResolvedValueOnce([official]);
    const result = await resolveSleepRecords({ ...range, auth: await getValidAuth() });
    expect(result.records).toEqual([]);
    expect(result.status).toBe("unavailable");
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("validates metrics and keeps missing metrics unknown", () => {
    expect(OfficialSleepRecordSchema.parse({ date: official.date }).qualityScore).toBeNull();
    expect(() => OfficialSleepRecordSchema.parse({ ...official, deepMinutes: -1 })).toThrow();
  });
});

const legacy: Array<[string, Record<string, unknown>, (result: any) => unknown, unknown]> = [
  ["get_sleep_data", range, (r) => r.records[0], normalized],
  ["get_readiness_summary", { date: official.date }, (r) => r.sleep, normalized],
  ["daily_training_briefing", { date: official.date }, (r) => r.current.sleep, normalized],
  ["weekly_training_report", { endDate: official.date }, (r) => r.current.recovery.sleepDurationMinutesAverage, 418],
  ["preview_daily_adjustment", { date: official.date }, (r) => r.inputs.sleepMinutes, 418],
  ["taper_readiness", { asOfDate: official.date, raceDate: "2026-09-15" }, (r) => r.currentRecovery.sleep, normalized],
];
describe("legacy MCP tools with official sleep", () => {
  it.each(legacy)("%s consumes reference record", async (name, args, select, expected) => {
    const result = await call(name, { ...args, officialSleepRecords: [official] });
    expect(result.sleepSource).toBe("COROS MCP official OAuth"); expect(result.sleepStatus).toBe("available");
    expect(select(result)).toEqual(expected);
    expect(result.errors ?? result.dataAvailability?.errors ?? []).toEqual([]);
    if (name === "weekly_training_report") { expect(result.current.dataDays.sleep).toBe(1); expect(result.previous.dataDays.sleep).toBe(0); expect(result.previous.recovery.sleepDurationMinutesAverage).toBeNull(); }
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it.each(legacy)("%s stays usable without official sleep", async (name, args) => {
    const result = await call(name, args);
    expect(result.sleepStatus).toBe("unavailable");
    expect(result.errors ?? result.dataAvailability?.errors ?? []).toEqual([]);
    expect(fetchSleep).not.toHaveBeenCalled();
  });
  it("sleep-only reads do not need or refresh general COROS authentication", async () => {
    await call("get_sleep_data", { ...range, officialSleepRecords: [official] });
    await executeCompatibilityRead("get_sleep_data", { ...range, officialSleepRecords: [official] });
    expect(getValidAuth).not.toHaveBeenCalled();
  });
});

const modern = ["dashboard_snapshot", "professional_coaching_analysis", "adaptive_coaching_engine", "longitudinal_athlete_model", "athlete_intelligence", "personal_recovery_model", "residual_fatigue_model", "session_fingerprints", "performance_trend", "training_dose_optimizer", "event_readiness", "anomaly_data_quality", "simulate_training_change", "season_strategy", "evaluate_prior_decision", "get_sleep_data"];
const modernArgs = { ...range, date: official.date, referenceDate: official.date, name: "test", sportType: 200, durationSeconds: 1800, priorDecision: "maintain", priorDate: "2026-09-07", evaluationDate: official.date };
describe("compatibility bridge sleep ingestion", () => {
  it.each(modern)("%s accepts the shared official source and tolerates its absence", async (operation) => {
    expect(READ_OPERATIONS.find((r) => r.name === operation)?.input).toHaveProperty("officialSleepRecords");
    for (const officialSleepRecords of [[official], undefined, []]) {
      const response = await call("coros_read", { operation, input: { ...modernArgs, officialSleepRecords } });
      expect(response.result.sleepStatus).toBe(officialSleepRecords?.length ? "available" : "unavailable");
      if (officialSleepRecords) expect(response.result.sleepSource).toBe("COROS MCP official OAuth");
      if (operation === "adaptive_coaching_engine") expect(response.result.observedSignals.sleepMinutes).toBe(officialSleepRecords?.length ? 418 : null);
      if (operation === "professional_coaching_analysis") expect(response.result.observedEvidence.current.sleep).toEqual(officialSleepRecords?.length ? normalized : null);
      if (operation === "get_sleep_data" && officialSleepRecords?.length) expect(response.result.records).toEqual([normalized]);
      if (operation === "dashboard_snapshot" && officialSleepRecords?.length) {
        expect(response.result.intel.anomalyAndDataQuality.dataQuality.completenessPercent).toBe(100);
        expect(response.result.coach.observedSignals.sleepMinutes).toBe(418);
        expect(response.result.dataSources.sourceErrors).toEqual([]);
      }
    }
    expect(fetchSleep).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
