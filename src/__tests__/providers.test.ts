import { describe, expect, it } from "vitest";
import {
  CorosTrainingDataProvider,
  DEFAULT_TRAINING_DATA_PROVIDER_ID,
  FileTrainingDataProvider,
  getTrainingDataProvider,
  listTrainingDataProviders,
  providerSupports,
  registerTrainingDataProvider,
  resolveTrainingDataProvider,
  type TrainingDataProvider,
} from "../providers/index.js";

describe("training data providers", () => {
  it("keeps COROS registered as the default provider", () => {
    const provider = getTrainingDataProvider("coros");

    expect(DEFAULT_TRAINING_DATA_PROVIDER_ID).toBe("coros");
    expect(provider).toBeInstanceOf(CorosTrainingDataProvider);
    expect(resolveTrainingDataProvider()).toBe(provider);
    expect(provider?.displayName).toBe("COROS");
    expect(providerSupports(provider!, "activities")).toBe(true);
    expect(providerSupports(provider!, "daily_metrics")).toBe(true);
  });

  it("supports portable FIT and GPX analysis without changing the default provider", async () => {
    const provider = getTrainingDataProvider("file");
    expect(provider).toBeInstanceOf(FileTrainingDataProvider);
    expect(resolveTrainingDataProvider()).toBe(getTrainingDataProvider("coros"));
    expect(resolveTrainingDataProvider("file", "activity_file_analysis")).toBe(provider);
    expect(resolveTrainingDataProvider("file", "route_file_analysis")).toBe(provider);
    expect(await provider?.isAvailable()).toBe(true);

    const gpx = `<?xml version="1.0"?><gpx><trk><name>Test Route</name><trkseg><trkpt lat="40.0" lon="-3.0"><ele>600</ele></trkpt><trkpt lat="40.01" lon="-3.0"><ele>650</ele></trkpt></trkseg></trk></gpx>`;
    const result = await provider?.analyzeRouteFile?.({ format: "gpx", data: gpx, segmentDistanceKm: 2 });
    expect(result?.name).toBe("Test Route");
    expect(Number(result?.distanceKm)).toBeGreaterThan(1);
    expect(result?.elevationGainMeters).toBe(50);
  });

  it("supports partial providers without forcing unsupported methods", () => {
    const provider: TrainingDataProvider = {
      id: "test-activities-only",
      displayName: "Activities only",
      capabilities: new Set(["activities"]),
      async isAvailable() {
        return true;
      },
      async getActivities() {
        return { activities: [], total: 0 };
      },
    };

    registerTrainingDataProvider(provider);

    expect(getTrainingDataProvider(provider.id)).toBe(provider);
    expect(resolveTrainingDataProvider(provider.id, "activities")).toBe(provider);
    expect(() => resolveTrainingDataProvider(provider.id, "sleep")).toThrow(
      "does not support capability: sleep",
    );
    expect(providerSupports(provider, "activities")).toBe(true);
    expect(providerSupports(provider, "sleep")).toBe(false);
    expect(provider.getDailyMetrics).toBeUndefined();
    expect(listTrainingDataProviders()).toContain(provider);
  });

  it("fails explicitly for unknown providers", () => {
    expect(() => resolveTrainingDataProvider("missing-provider")).toThrow(
      "Training data provider not found: missing-provider",
    );
  });
});
