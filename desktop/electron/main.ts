import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { MastraClient } from '@mastra/client-js'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startMastra, stopMastra } from './mastra-manager'
import { cancelAgentStream, respondAgentApproval, startAgentStream } from './agent-runner'
import { clearSession, storeSession } from '../../src/tui/auth/storage'
import { refreshAgent, setModelIdAndRefresh } from '../../src/mastra/agents/openai-compatible-agent'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let mastraPort: number | null = null
let currentProjectRoot: string | null = null
let mastraClient: MastraClient | null = null

const isDev = !app.isPackaged

function getMastraClient() {
  if (!mastraPort) {
    throw new Error('Mastra server is not running')
  }
  if (!mastraClient) {
    mastraClient = new MastraClient({
      baseUrl: `http://localhost:${mastraPort}`,
    })
  }
  return mastraClient
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Loccle Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    await mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC: Start Mastra server for a given workspace path
ipcMain.handle('mastra:start', async (_event, workspacePath: string) => {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return { ok: false, error: `Path does not exist: ${workspacePath}` }
  }

  try {
    currentProjectRoot = workspacePath
    const result = await startMastra(workspacePath)
    mastraPort = result.port
    mastraClient = null
    if (result.modelId) {
      setModelIdAndRefresh(result.modelId)
    } else {
      refreshAgent()
    }
    console.log(`[Desktop] Mastra server ready on port ${mastraPort}, workspace: ${workspacePath}`)
    return { ok: true, url: `http://localhost:${mastraPort}`, modelId: result.modelId }
  } catch (err: any) {
    console.error('[Desktop] Failed to start Mastra:', err)
    return { ok: false, error: err.message || String(err) }
  }
})

// IPC: Stop Mastra server
ipcMain.handle('mastra:stop', async () => {
  await stopMastra()
  mastraPort = null
  mastraClient = null
  currentProjectRoot = null
  return { ok: true }
})

// IPC: Open folder picker dialog
ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Workspace Folder',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// IPC: Get Mastra status
ipcMain.handle('mastra:status', () => {
  return {
    running: mastraPort !== null,
    url: mastraPort ? `http://localhost:${mastraPort}` : null,
    workspaceRoot: currentProjectRoot,
  }
})

ipcMain.handle('auth:setSession', async (_event, session: { token?: string }) => {
  if (!session?.token) {
    return { ok: false, error: 'Missing token' }
  }
  storeSession({ token: session.token })
  refreshAgent()
  return { ok: true }
})

ipcMain.handle('auth:clearSession', async () => {
  clearSession()
  refreshAgent()
  return { ok: true }
})

ipcMain.handle('agent:stream:start', async (event, payload) => {
  startAgentStream(payload, event.sender)
  return { ok: true }
})

ipcMain.handle('agent:approval:respond', async (_event, payload) => {
  return respondAgentApproval(payload)
})

ipcMain.handle('agent:stream:cancel', async (_event, sessionId: string) => {
  return cancelAgentStream(sessionId)
})

ipcMain.handle('memory:listThreads', async (_event, params) => {
  return getMastraClient().listMemoryThreads(params)
})

ipcMain.handle('memory:createThread', async (_event, params) => {
  return getMastraClient().createMemoryThread(params)
})

ipcMain.handle('memory:deleteThread', async (_event, threadId: string, opts) => {
  await getMastraClient().deleteThread(threadId, opts)
  return { ok: true }
})

ipcMain.handle('memory:listThreadMessages', async (_event, threadId: string, opts) => {
  return getMastraClient().listThreadMessages(threadId, opts)
})

// IPC: Open external URL in default browser
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, error: 'Invalid URL' }
  }
  await shell.openExternal(url)
  return { ok: true }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', async () => {
  await stopMastra()
  app.quit()
})

app.on('before-quit', async () => {
  await stopMastra()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
