const AUTH_SERVER_URL = 'https://api.loccle.com'

export interface CatalogModel {
  id: string
  providerId: string
  providerName: string
  upstreamType: string
  name: string
  publicModelId: string
  upstreamModelId: string
  customBaseUrl: string | null
  providerBaseUrl: string | null
  status: string
  contextWindow: number | null
  supportsTools: boolean
  supportsReasoning: boolean
  supportsVision: boolean
  inputTokenPriceUsd: string
  outputTokenPriceUsd: string
  cacheReadPriceUsd: string | null
  cacheWritePriceUsd: string | null
}

let cachedModels: CatalogModel[] = []

export function getCachedModels() {
  return cachedModels
}

export async function fetchModels(): Promise<CatalogModel[]> {
  try {
    const res = await fetch(`${AUTH_SERVER_URL}/api/catalog/models`)
    if (!res.ok) {
      console.error(`[Desktop ModelStore] Failed to fetch models: HTTP ${res.status}`)
      return []
    }

    const body = await res.json() as { data?: CatalogModel[] }
    cachedModels = Array.isArray(body?.data) ? body.data : []
    return cachedModels
  } catch (error) {
    console.error('[Desktop ModelStore] Failed to fetch models:', error)
    return []
  }
}

export function getFirstModelId(models = cachedModels): string | null {
  return models[0]?.publicModelId ?? null
}

export function getModelDisplayName(modelId: string | null, models = cachedModels): string {
  if (!modelId) return 'Loading model...'
  return models.find((model) => model.publicModelId === modelId)?.name ?? modelId
}
