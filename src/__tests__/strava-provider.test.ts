import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StravaTrainingDataProvider } from "../providers/strava-provider.js";

const tokenFile = resolve(tmpdir(), `coros-workout-strava-test-${process.pid}.json`);

beforeEach(() => {
  vi.stubEnv("STRAVA_CLIENT_ID", "123");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "secret");
  vi.stubEnv("STRAVA_REFRESH_TOKEN", "refresh-1");
  vi.stubEnv("STRAVA_TOKEN_FILE", tokenFile);
  delete process.env.STRAVA_ACCESS_TOKEN;
  delete process.env.STRAVA_EXPIRES_AT;
  rmSync(tokenFile, { force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(tokenFile, { force: true });
});

describe("StravaTrainingDataProvider", () => {
  it("is optional and only available with OAuth application credentials plus a refresh token", async () => {
    const provider = new StravaTrainingDataProvider();
    expect(await provider.isAvailable()).toBe(true);

    delete process.env.STRAVA_REFRESH_TOKEN;
    expect(await new StravaTrainingDataProvider().isAvailable()).toBe(false);
  });

  it("uses a valid bootstrap access token and maps athlete activities without refreshing", async () => {
    vi.stubEnv("STRAVA_ACCESS_TOKEN", "access-live");
    vi.stubEnv("STRAVA_EXPIRES_AT", String(Math.floor(Date.now() / 1000) + 7200));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/api/v3/athlete/activities?");
      return new Response(JSON.stringify([{
        id: 42,
        name: "Morning Ride",
        sport_type: "Ride",
        start_date: "2026-09-14T06:00:00Z",
        elapsed_time: 3600,
        distance: 30000,
        average_heartrate: 135,
        max_heartrate: 168,
        average_watts: 190,
        weighted_average_watts: 205,
        total_elevation_gain: 420,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StravaTrainingDataProvider();
    const result = await provider.getActivities({ startDate: "2026-09-14", endDate: "2026-09-14" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.activities[0]).toMatchObject({
      activityId: "42",
      date: "20260914",
      name: "Morning Ride",
      sportName: "Ride",
      durationSeconds: 3600,
      distanceMeters: 30000,
      averageHeartRate: 135,
      averagePower: 190,
      normalizedPower: 205,
      elevationGain: 420,
    });
  });

  it("refreshes expired credentials and persists the newest rotated refresh token", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_at: Math.floor(Date.now() / 1000) + 21600,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v3/activities/99")) {
        return new Response(JSON.stringify({ id: 99, name: "Run" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StravaTrainingDataProvider();
    const detail = await provider.getActivityDetail({ activityId: "99", sportType: 0 });

    expect(detail.id).toBe(99);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(existsSync(tokenFile)).toBe(true);
    expect(JSON.parse(readFileSync(tokenFile, "utf8"))).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    delete process.env.STRAVA_REFRESH_TOKEN;
    expect(await new StravaTrainingDataProvider().isAvailable()).toBe(true);
  });
});
