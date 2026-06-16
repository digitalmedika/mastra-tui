import { app, ipcMain, shell, BrowserWindow, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
let mastraProcess = null;
let mastraPort$1 = 0;
let mastraModelId = null;
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Failed to find available port"));
      }
    });
  });
}
function waitForServer(port, timeoutMs = 6e4) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Mastra server did not start within ${timeoutMs}ms`));
        return;
      }
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/health",
          method: "GET",
          timeout: 2e3
        },
        (res) => {
          if (res.statusCode === 200 || res.statusCode === 404) {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        }
      );
      req.on("error", () => {
        setTimeout(check, 500);
      });
      req.end();
    };
    setTimeout(check, 1e3);
  });
}
function findPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
    return { command: "npm", args: ["run", "dev"] };
  }
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return { command: "pnpm", args: ["run", "dev"] };
  }
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    return { command: "yarn", args: ["dev"] };
  }
  if (fs.existsSync(path.join(cwd, "bun.lockb")) || fs.existsSync(path.join(cwd, "bun.lock"))) {
    return { command: "bun", args: ["run", "dev"] };
  }
  return { command: "npm", args: ["run", "dev"] };
}
function isValidMastraProject(cwd) {
  var _a;
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const devScript = (_a = pkg.scripts) == null ? void 0 : _a.dev;
    if (!devScript || typeof devScript !== "string") return false;
    return /\bmastra\s+dev\b/.test(devScript);
  } catch {
    return false;
  }
}
async function resolveBackendDefaultModelId() {
  var _a, _b, _c, _d;
  const envModel = (_a = process.env.OPENAI_COMPATIBLE_MODEL) == null ? void 0 : _a.trim();
  if (envModel) {
    return envModel;
  }
  const authServerUrl = ((_b = process.env.AUTH_SERVER_URL) == null ? void 0 : _b.trim()) || "https://api.loccle.com";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  try {
    const response = await fetch(`${authServerUrl}/api/catalog/models`, {
      signal: controller.signal
    });
    if (!response.ok) {
      console.error(`[Mastra Manager] Failed to fetch model catalog: HTTP ${response.status}`);
      return null;
    }
    const body = await response.json();
    const firstModelId = (_d = (_c = body.data) == null ? void 0 : _c.find((model) => typeof model.publicModelId === "string" && model.publicModelId.trim())) == null ? void 0 : _d.publicModelId;
    return typeof firstModelId === "string" ? firstModelId : null;
  } catch (err) {
    console.error("[Mastra Manager] Failed to fetch model catalog:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
function findMastraProjectRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = startDir;
  while (true) {
    if (isValidMastraProject(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
async function startMastra(workspaceRoot) {
  var _a, _b;
  if (mastraProcess) {
    return { port: mastraPort$1, modelId: mastraModelId };
  }
  const mastraProjectRoot = findMastraProjectRoot();
  if (!mastraProjectRoot) {
    throw new Error(
      'Loccle Mastra app could not be found. The desktop app must be launched from a project with a "dev" script that runs "mastra dev".'
    );
  }
  mastraPort$1 = await getAvailablePort();
  mastraModelId = await resolveBackendDefaultModelId();
  console.log(
    `[Mastra Manager] Starting server on port ${mastraPort$1}, app: ${mastraProjectRoot}, workspace: ${workspaceRoot}, model: ${mastraModelId ?? "(default)"}`
  );
  const { command, args } = findPackageManager(mastraProjectRoot);
  mastraProcess = spawn(command, args, {
    cwd: mastraProjectRoot,
    env: {
      ...process.env,
      DESKTOP_MODE: "true",
      VIBE_CODING_WORKSPACE_PATH: workspaceRoot,
      ...mastraModelId ? { OPENAI_COMPATIBLE_MODEL: mastraModelId } : {},
      PORT: String(mastraPort$1),
      MASTRA_PORT: String(mastraPort$1)
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  (_a = mastraProcess.stdout) == null ? void 0 : _a.on("data", (data) => {
    console.log(`[Mastra] ${data.toString().trim()}`);
  });
  (_b = mastraProcess.stderr) == null ? void 0 : _b.on("data", (data) => {
    console.error(`[Mastra:err] ${data.toString().trim()}`);
  });
  mastraProcess.on("exit", (code) => {
    console.log(`[Mastra Manager] Mastra process exited with code ${code}`);
    mastraProcess = null;
  });
  mastraProcess.on("error", (err) => {
    console.error("[Mastra Manager] Mastra process error:", err);
    mastraProcess = null;
  });
  await waitForServer(mastraPort$1);
  return { port: mastraPort$1, modelId: mastraModelId };
}
async function stopMastra() {
  if (!mastraProcess) return;
  console.log("[Mastra Manager] Stopping Mastra server...");
  return new Promise((resolve) => {
    if (!mastraProcess) {
      resolve();
      return;
    }
    mastraProcess.on("exit", () => {
      mastraProcess = null;
      mastraModelId = null;
      resolve();
    });
    if (process.platform === "win32") {
      mastraProcess.kill();
    } else {
      mastraProcess.kill("SIGTERM");
    }
    setTimeout(() => {
      if (mastraProcess) {
        mastraProcess.kill("SIGKILL");
        mastraProcess = null;
        mastraModelId = null;
      }
      resolve();
    }, 5e3);
  });
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
let mainWindow = null;
let mastraPort = null;
let currentProjectRoot = null;
const isDev = !app.isPackaged;
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Loccle Desktop",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname$1, "..", "dist", "index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
ipcMain.handle("mastra:start", async (_event, workspacePath) => {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return { ok: false, error: `Path does not exist: ${workspacePath}` };
  }
  if (mastraPort !== null) {
    await stopMastra();
    mastraPort = null;
    currentProjectRoot = null;
  }
  try {
    currentProjectRoot = workspacePath;
    const result = await startMastra(workspacePath);
    mastraPort = result.port;
    console.log(`[Desktop] Mastra server ready on port ${mastraPort}, workspace: ${workspacePath}`);
    return { ok: true, url: `http://localhost:${mastraPort}`, modelId: result.modelId };
  } catch (err) {
    console.error("[Desktop] Failed to start Mastra:", err);
    return { ok: false, error: err.message || String(err) };
  }
});
ipcMain.handle("mastra:stop", async () => {
  await stopMastra();
  mastraPort = null;
  currentProjectRoot = null;
  return { ok: true };
});
ipcMain.handle("dialog:openFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Workspace Folder"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("mastra:status", () => {
  return {
    running: mastraPort !== null,
    url: mastraPort ? `http://localhost:${mastraPort}` : null,
    workspaceRoot: currentProjectRoot
  };
});
ipcMain.handle("shell:openExternal", async (_event, url) => {
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, error: "Invalid URL" };
  }
  await shell.openExternal(url);
  return { ok: true };
});
app.whenReady().then(createWindow);
app.on("window-all-closed", async () => {
  await stopMastra();
  app.quit();
});
app.on("before-quit", async () => {
  await stopMastra();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
