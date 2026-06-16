import { app, ipcMain, shell, BrowserWindow, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
let mastraProcess = null;
let mastraPort$1 = 0;
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
async function startMastra(projectRoot) {
  var _a, _b;
  if (mastraProcess) {
    return mastraPort$1;
  }
  mastraPort$1 = await getAvailablePort();
  console.log(`[Mastra Manager] Starting server on port ${mastraPort$1}, project: ${projectRoot}`);
  const { command, args } = findPackageManager(projectRoot);
  mastraProcess = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      DESKTOP_MODE: "true",
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
  return mastraPort$1;
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
    mastraPort = await startMastra(workspacePath);
    console.log(`[Desktop] Mastra server ready on port ${mastraPort}, workspace: ${workspacePath}`);
    return { ok: true, url: `http://localhost:${mastraPort}` };
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
