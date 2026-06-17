import { app as f, ipcMain as w, shell as _, BrowserWindow as P, dialog as j } from "electron";
import l from "node:path";
import u from "node:fs";
import { fileURLToPath as T } from "node:url";
import { spawn as I } from "node:child_process";
import E from "node:http";
let o = null, p = 0, c = null;
function R() {
  return new Promise((t, e) => {
    const r = E.createServer();
    r.listen(0, "127.0.0.1", () => {
      const s = r.address();
      if (s && typeof s == "object") {
        const i = s.port;
        r.close(() => t(i));
      } else
        e(new Error("Failed to find available port"));
    });
  });
}
function $(t, e = 6e4) {
  const r = Date.now();
  return new Promise((s, i) => {
    const n = () => {
      if (Date.now() - r > e) {
        i(new Error(`Mastra server did not start within ${e}ms`));
        return;
      }
      const a = E.request(
        {
          hostname: "127.0.0.1",
          port: t,
          path: "/api/health",
          method: "GET",
          timeout: 2e3
        },
        (g) => {
          g.statusCode === 200 || g.statusCode === 404 ? s() : setTimeout(n, 500);
        }
      );
      a.on("error", () => {
        setTimeout(n, 500);
      }), a.end();
    };
    setTimeout(n, 1e3);
  });
}
function D(t) {
  return u.existsSync(l.join(t, "package-lock.json")) ? { command: "npm", args: ["run", "dev"] } : u.existsSync(l.join(t, "pnpm-lock.yaml")) ? { command: "pnpm", args: ["run", "dev"] } : u.existsSync(l.join(t, "yarn.lock")) ? { command: "yarn", args: ["dev"] } : u.existsSync(l.join(t, "bun.lockb")) || u.existsSync(l.join(t, "bun.lock")) ? { command: "bun", args: ["run", "dev"] } : { command: "npm", args: ["run", "dev"] };
}
function x(t) {
  var r;
  const e = l.join(t, "package.json");
  if (!u.existsSync(e)) return !1;
  try {
    const s = u.readFileSync(e, "utf8"), n = (r = JSON.parse(s).scripts) == null ? void 0 : r.dev;
    return !n || typeof n != "string" ? !1 : /\bmastra\s+dev\b/.test(n);
  } catch {
    return !1;
  }
}
async function O() {
  var i, n, a, g;
  const t = (i = process.env.OPENAI_COMPATIBLE_MODEL) == null ? void 0 : i.trim();
  if (t)
    return t;
  const e = ((n = process.env.AUTH_SERVER_URL) == null ? void 0 : n.trim()) || "https://api.loccle.com", r = new AbortController(), s = setTimeout(() => r.abort(), 5e3);
  try {
    const h = await fetch(`${e}/api/catalog/models`, {
      signal: r.signal
    });
    if (!h.ok)
      return console.error(`[Mastra Manager] Failed to fetch model catalog: HTTP ${h.status}`), null;
    const v = (g = (a = (await h.json()).data) == null ? void 0 : a.find((S) => typeof S.publicModelId == "string" && S.publicModelId.trim())) == null ? void 0 : g.publicModelId;
    return typeof v == "string" ? v : null;
  } catch (h) {
    return console.error("[Mastra Manager] Failed to fetch model catalog:", h), null;
  } finally {
    clearTimeout(s);
  }
}
function L(t = l.dirname(T(import.meta.url))) {
  let e = t;
  for (; ; ) {
    if (x(e))
      return e;
    const r = l.dirname(e);
    if (r === e)
      return null;
    e = r;
  }
}
async function A(t) {
  var i, n;
  if (o)
    return { port: p, modelId: c };
  const e = L();
  if (!e)
    throw new Error(
      'Loccle Mastra app could not be found. The desktop app must be launched from a project with a "dev" script that runs "mastra dev".'
    );
  p = await R(), c = await O(), console.log(
    `[Mastra Manager] Starting server on port ${p}, app: ${e}, workspace: ${t}, model: ${c ?? "(default)"}`
  );
  const { command: r, args: s } = D(e);
  return o = I(r, s, {
    cwd: e,
    env: {
      ...process.env,
      DESKTOP_MODE: "true",
      VIBE_CODING_WORKSPACE_PATH: t,
      ...c ? { OPENAI_COMPATIBLE_MODEL: c } : {},
      PORT: String(p),
      MASTRA_PORT: String(p)
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  }), (i = o.stdout) == null || i.on("data", (a) => {
    console.log(`[Mastra] ${a.toString().trim()}`);
  }), (n = o.stderr) == null || n.on("data", (a) => {
    console.error(`[Mastra:err] ${a.toString().trim()}`);
  }), o.on("exit", (a) => {
    console.log(`[Mastra Manager] Mastra process exited with code ${a}`), o = null;
  }), o.on("error", (a) => {
    console.error("[Mastra Manager] Mastra process error:", a), o = null;
  }), await $(p), { port: p, modelId: c };
}
async function M() {
  if (o)
    return console.log("[Mastra Manager] Stopping Mastra server..."), new Promise((t) => {
      if (!o) {
        t();
        return;
      }
      if (o.on("exit", () => {
        o = null, c = null, process.platform === "win32" ? setTimeout(t, 1e3) : t();
      }), process.platform === "win32") {
        const e = o.pid;
        e ? I("taskkill", ["/F", "/T", "/PID", String(e)], { stdio: "ignore" }) : o.kill();
      } else
        o.kill("SIGTERM");
      setTimeout(() => {
        o && (o.kill("SIGKILL"), o = null, c = null), t();
      }, 5e3);
    });
}
const F = T(import.meta.url), k = l.dirname(F);
let d = null, m = null, y = null;
const C = !f.isPackaged;
async function b() {
  if (d = new P({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Loccle Desktop",
    webPreferences: {
      preload: l.join(k, "preload.js"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  }), C) {
    const t = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    await d.loadURL(t), d.webContents.openDevTools();
  } else
    await d.loadFile(l.join(k, "..", "dist", "index.html"));
  d.on("closed", () => {
    d = null;
  });
}
w.handle("mastra:start", async (t, e) => {
  if (!e || !u.existsSync(e))
    return { ok: !1, error: `Path does not exist: ${e}` };
  try {
    y = e;
    const r = await A(e);
    return m = r.port, console.log(`[Desktop] Mastra server ready on port ${m}, workspace: ${e}`), { ok: !0, url: `http://localhost:${m}`, modelId: r.modelId };
  } catch (r) {
    return console.error("[Desktop] Failed to start Mastra:", r), { ok: !1, error: r.message || String(r) };
  }
});
w.handle("mastra:stop", async () => (await M(), m = null, y = null, { ok: !0 }));
w.handle("dialog:openFolder", async () => {
  if (!d) return null;
  const t = await j.showOpenDialog(d, {
    properties: ["openDirectory"],
    title: "Select Workspace Folder"
  });
  return t.canceled || t.filePaths.length === 0 ? null : t.filePaths[0];
});
w.handle("mastra:status", () => ({
  running: m !== null,
  url: m ? `http://localhost:${m}` : null,
  workspaceRoot: y
}));
w.handle("shell:openExternal", async (t, e) => !e || !/^https?:\/\//.test(e) ? { ok: !1, error: "Invalid URL" } : (await _.openExternal(e), { ok: !0 }));
f.whenReady().then(b);
f.on("window-all-closed", async () => {
  await M(), f.quit();
});
f.on("before-quit", async () => {
  await M();
});
f.on("activate", () => {
  P.getAllWindows().length === 0 && b();
});
