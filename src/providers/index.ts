export {
  registerTrainingDataProvider,
  getTrainingDataProvider,
  listTrainingDataProviders,
} from "./registry.js";
export {
  DEFAULT_TRAINING_DATA_PROVIDER_ID,
  resolveTrainingDataProvider,
  getTrainingDataProviderStatus,
} from "./training-data-service.js";
export type {
  ActivityDetailQuery,
  ActivityFileAnalysisQuery,
  ActivityQuery,
  RouteFileAnalysisQuery,
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";
export type {
  TrainingActivitySummary,
  TrainingDailyMetric,
} from "./training-data-types.js";
export { providerSupports } from "./training-data-provider.js";
export { CorosTrainingDataProvider } from "./coros-provider.js";
export { FileTrainingDataProvider } from "./file-provider.js";
export { StravaTrainingDataProvider } from "./strava-provider.js";
export { GarminTrainingDataProvider, normalizeGarminActivity } from "./garmin-provider.js";
