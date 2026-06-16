import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let mastraProcess: ChildProcess | null = null
let mastraPort = 0
let mastraModelId: string | null = null

export interface StartMastraResult {
  port: number
  modelId: string | null
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        reject(new Error('Failed to find available port'))
      }
    })
  })
}

function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Mastra server did not start within ${timeoutMs}ms`))
        return
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          if (res.statusCode === 200 || res.statusCode === 404) {
            // 200 = health endpoint exists, 404 = server is up but no /api/health route
            // Either way, the server is accepting connections
            resolve()
          } else {
            setTimeout(check, 500)
          }
        },
      )

      req.on('error', () => {
        setTimeout(check, 500)
      })

      req.end()
    }

    // Give the process a moment to start before first check
    setTimeout(check, 1000)
  })
}

function findPackageManager(cwd: string): { command: string; args: string[] } {
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    return { command: 'npm', args: ['run', 'dev'] }
  }
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return { command: 'pnpm', args: ['run', 'dev'] }
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return { command: 'yarn', args: ['dev'] }
  }
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) {
    return { command: 'bun', args: ['run', 'dev'] }
  }
  return { command: 'npm', args: ['run', 'dev'] }
}

function isValidMastraProject(cwd: string): boolean {
  const pkgPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(pkgPath)) return false

  try {
    const raw = fs.readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    const devScript = pkg.scripts?.dev
    if (!devScript || typeof devScript !== 'string') return false
    return /\bmastra\s+dev\b/.test(devScript)
  } catch {
    return false
  }
}

async function resolveBackendDefaultModelId(): Promise<string | null> {
  const envModel = process.env.OPENAI_COMPATIBLE_MODEL?.trim()
  if (envModel) {
    return envModel
  }

  const authServerUrl = process.env.AUTH_SERVER_URL?.trim() || 'https://api.loccle.com'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetch(`${authServerUrl}/api/catalog/models`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[Mastra Manager] Failed to fetch model catalog: HTTP ${response.status}`)
      return null
    }

    const body = await response.json() as { data?: Array<{ publicModelId?: unknown }> }
    const firstModelId = body.data?.find((model) => typeof model.publicModelId === 'string' && model.publicModelId.trim())
      ?.publicModelId

    return typeof firstModelId === 'string' ? firstModelId : null
  } catch (err) {
    console.error('[Mastra Manager] Failed to fetch model catalog:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function findMastraProjectRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = startDir

  while (true) {
    if (isValidMastraProject(dir)) {
      return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      return null
    }

    dir = parent
  }
}

export async function startMastra(workspaceRoot: string): Promise<StartMastraResult> {
  if (mastraProcess) {
    return { port: mastraPort, modelId: mastraModelId }
  }

  const mastraProjectRoot = findMastraProjectRoot()
  if (!mastraProjectRoot) {
    throw new Error(
      'Loccle Mastra app could not be found. The desktop app must be launched from a project with a "dev" script that runs "mastra dev".',
    )
  }

  mastraPort = await getAvailablePort()
  mastraModelId = await resolveBackendDefaultModelId()
  console.log(
    `[Mastra Manager] Starting server on port ${mastraPort}, app: ${mastraProjectRoot}, workspace: ${workspaceRoot}, model: ${mastraModelId ?? '(default)'}`,
  )

  const { command, args } = findPackageManager(mastraProjectRoot)

  mastraProcess = spawn(command, args, {
    cwd: mastraProjectRoot,
    env: {
      ...process.env,
      DESKTOP_MODE: 'true',
      VIBE_CODING_WORKSPACE_PATH: workspaceRoot,
      ...(mastraModelId ? { OPENAI_COMPATIBLE_MODEL: mastraModelId } : {}),
      PORT: String(mastraPort),
      MASTRA_PORT: String(mastraPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  mastraProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[Mastra] ${data.toString().trim()}`)
  })

  mastraProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[Mastra:err] ${data.toString().trim()}`)
  })

  mastraProcess.on('exit', (code) => {
    console.log(`[Mastra Manager] Mastra process exited with code ${code}`)
    mastraProcess = null
  })

  mastraProcess.on('error', (err) => {
    console.error('[Mastra Manager] Mastra process error:', err)
    mastraProcess = null
  })

  await waitForServer(mastraPort)
  return { port: mastraPort, modelId: mastraModelId }
}

export async function stopMastra(): Promise<void> {
  if (!mastraProcess) return

  console.log('[Mastra Manager] Stopping Mastra server...')

  return new Promise((resolve) => {
    if (!mastraProcess) {
      resolve()
      return
    }

    mastraProcess.on('exit', () => {
      mastraProcess = null
      mastraModelId = null
      resolve()
    })

    // Graceful shutdown
    if (process.platform === 'win32') {
      mastraProcess.kill()
    } else {
      mastraProcess.kill('SIGTERM')
    }

    // Force kill after 5 seconds
    setTimeout(() => {
      if (mastraProcess) {
        mastraProcess.kill('SIGKILL')
        mastraProcess = null
        mastraModelId = null
      }
      resolve()
    }, 5000)
  })
}
