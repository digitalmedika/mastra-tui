import { MastraClient } from '@mastra/client-js'

let mastraUrl = 'http://localhost:4112'

export function setMastraUrl(url: string) {
  mastraUrl = url
}

export function getMastraUrl() {
  return mastraUrl
}

let client: MastraClient | null = null

export function getMastraClient(): MastraClient {
  if (!client) {
    client = new MastraClient({
      baseUrl: mastraUrl,
    })
  }
  return client
}

export function resetMastraClient() {
  client = null
}

export function getAgent() {
  return getMastraClient().getAgent('openAICompatibleAgent')
}
