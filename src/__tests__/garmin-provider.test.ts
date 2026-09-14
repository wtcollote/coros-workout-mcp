import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminTrainingDataProvider } from "../providers/garmin-provider.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Garmin training data provider", () => {
  it("stays unavailable until approved Garmin API configuration is supplied", async () => {
    vi.stubEnv("GARMIN_ACCESS_TOKEN", "");
    vi.stubEnv("GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE", "");
    vi.stubEnv("GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE", "");

    const provider = new GarminTrainingDataProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it("normalizes configured Activity API responses without changing the default provider", async () => {
    vi.stubEnv("GARMIN_ACCESS_TOKEN", "garmin-test-token");
    vi.stubEnv(
      "GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE",
      "https://garmin.example/activities?start={startDate}&end={endDate}&page={page}&size={size}",
    );
    vi.stubEnv(
      "GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE",
      "https://garmin.example/activities/{activityId}",
    );

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer garmin-test-token");
      if (url.includes("/activities?")) {
        expect(url).toContain("start=20260901");
        expect(url).toContain("end=20260930");
        return new Response(JSON.stringify({
          totalCount: 1,
          activitySummaries: [{
            activityId: 12345,
            activityName: "Morning Ride",
            activityType: { typeKey: "cycling" },
            startTimeInSeconds: 1788249600,
            durationInSeconds: 3600,
            distanceInMeters: 30000,
            averageHeartRateInBeatsPerMinute: 140,
            maxHeartRateInBeatsPerMinute: 170,
            activeKilocalories: 700,
            averagePowerInWatts: 210,
            normalizedPowerInWatts: 225,
            totalElevationGainInMeters: 450,
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ activityId: 12345, samples: 10 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GarminTrainingDataProvider();
    expect(await provider.isAvailable()).toBe(true);

    const result = await provider.getActivities({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      page: 1,
      size: 30,
    });

    expect(result.total).toBe(1);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      activityId: "12345",
      name: "Morning Ride",
      sportName: "cycling",
      durationSeconds: 3600,
      distanceMeters: 30000,
      averageHeartRate: 140,
      maximumHeartRate: 170,
      calories: 700,
      averagePower: 210,
      normalizedPower: 225,
      elevationGain: 450,
    });

    const detail = await provider.getActivityDetail({ activityId: "12345", sportType: 0 });
    expect(detail.activityId).toBe(12345);
  });

  it("surfaces authorization and rate-limit errors explicitly", async () => {
    vi.stubEnv("GARMIN_ACCESS_TOKEN", "garmin-test-token");
    vi.stubEnv("GARMIN_ACTIVITY_SUMMARIES_URL_TEMPLATE", "https://garmin.example/activities");
    vi.stubEnv("GARMIN_ACTIVITY_DETAIL_URL_TEMPLATE", "https://garmin.example/activities/{activityId}");

    const provider = new GarminTrainingDataProvider();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(provider.getActivities({ startDate: "20260901", endDate: "20260930" }))
      .rejects.toThrow("Garmin authorization failed");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    await expect(provider.getActivities({ startDate: "20260901", endDate: "20260930" }))
      .rejects.toThrow("Garmin API rate limit exceeded");
  });
});
