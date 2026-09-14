import {
  fetchActivities,
  fetchActivityDetail,
  fetchDailyMetrics,
  getValidAuth,
} from "../coros-api.js";
import type {
  ActivityDetailQuery,
  ActivityQuery,
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";
import type { AuthData } from "../types.js";

const COROS_CAPABILITIES = new Set<TrainingDataProviderCapability>([
  "daily_metrics",
  "activities",
  "activity_detail",
  "activity_export",
  "hrv",
  "calendar",
  "workouts",
  "routes",
]);

/**
 * Provider adapter over the existing COROS implementation.
 *
 * This deliberately delegates to coros-api.ts rather than moving or
 * duplicating COROS logic. Existing MCP tools can therefore keep their
 * current behaviour while new code starts depending on TrainingDataProvider.
 */
export class CorosTrainingDataProvider implements TrainingDataProvider {
  readonly id = "coros";
  readonly displayName = "COROS";
  readonly capabilities = COROS_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return (await getValidAuth()) !== null;
  }

  async getDailyMetrics(startDate: string, endDate: string) {
    const auth = await this.requireAuth();
    return fetchDailyMetrics(auth, startDate, endDate);
  }

  async getActivities(query: ActivityQuery) {
    const auth = await this.requireAuth();
    return fetchActivities(
      auth,
      query.startDate,
      query.endDate,
      query.page ?? 1,
      query.size ?? 30,
    );
  }

  async getActivityDetail(query: ActivityDetailQuery) {
    const auth = await this.requireAuth();
    return fetchActivityDetail(auth, query.activityId, query.sportType);
  }

  private async requireAuth(): Promise<AuthData> {
    const auth = await getValidAuth();
    if (!auth) {
      throw new Error("COROS is not authenticated.");
    }
    return auth;
  }
}
