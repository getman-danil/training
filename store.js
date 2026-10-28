// Хранилище: всё сразу пишется в localStorage телефона, а затем отправляется в репозиторий
// как JSON-файлы в ветку `data` (data/log/<дата>.json, data/meta.json) через GitHub API.
// Без интернета и без токена приложение работает полностью — просто копится очередь на отправку.

const KEY = "ashgob.v1";
const DEFAULT_CFG = { owner: "getman-danil", repo: "training", branch: "data", token: "" };

export const S = load();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  s = s || {};
  return { logs: s.logs || {}, meta: s.meta || { freezes: [] }, sha: s.sha || {}, dirty: s.dirty || {}, cfg: { ...DEFAULT_CFG, ...(s.cfg || {}) }, lastSync: s.lastSync || 0 };
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

const logPath = d => `data/log/${d}.json`;
const META = "data/meta.json";

export function touchLog(L) { L.updatedAt = Date.now(); S.logs[L.date] = L; S.dirty[logPath(L.date)] = true; save(); scheduleSync(); }
export function touchMeta() { S.meta.updatedAt = Date.now(); S.dirty[META] = true; save(); scheduleSync(); }
export const dirtyCount = () => Object.keys(S.dirty).length;

// ---------- GitHub ----------
const listeners = new Set();
export const sync = { state: "idle", msg: "" };
export function onSync(f) { listeners.add(f); }
function setSync(state, msg = "") { sync.state = state; sync.msg = msg; listeners.forEach(f => f(sync)); }

function api(path, opt = {}) {
  const { owner, repo, token } = S.cfg;
  return fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    cache: "no-store", ...opt,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opt.headers || {}) },
  });
}
const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const unb64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), c => c.charCodeAt(0)));

async function getFile(path) {
  const r = await api(`contents/${path}?ref=${S.cfg.branch}`);
  if (r.status === 404) return null;
  if (!r.ok) throw httpErr(r);
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(unb64(j.content)) };
}
async function putFile(path, data, sha, message) {
  const body = { message, content: b64(JSON.stringify(data, null, 2) + "\n"), branch: S.cfg.branch };
  if (sha) body.sha = sha;
  const r = await api(`contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw httpErr(r);
  return { sha: (await r.json()).content.sha };
}
function httpErr(r) {
  const e = new Error(r.status === 401 ? "Токен не подходит" : r.status === 403 ? "Нет прав или лимит GitHub" : r.status === 404 ? "Репозиторий или ветка не найдены" : "GitHub ответил " + r.status);
  e.status = r.status; return e;
}

// Сверяем с сервером: забираем изменённые файлы, отправляем свои. При споре выигрывает более свежая правка.
let running = null;
export function runSync() { return running ||= doSync().finally(() => { running = null; }); }
async function doSync() {
  if (!S.cfg.token) { setSync("off", "Нет токена — записи хранятся только на телефоне"); return; }
  if (!navigator.onLine) { setSync("offline", "Нет сети — отправлю позже"); return; }
  setSync("busy", "Синхронизация…");
  try {
    // 1. Что лежит на сервере
    const r = await api(`contents/data/log?ref=${S.cfg.branch}`);
    const remote = r.status === 404 ? [] : r.ok ? await r.json() : (() => { throw httpErr(r); })();
    for (const f of remote) {
      if (!f.name.endsWith(".json") || S.sha[f.path] === f.sha) continue;
      const got = await getFile(f.path); if (!got) continue;
      const date = f.name.slice(0, -5), local = S.logs[date];
      if (!S.dirty[f.path] || !local || (got.data.updatedAt || 0) > (local.updatedAt || 0)) { S.logs[date] = got.data; delete S.dirty[f.path]; }
      S.sha[f.path] = got.sha;
    }
    const m = await getFile(META);
    if (m) {
      if (m.sha !== S.sha[META] && (!S.dirty[META] || (m.data.updatedAt || 0) > (S.meta.updatedAt || 0))) { S.meta = m.data; delete S.dirty[META]; }
      S.sha[META] = m.sha;
    }
    save();
    // 2. Отправляем своё
    let sent = 0;
    for (const path of Object.keys(S.dirty)) {
      const data = path === META ? S.meta : S.logs[path.slice(9, -5)];
      if (!data) { delete S.dirty[path]; continue; }
      const msg = path === META ? "Настройки похода" : `Тренировка ${data.date}${data.title ? " · " + data.title : ""}`;
      let res = await putFile(path, data, S.sha[path], msg);
      if (res.conflict) { const cur = await getFile(path); res = await putFile(path, data, cur?.sha, msg); }
      if (res.conflict) throw new Error("Конфликт версий, попробую ещё раз позже");
      S.sha[path] = res.sha; delete S.dirty[path]; sent++; save();
    }
    S.lastSync = Date.now(); save();
    setSync("ok", sent ? `Отправлено: ${sent}` : "Всё сохранено в GitHub");
    return true;
  } catch (e) {
    setSync("error", e.message || "Ошибка синхронизации");
  }
}

let timer = null;
export function scheduleSync(ms = 4000) {
  clearTimeout(timer);
  if (!S.cfg.token) { setSync("off", "Нет токена — записи хранятся только на телефоне"); return; }
  setSync(dirtyCount() ? "dirty" : "ok", dirtyCount() ? `Не отправлено: ${dirtyCount()}` : "");
  timer = setTimeout(runSync, ms);
}
addEventListener("online", () => scheduleSync(500));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirtyCount()) runSync(); });

export function exportAll() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), logs: S.logs, meta: S.meta }, null, 2);
}
