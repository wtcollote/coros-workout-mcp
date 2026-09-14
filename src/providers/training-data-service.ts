import {
  getTrainingDataProvider,
  listTrainingDataProviders,
} from "./registry.js";
import type {
  TrainingDataProvider,
  TrainingDataProviderCapability,
} from "./training-data-provider.js";

export const DEFAULT_TRAINING_DATA_PROVIDER_ID = process.env.TRAINING_DATA_PROVIDER_ID?.trim() || "coros";

export function resolveTrainingDataProvider(
  providerId: string = DEFAULT_TRAINING_DATA_PROVIDER_ID,
  capability?: TrainingDataProviderCapability,
): TrainingDataProvider {
  const provider = getTrainingDataProvider(providerId);
  if (!provider) {
    throw new Error(`Training data provider not found: ${providerId}`);
  }
  if (capability && !provider.capabilities.has(capability)) {
    throw new Error(`Training data provider ${providerId} does not support capability: ${capability}`);
  }
  return provider;
}

export async function getTrainingDataProviderStatus() {
  return Promise.all(
    listTrainingDataProviders().map(async (provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      available: await provider.isAvailable(),
      capabilities: [...provider.capabilities].sort(),
      isDefault: provider.id === DEFAULT_TRAINING_DATA_PROVIDER_ID,
    })),
  );
}
