import { authServerUrl } from './constants';

export interface CatalogModel {
  id: string;
  providerId: string;
  providerName: string;
  upstreamType: string;
  name: string;
  publicModelId: string;
  upstreamModelId: string;
  customBaseUrl: string | null;
  providerBaseUrl: string | null;
  status: string;
  contextWindow: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  inputTokenPriceUsd: string;
  outputTokenPriceUsd: string;
  cacheReadPriceUsd: string | null;
  cacheWritePriceUsd: string | null;
}

let cachedModels: CatalogModel[] = [];
let selectedModelId: string | null = null;
let initialized = false;

export function getSelectedModelId(): string | null {
  return selectedModelId;
}

export function getCachedModels(): CatalogModel[] {
  return cachedModels;
}

export function setSelectedModelId(modelId: string): void {
  selectedModelId = modelId;
}

/**
 * Fetch public catalog models from the auth server.
 * Endpoint: GET /api/catalog/models (no auth required)
 */
export async function fetchModels(): Promise<CatalogModel[]> {
  try {
    const res = await fetch(`${authServerUrl}/api/catalog/models`);
    if (!res.ok) {
      console.error(`[ModelStore] Failed to fetch models: HTTP ${res.status}`);
      return [];
    }
    const body = (await res.json()) as { data?: CatalogModel[] };
    const models = Array.isArray(body?.data) ? body.data : [];
    cachedModels = models;
    return models;
  } catch (error) {
    console.error('[ModelStore] Failed to fetch models:', error);
    return [];
  }
}

/**
 * Initialize the model store.
 * - If OPENAI_COMPATIBLE_MODEL is set, use it.
 * - Otherwise, fetch from backend and use the first model.
 * - Falls back to 'gpt-4o-mini' if everything fails.
 */
export async function initModelStore(): Promise<string> {
  if (initialized) {
    return selectedModelId ?? process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4o-mini';
  }

  const envModel = process.env.OPENAI_COMPATIBLE_MODEL?.trim();
  if (envModel) {
    selectedModelId = envModel;
    initialized = true;
    return envModel;
  }

  // Fetch from backend
  const models = await fetchModels();
  if (models.length > 0) {
    selectedModelId = models[0].publicModelId;
    initialized = true;
    return selectedModelId;
  }

  // Ultimate fallback
  selectedModelId = 'gpt-4o-mini';
  initialized = true;
  return selectedModelId;
}

/**
 * Reset initialization (useful if you want to re-fetch on model switch)
 */
export function resetModelStore(): void {
  initialized = false;
  selectedModelId = null;
  cachedModels = [];
}
