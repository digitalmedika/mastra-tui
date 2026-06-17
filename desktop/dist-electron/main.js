import { app as f, ipcMain as w, shell as _, BrowserWindow as P, dialog as j } from "electron";
import l from "node:path";
import p from "node:fs";
import { fileURLToPath as T } from "node:url";
import { spawn as I } from "node:child_process";
import E from "node:http";
let n = null, m = 0, u = null;
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
    const o = () => {
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
          g.statusCode === 200 || g.statusCode === 404 ? s() : setTimeout(o, 500);
        }
      );
      a.on("error", () => {
        setTimeout(o, 500);
      }), a.end();
    };
    setTimeout(o, 1e3);
  });
}
function D(t) {
  return p.existsSync(l.join(t, "package-lock.json")) ? { command: "npm", args: ["run", "dev"] } : p.existsSync(l.join(t, "pnpm-lock.yaml")) ? { command: "pnpm", args: ["run", "dev"] } : p.existsSync(l.join(t, "yarn.lock")) ? { command: "yarn", args: ["dev"] } : p.existsSync(l.join(t, "bun.lockb")) || p.existsSync(l.join(t, "bun.lock")) ? { command: "bun", args: ["run", "dev"] } : { command: "npm", args: ["run", "dev"] };
}
function x(t) {
  var r;
  const e = l.join(t, "package.json");
  if (!p.existsSync(e)) return !1;
  try {
    const s = p.readFileSync(e, "utf8"), o = (r = JSON.parse(s).scripts) == null ? void 0 : r.dev;
    return !o || typeof o != "string" ? !1 : /\bmastra\s+dev\b/.test(o);
  } catch {
    return !1;
  }
}
async function O() {
  var i, o, a, g;
  const t = (i = process.env.OPENAI_COMPATIBLE_MODEL) == null ? void 0 : i.trim();
  if (t)
    return t;
  const e = ((o = process.env.AUTH_SERVER_URL) == null ? void 0 : o.trim()) || "https://api.loccle.com", r = new AbortController(), s = setTimeout(() => r.abort(), 5e3);
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
  var i, o;
  if (n)
    return { port: m, modelId: u };
  const e = L();
  if (!e)
    throw new Error(
      'Loccle Mastra app could not be found. The desktop app must be launched from a project with a "dev" script that runs "mastra dev".'
    );
  m = await R(), u = await O(), console.log(
    `[Mastra Manager] Starting server on port ${m}, app: ${e}, workspace: ${t}, model: ${u ?? "(default)"}`
  );
  const { command: r, args: s } = D(e);
  return n = I(r, s, {
    cwd: e,
    env: {
      ...process.env,
      DESKTOP_MODE: "true",
      VIBE_CODING_WORKSPACE_PATH: t,
      ...u ? { OPENAI_COMPATIBLE_MODEL: u } : {},
      PORT: String(m),
      MASTRA_PORT: String(m)
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  }), (i = n.stdout) == null || i.on("data", (a) => {
    console.log(`[Mastra] ${a.toString().trim()}`);
  }), (o = n.stderr) == null || o.on("data", (a) => {
    console.error(`[Mastra:err] ${a.toString().trim()}`);
  }), n.on("exit", (a) => {
    console.log(`[Mastra Manager] Mastra process exited with code ${a}`), n = null;
  }), n.on("error", (a) => {
    console.error("[Mastra Manager] Mastra process error:", a), n = null;
  }), await $(m), { port: m, modelId: u };
}
async function y() {
  if (n)
    return console.log("[Mastra Manager] Stopping Mastra server..."), new Promise((t) => {
      if (!n) {
        t();
        return;
      }
      if (n.on("exit", () => {
        n = null, u = null, process.platform === "win32" ? setTimeout(t, 1e3) : t();
      }), process.platform === "win32") {
        const e = n.pid;
        e ? I("taskkill", ["/F", "/T", "/PID", String(e)], { stdio: "ignore" }) : n.kill();
      } else
        n.kill("SIGTERM");
      setTimeout(() => {
        n && (n.kill("SIGKILL"), n = null, u = null), t();
      }, 5e3);
    });
}
const F = T(import.meta.url), k = l.dirname(F);
let d = null, c = null, M = null;
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
  if (!e || !p.existsSync(e))
    return { ok: !1, error: `Path does not exist: ${e}` };
  c !== null && (await y(), c = null, M = null);
  try {
    M = e;
    const r = await A(e);
    return c = r.port, console.log(`[Desktop] Mastra server ready on port ${c}, workspace: ${e}`), { ok: !0, url: `http://localhost:${c}`, modelId: r.modelId };
  } catch (r) {
    return console.error("[Desktop] Failed to start Mastra:", r), { ok: !1, error: r.message || String(r) };
  }
});
w.handle("mastra:stop", async () => (await y(), c = null, M = null, { ok: !0 }));
w.handle("dialog:openFolder", async () => {
  if (!d) return null;
  const t = await j.showOpenDialog(d, {
    properties: ["openDirectory"],
    title: "Select Workspace Folder"
  });
  return t.canceled || t.filePaths.length === 0 ? null : t.filePaths[0];
});
w.handle("mastra:status", () => ({
  running: c !== null,
  url: c ? `http://localhost:${c}` : null,
  workspaceRoot: M
}));
w.handle("shell:openExternal", async (t, e) => !e || !/^https?:\/\//.test(e) ? { ok: !1, error: "Invalid URL" } : (await _.openExternal(e), { ok: !0 }));
f.whenReady().then(b);
f.on("window-all-closed", async () => {
  await y(), f.quit();
});
f.on("before-quit", async () => {
  await y();
});
f.on("activate", () => {
  P.getAllWindows().length === 0 && b();
});
