import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'

let mastraProcess: ChildProcess | null = null
let mastraPort = 0

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

import fs from 'node:fs'

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

export async function startMastra(projectRoot: string): Promise<number> {
  if (mastraProcess) {
    return mastraPort
  }

  mastraPort = await getAvailablePort()
  console.log(`[Mastra Manager] Starting server on port ${mastraPort}, project: ${projectRoot}`)

  const { command, args } = findPackageManager(projectRoot)

  mastraProcess = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      DESKTOP_MODE: 'true',
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
  return mastraPort
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
      }
      resolve()
    }, 5000)
  })
}
