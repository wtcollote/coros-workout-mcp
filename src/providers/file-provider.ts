import { analyzeFitBuffer, type FitAnalysisOptions } from "../fit-analysis.js";
import { analyzeGpxRoute } from "../route-analysis.js";
import type {
  ActivityFileAnalysisQuery,
  RouteFileAnalysisQuery,
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";

const FILE_CAPABILITIES = new Set<TrainingDataProviderCapability>([
  "activity_file_analysis",
  "route_file_analysis",
]);

/**
 * Portable provider for user-supplied training files.
 *
 * It has no account, network session or persistence. The purpose is to expose
 * provider-neutral analysis for FIT activities and GPX routes so the analysis
 * layer is useful even without COROS and can later be reused by Garmin/Strava
 * imports without duplicating parsers.
 */
export class FileTrainingDataProvider implements TrainingDataProvider {
  readonly id = "file";
  readonly displayName = "FIT / GPX files";
  readonly capabilities = FILE_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyzeActivityFile(query: ActivityFileAnalysisQuery): Promise<Record<string, unknown>> {
    if (query.format !== "fit") {
      throw new Error(`Unsupported activity file format: ${String(query.format)}`);
    }
    return analyzeFitBuffer(query.data, (query.options ?? {}) as FitAnalysisOptions);
  }

  async analyzeRouteFile(query: RouteFileAnalysisQuery): Promise<Record<string, unknown>> {
    if (query.format !== "gpx") {
      throw new Error(`Unsupported route file format: ${String(query.format)}`);
    }
    const gpx = Buffer.isBuffer(query.data) ? query.data.toString("utf8") : query.data;
    return analyzeGpxRoute(gpx, query.segmentDistanceKm ?? 25) as unknown as Record<string, unknown>;
  }
}
