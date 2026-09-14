import type {
  TrainingActivitySummary,
  TrainingDailyMetric,
} from "./training-data-types.js";

export type TrainingDataProviderCapability =
  | "daily_metrics"
  | "activities"
  | "activity_detail"
  | "activity_export"
  | "activity_file_analysis"
  | "route_file_analysis"
  | "sleep"
  | "hrv"
  | "calendar"
  | "workouts"
  | "routes";

export interface ActivityQuery {
  startDate: string;
  endDate: string;
  page?: number;
  size?: number;
}

export interface ActivityDetailQuery {
  activityId: string;
  sportType: number;
}

export interface ActivityFileAnalysisQuery {
  format: "fit";
  data: Buffer;
  options?: Record<string, unknown>;
}

export interface RouteFileAnalysisQuery {
  format: "gpx";
  data: string | Buffer;
  segmentDistanceKm?: number;
}

export interface TrainingDataProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<TrainingDataProviderCapability>;

  isAvailable(): Promise<boolean>;

  getDailyMetrics?(startDate: string, endDate: string): Promise<TrainingDailyMetric[]>;
  getActivities?(query: ActivityQuery): Promise<{ activities: TrainingActivitySummary[]; total: number }>;
  getActivityDetail?(query: ActivityDetailQuery): Promise<Record<string, unknown>>;
  analyzeActivityFile?(query: ActivityFileAnalysisQuery): Promise<Record<string, unknown>>;
  analyzeRouteFile?(query: RouteFileAnalysisQuery): Promise<Record<string, unknown>>;
}

export function providerSupports(
  provider: TrainingDataProvider,
  capability: TrainingDataProviderCapability,
): boolean {
  return provider.capabilities.has(capability);
}
