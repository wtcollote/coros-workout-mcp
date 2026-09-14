import { CorosTrainingDataProvider } from "./coros-provider.js";
import { FileTrainingDataProvider } from "./file-provider.js";
import { GarminTrainingDataProvider } from "./garmin-provider.js";
import { StravaTrainingDataProvider } from "./strava-provider.js";
import type { TrainingDataProvider } from "./training-data-provider.js";

const providers = new Map<string, TrainingDataProvider>();

export function registerTrainingDataProvider(provider: TrainingDataProvider): void {
  providers.set(provider.id, provider);
}

export function getTrainingDataProvider(id: string): TrainingDataProvider | undefined {
  return providers.get(id);
}

export function listTrainingDataProviders(): TrainingDataProvider[] {
  return [...providers.values()];
}

registerTrainingDataProvider(new CorosTrainingDataProvider());
registerTrainingDataProvider(new FileTrainingDataProvider());
registerTrainingDataProvider(new StravaTrainingDataProvider());
registerTrainingDataProvider(new GarminTrainingDataProvider());
