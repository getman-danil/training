// Интерфейс: Бой (тренировка дня с монстром), Поход (недели и подземелья), Прогресс (анализ), Герой, Настройки.
import * as G from "./game.js";
import { S, save, touchLog, touchMeta, runSync, scheduleSync, onSync, sync, dirtyCount, exportAll } from "./store.js";
import { exerciseSeries, weekly, hints } from "./analysis.js";

const $ = s => document.querySelector(s);
const main = $("#main");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmt = iso => iso.slice(8, 10) + "." + iso.slice(5, 7);
const DOW = { "Понедельник": "пн", "Вторник": "вт", "Среда": "ср", "Четверг": "чт", "Пятница": "пт", "Суббота": "сб", "Воскресенье": "вс" };
// День, в который тренировка была на самом деле, может отличаться от плана; запись хранится под датой плана (performedOn — фактический).

let SUM = null;
function recompute() { G.applyShifts(S.meta.shifts || []); SUM = G.summarize(S.logs, S.meta, todayISO()); return SUM; }

// ---------- журнал дня ----------
function getLog(day, create) {
  let L = S.logs[day.date];
  if (!L && create) {
    L = {
      date: day.date, week: day.week, block: day.block, title: day.title, performedOn: null, finished: false, finishedAt: null, dayNote: "",
      items: day.items.map(it => it.type === "ex"
        ? { type: "ex", name: it.name, plan: it.plan, planWeight: it.weight || "", weight: it.weight || "", reps: [], note: "" }
        : { type: "note", text: it.text, done: false }),
    };
    S.logs[day.date] = L;
  }
  return L;
}
function commit(day, L) {
  const b = G.battle(day, L), m = G.monsterFor(day);
  L.game = m ? { monster: m.name, hp: b.hp, dealt: b.dealt, overkill: b.over, killed: b.killed } : { patrol: true };
  // Перенос из тетради: прошедший день по умолчанию считается сделанным в свою дату.
  if (!L.performedOn && (b.setsDone || L.items.some(x => x.done))) L.performedOn = day.on < todayISO() ? day.on : todayISO();
  const before = SUM?.level;
  touchLog(L);
  recompute(); renderTop();
  if (before && SUM.level > before) toast(`Новый уровень: ${SUM.level} · ${SUM.title}`);
}

// ---------- верхняя панель ----------
function renderTop() {
  $("#lvl").textContent = SUM.level;
  $("#xpTxt").textContent = `${SUM.title} · ${SUM.into} / ${SUM.need}`;
  $("#xpBar").style.width = (SUM.into / SUM.need * 100).toFixed(1) + "%";
}
function renderSync() {
  const b = $("#syncBtn");
  b.dataset.s = sync.state;
  b.title = sync.msg || (dirtyCount() ? `Не отправлено: ${dirtyCount()}` : "");
  b.setAttribute("aria-label", "Синхронизация: " + (b.title || "нет данных"));
}
onSync(() => { renderSync(); if (route().tab === "settings") renderSettingsMsg(); if (sync.state === "ok" && route().tab !== "settings") { recompute(); renderTop(); } });
$("#syncBtn").onclick = () => { if (!S.cfg.token) location.hash = "#/settings"; else runSync().then(() => { recompute(); render(); }); };
$("#lvlBtn").onclick = () => { location.hash = "#/hero"; };

let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200); }

// ---------- маршруты ----------
function route() {
  const [, tab = "battle", arg] = location.hash.split("/");
  return { tab: tab || "battle", arg };
}
function defaultDate() {
  const t = todayISO();
  const byOn = [...G.DAYS].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const next = byOn.find(d => d.on >= t);
  return (next || byOn[byOn.length - 1]).date;
}
addEventListener("hashchange", () => { closeSheet(); render(); scrollTo(0, 0); });

function render() {
  const r = route();
  document.querySelectorAll(".tabs a").forEach(a => { if (a.dataset.tab === r.tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (r.tab === "journey") renderJourney();
  else if (r.tab === "progress") renderProgress();
  else if (r.tab === "hero") renderHero();
  else if (r.tab === "settings") renderSettings();
  else renderBattle(G.DAY_BY_DATE[r.arg] ? r.arg : defaultDate());
}

// =====================================================================
// БОЙ
// =====================================================================
let cur = null; // { day, L }

function dayState(d) {
  const L = S.logs[d.date]; if (!L) return "";
  if (L.skipped) return "skip";
  if (G.isCardio(d)) return L.finished ? "kill" : "";
  const b = G.battle(d, L);
  return b.killed ? "kill" : L.finished && b.dealt > 0 ? "fled" : "";
}

function renderBattle(date) {
  const day = G.DAY_BY_DATE[date], L = getLog(day, false) || null;
  cur = { day };
  const w = G.WEEKS.find(x => x.n === day.week), wi = G.WEEKS.indexOf(w);
  const t = todayISO();
  const days = w.days.map(d => `<button class="day ${d.on === t ? "today" : ""} ${dayState(d)}" data-go="${d.date}" aria-current="${d.date === date}">${DOW[G.dowOf(d.on)]}<small>${fmt(d.on)}</small></button>`).join("");
  const loc = `${G.locationFor(day).toUpperCase()} · НЕДЕЛЯ ${day.week}`;
  let html = `<div class="loc">${esc(loc)}</div>
  <div class="daynav"><button class="arr" data-wk="${wi - 1}" ${wi === 0 ? "disabled" : ""} aria-label="Прошлая неделя">‹</button><div class="days">${days}</div><button class="arr" data-wk="${wi + 1}" ${wi === G.WEEKS.length - 1 ? "disabled" : ""} aria-label="Следующая неделя">›</button></div>`;
  html += G.isCardio(day) ? cardioHTML(day, L) : stageHTML(day) + exercisesHTML(day);
  main.innerHTML = html;
  if (!G.isCardio(day)) updateStage(false);
}

function stageHTML(day) {
  const m = G.monsterFor(day);
  const cls = m.boss ? "boss" : m.tavern ? "tavern" : "";
  const art = m.tavern ? tavernSVG() : `<img src="${m.img}" alt="${esc(m.name)}">${m.placeholder ? '<div class="q">?</div>' : ""}`;
  const rv = G.REVENGE[day.date];
  const tag = m.boss ? "БОСС" : m.tavern ? "ТАВЕРНА" : rv ? "РЕВАНШ" : m.id === "goblin-chief" ? "ВОЖАК" : "";
  return `<div class="stage ${cls}" id="stage">
    <div class="fog"></div>
    <i class="ember" style="left:62%"></i><i class="ember" style="left:74%;animation-delay:1.7s"></i><i class="ember" style="left:55%;animation-delay:3.1s"></i>
    <div class="flash"></div><div class="dmg" id="dmg"></div>
    <div class="art ${m.placeholder && !m.tavern ? "shadow" : ""}" id="art">${art}</div>
    <div class="mname"><span>${esc(m.name)}</span><small>${tag}</small></div>
    <div class="hp"><div class="bar"><u id="hpU"></u><i id="hpI"></i></div><div class="nums"><span class="num" id="hpV"></span><span id="hpS">здоровье</span></div></div>
    <div id="bannerHost"></div>
  </div>`;
}

function tavernSVG() {
  // Пока нет портрета хозяина таверны: кружка эля у очага.
  return `<svg viewBox="0 0 200 200" aria-label="Кружка эля"><defs><radialGradient id="tg" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>
  <circle cx="100" cy="120" r="90" fill="url(#tg)"/><rect x="58" y="70" width="70" height="100" rx="6" fill="#4a3220" stroke="#c9a24a" stroke-width="3"/>
  <path d="M128 92 h18 a14 14 0 0 1 14 14 v26 a14 14 0 0 1 -14 14 h-18" fill="none" stroke="#c9a24a" stroke-width="6"/>
  <rect x="58" y="88" width="70" height="4" fill="#c9a24a"/><rect x="58" y="146" width="70" height="4" fill="#c9a24a"/>
  <path d="M54 72 q10 -22 26 -10 q10 -16 26 -4 q14 -10 26 6 v8 h-78z" fill="#efe8d6"/></svg>`;
}

function updateStage(animate, info) {
  const day = cur.day, L = S.logs[day.date], b = G.battle(day, L);
  const m = G.monsterFor(day);
  const pct = b.hp ? Math.max(0, b.left / b.hp * 100) : 0;
  $("#hpI").style.width = pct + "%";
  $("#hpU").style.width = pct + "%";
  $("#hpV").textContent = `${b.left} / ${b.hp}`;
  $("#hpS").textContent = b.over ? `перебор +${b.over}` : m.tavern ? "спарринг" : "здоровье";
  const art = $("#art");
  art.classList.toggle("dead", b.killed);
  art.classList.toggle("fled", !b.killed && (!!L?.skipped || (!!L?.finished && b.dealt > 0)));
  const host = $("#bannerHost");
  const back = Object.entries(G.REVENGE).find(([, r]) => r.from === day.date);
  if (b.killed) host.innerHTML = `<div class="banner">${m.tavern ? "СПАРРИНГ ВЫИГРАН" : m.boss ? "БОСС ПОВЕРЖЕН" : G.REVENGE[day.date] ? "РЕВАНШ ВЗЯТ" : "ВРАГ ПОВЕРЖЕН"}<small>+${SUM.perDay[day.date]?.xp || 0} опыта</small></div>`;
  else if (L?.skipped) host.innerHTML = `<div class="banner grey">МОНСТР УШЁЛ<small>тренировка пропущена · без штрафа</small></div>`;
  else if (L?.finished && b.dealt > 0) host.innerHTML = `<div class="banner red">МОНСТР СБЕЖАЛ<small>ранен на ${Math.round(b.pct * 100)}% · +${SUM.perDay[day.date]?.xp || 0} опыта${back ? `<br>вернётся ${fmt(G.DAY_BY_DATE[back[0]].on)} — добей его` : ""}</small></div>`;
  else host.innerHTML = "";
  if (animate && info && info.dmg > 0) {
    const d = $("#dmg"), st = $("#stage");
    d.textContent = info.crit ? `КРИТ ${Math.round(info.dmg)}` : Math.round(info.dmg);
    d.classList.toggle("crit", !!info.crit);
    [d, st].forEach(el => { const c = el === d ? "go" : "hit"; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); });
    if (navigator.vibrate) navigator.vibrate(info.crit ? [30, 40, 60] : 25);
  }
}

function exercisesHTML(day) {
  const L = S.logs[day.date];
  const b = G.battle(day, L);
  let h = `<div class="dayhead"><h1>${esc(day.title)}</h1><p>${dayWhen(day)}${weekNote(day)}</p></div><div id="exlist">`;
  day.items.forEach((it, i) => { h += it.type === "ex" ? exHTML(day, i, b) : noteHTML(day, i); });
  h += `</div><div class="finish">
    <textarea id="dayNote" placeholder="Заметка о тренировке: самочувствие, сон, что было тяжело">${esc(L?.dayNote || "")}</textarea>
    ${finishButtons(day, L, b.setsDone, "ЗАВЕРШИТЬ БОЙ", "ВЕРНУТЬСЯ В БОЙ")}
  </div>`;
  return h;
}
// Кнопки внизу дня: завершить, пропустить (если ещё ничего не записано), отменить пропуск, дата выполнения.
function finishButtons(day, L, started, finishTxt, reopenTxt) {
  return `<div id="finBtns" class="finish" style="margin:0">${finishInner(day, L, started, finishTxt, reopenTxt)}</div>`;
}
function refreshFinish() {
  const el = $("#finBtns"), day = cur.day, L = S.logs[day.date]; if (!el) return;
  el.outerHTML = G.isCardio(day) ? finishButtons(day, L, L?.items?.some(x => x.done), "ПАТРУЛЬ ПРОЙДЕН", "ПАТРУЛЬ ПРОЙДЕН ✦")
    : finishButtons(day, L, G.battle(day, L).setsDone, "ЗАВЕРШИТЬ БОЙ", "ВЕРНУТЬСЯ В БОЙ");
}
function finishInner(day, L, started, finishTxt, reopenTxt) {
  const date = L?.performedOn ? `<label class="hint" style="display:flex;gap:10px;align-items:center;justify-content:center">сделал
    <input type="date" id="performedOn" value="${esc(L.performedOn)}" style="width:auto;font-size:16px"></label>` : "";
  if (L?.skipped) return `<div class="hint">Тренировка пропущена: опыта за неё нет, других штрафов нет. Если из-за пропуска неделя не набрала нужное число боёв, её можно заморозить в «Походе», чтобы серия не прервалась.</div><button class="act" id="unskip">ОТМЕНИТЬ ПРОПУСК</button>`;
  if (L?.finished) return `<button class="act" id="reopen">${reopenTxt}</button>${date}<div class="hint">Записи можно править.</div>`;
  return `<button class="act gold" id="finish">${finishTxt}</button>${date}
    ${started ? `<div class="hint">Тап по клетке — подход по плану. Повторный тап — поправить число.</div>` : `<button class="act" id="skip">ПРОПУСТИЛ ТРЕНИРОВКУ</button>
    <details class="move"><summary class="act">ПЕРЕНЕСТИ НА ДРУГОЙ ДЕНЬ</summary>
      <label class="hint" style="display:flex;gap:10px;align-items:center;justify-content:center;margin-top:10px">на <input type="date" id="moveTo" value="${G.addDays(day.on, 1)}" style="width:auto;font-size:16px"></label>
      <button class="act" data-move="one">ТОЛЬКО ЭТУ ТРЕНИРОВКУ</button>
      <button class="act" data-move="all">СДВИНУТЬ ВЕСЬ ПЛАН</button>
      <div class="hint">«Весь план» двигает эту и все следующие тренировки, тесты и разгрузки на столько же дней. Отменить можно в «Походе».</div>
    </details>`}`;
}
function dayWhen(day) { return `${G.dowOf(day.on)}, ${fmt(day.on)}${day.on !== day.date ? ` (по плану ${fmt(day.date)})` : ""}`; }
function weekNote(day) { const w = G.WEEKS.find(x => x.n === day.week); return w.note ? ` · ${esc(w.note)}` : ""; }

function exHTML(day, i, b) {
  const it = day.items[i], L = S.logs[day.date], li = L?.items?.[i];
  const pp = G.parsePlan(it), reps = li?.reps || [];
  const prs = SUM.prs[day.date] || {};
  const n = Math.max(pp.sets, reps.length);
  let cells = "";
  for (let k = 0; k < n; k++) {
    const r = reps[k], has = r != null && r !== "" && +r > 0;
    const cls = ["set", has ? "d" : "", has && pp.target && +r < pp.target ? "lo" : "", prs[i + ":" + k] ? "pr" : "", k >= pp.sets ? "extra" : ""].join(" ");
    cells += `<button class="${cls}" data-set="${i}:${k}"><small>${k + 1}</small>${has ? r : pp.target ? `<span class="g">${pp.target}</span>` : '<span class="g">·</span>'}</button>`;
  }
  cells += `<button class="set add" data-add="${i}" aria-label="Добавить подход">+</button>`;
  const exb = b.exs.find(e => e.i === i);
  const done = exb && exb.dealt >= exb.hp - 0.5;
  const unit = pp.unit !== "повт" ? ` · ${pp.unit}` : "";
  return `<div class="ex ${done ? "done" : ""}" data-ex="${i}">
    <div class="h"><b>${esc(it.name)}</b><em>${esc(it.plan || "")}</em></div>
    <div class="spec">${esc([it.weight, it.rest].filter(Boolean).join(" · "))}${unit}</div>${it.hint ? `<div class="spec">${esc(it.hint)}</div>` : ""}
    <div class="sets">${cells}</div>
    <div class="fields"><input data-w="${i}" value="${esc(li ? li.weight : it.weight || "")}" placeholder="вес" aria-label="Вес"><input data-n="${i}" value="${esc(li?.note || "")}" placeholder="заметка" aria-label="Заметка к упражнению"></div>
  </div>`;
}
function noteHTML(day, i) {
  const it = day.items[i], on = !!S.logs[day.date]?.items?.[i]?.done;
  return `<button class="note-it ${on ? "on" : ""}" data-note="${i}"><span class="box">${on ? "✓" : ""}</span><span>${esc(it.text)}${it.hint ? `<br><small>${esc(it.hint)}</small>` : ""}</span></button>`;
}

// Пока нет картинки патруля: факел дозорного.
function patrolSVG() {
  return `<svg class="torch" viewBox="0 0 40 40" aria-hidden="true"><path d="M17 19h6l-2 18h-2z" fill="#4a3220" stroke="#c9a24a" stroke-width="1"/><rect x="15.5" y="17" width="9" height="3" fill="#c9a24a"/>
  <path d="M20 3c4 5 6 8 4.5 11.5c-.8 2-2.6 3-4.5 3s-3.7-1-4.5-3C14 10 16 8 20 3z" fill="#ff6a1a"/><path d="M20 8c2 3 3 5 2 7c-.5 1-1.2 1.5-2 1.5s-1.5-.5-2-1.5c-1-2 0-4 2-7z" fill="#ffd27a"/></svg>`;
}

function cardioHTML(day, L) {
  const items = day.items.map((it, i) => noteHTML(day, i)).join("");
  return `<div class="cardio">${patrolSVG()}<h2>ПАТРУЛЬ</h2><p>Монстров нет — разведка местности. +${G.XP_CARDIO} опыта.</p></div>
  <div class="dayhead"><h1>${esc(day.title)}</h1><p>${dayWhen(day)}${weekNote(day)}</p></div>
  ${items}
  <div class="finish"><textarea id="dayNote" placeholder="Заметка">${esc(L?.dayNote || "")}</textarea>
  ${finishButtons(day, L, L?.items?.some(x => x.done), "ПАТРУЛЬ ПРОЙДЕН", "ПАТРУЛЬ ПРОЙДЕН ✦")}</div>`;
}

function refreshEx(i) {
  const day = cur.day, b = G.battle(day, S.logs[day.date]);
  const el = main.querySelector(`[data-ex="${i}"]`);
  if (el) { const tmp = document.createElement("div"); tmp.innerHTML = exHTML(day, i, b); el.replaceWith(tmp.firstElementChild); }
}

// Записать подход и показать урон.
function setRep(i, k, val) {
  const day = cur.day, L = getLog(day, true), li = L.items[i];
  L.skipped = false;
  const before = G.battle(day, L);
  const prBefore = Object.keys(SUM.prs[day.date] || {}).length;
  if (val == null) { if (k === li.reps.length - 1 && k >= G.parsePlan(day.items[i]).sets) li.reps.pop(); else li.reps[k] = null; }
  else { while (li.reps.length < k) li.reps.push(null); li.reps[k] = val; }
  commit(day, L);
  const after = G.battle(day, L);
  const crit = !!(SUM.prs[day.date] || {})[i + ":" + k] && Object.keys(SUM.prs[day.date] || {}).length > prBefore;
  const dmg = (after.dealt + after.over) - (before.dealt + before.over);
  refreshEx(i); refreshFinish();
  updateStage(true, { dmg, crit });
  if (!before.killed && after.killed) { const m = G.monsterFor(day); toast(m.tavern ? "Спарринг выигран" : G.REVENGE[day.date] ? `Реванш взят: ${m.name} повержен! +${G.XP_REVENGE} опыта` : `${m.name} повержен!`); if (navigator.vibrate) navigator.vibrate([60, 60, 120]); }
  if (crit) toast("Критический удар: личный рекорд!");
}

main.addEventListener("click", e => {
  const go = e.target.closest("[data-go]"); if (go) { location.hash = "#/battle/" + go.dataset.go; return; }
  const wk = e.target.closest("[data-wk]"); if (wk) { const w = G.WEEKS[+wk.dataset.wk]; if (w) location.hash = "#/battle/" + w.days[0].date; return; }
  const s = e.target.closest("[data-set]");
  if (s) {
    const [i, k] = s.dataset.set.split(":").map(Number);
    const day = cur.day, it = day.items[i], pp = G.parsePlan(it);
    const r = S.logs[day.date]?.items?.[i]?.reps?.[k];
    if ((r == null || r === "") && pp.target) setRep(i, k, pp.target);
    else openSheet(i, k, s);
    return;
  }
  const a = e.target.closest("[data-add]");
  if (a) { const i = +a.dataset.add, reps = S.logs[cur.day.date]?.items?.[i]?.reps || []; openSheet(i, Math.max(reps.length, G.parsePlan(cur.day.items[i]).sets), a); return; }
  const n = e.target.closest("[data-note]");
  if (n) {
    const day = cur.day, L = getLog(day, true), i = +n.dataset.note;
    L.items[i].done = !L.items[i].done; L.skipped = false; commit(day, L);
    const tmp = document.createElement("div"); tmp.innerHTML = noteHTML(day, i); n.replaceWith(tmp.firstElementChild);
    refreshFinish();
    return;
  }
  if (e.target.closest("#finish")) {
    const day = cur.day, L = getLog(day, true);
    if (G.isCardio(day)) L.items.forEach(x => { if (x.type === "note") x.done = true; });
    L.finished = true; L.finishedAt = new Date().toISOString(); L.performedOn ||= todayISO();
    commit(day, L);
    const b = G.battle(day, L);
    if (!G.isCardio(day) && !b.killed && b.dealt === 0) toast("Ни одного подхода — монстр даже не заметил тебя");
    render(); scrollTo({ top: 0, behavior: "smooth" });
    runSync();
    return;
  }
  const mv = e.target.closest("[data-move]");
  if (mv) {
    const day = cur.day, to = $("#moveTo")?.value; if (!to) return;
    const n = G.daysBetween(day.on, to); if (!n) return;
    (S.meta.shifts ||= []).push({ at: day.date, days: n, scope: mv.dataset.move, madeAt: new Date().toISOString() });
    touchMeta(); recompute(); renderTop(); render();
    toast(mv.dataset.move === "all" ? `План сдвинут на ${n} дн.` : `Тренировка перенесена на ${fmt(to)}`);
    return;
  }
  if (e.target.closest("#skip")) { const day = cur.day, L = getLog(day, true); L.skipped = true; L.finished = false; commit(day, L); render(); runSync(); return; }
  if (e.target.closest("#unskip")) { const day = cur.day, L = getLog(day, true); L.skipped = false; commit(day, L); render(); return; }
  if (e.target.closest("#reopen")) { const day = cur.day, L = getLog(day, true); L.finished = false; commit(day, L); render(); return; }
});
main.addEventListener("change", e => {
  const t = e.target;
  if (t.matches("[data-w],[data-n]") && cur) {
    const day = cur.day, L = getLog(day, true), i = +(t.dataset.w ?? t.dataset.n);
    if (t.dataset.w != null) L.items[i].weight = t.value.trim(); else L.items[i].note = t.value.trim();
    commit(day, L);
    if (t.dataset.w != null) refreshEx(i);
  }
  if (t.id === "performedOn" && cur && t.value) { const L = getLog(cur.day, true); L.performedOn = t.value; commit(cur.day, L); }
  if (t.id === "dayNote" && cur) { const L = getLog(cur.day, true); L.dayNote = t.value; commit(cur.day, L); }
});

// ---------- лист ввода повторов ----------
const sheet = $("#sheet"), sv = $("#sheetVal");
let sheetAt = null;
function openSheet(i, k, el) {
  const day = cur.day, it = day.items[i], pp = G.parsePlan(it);
  const reps = S.logs[day.date]?.items?.[i]?.reps || [];
  const val = reps[k] ?? reps[k - 1] ?? pp.target ?? "";
  sheetAt = { i, k };
  $("#sheetTitle").textContent = `${it.name} · подход ${k + 1}${pp.target ? " · план " + pp.target : ""} ${pp.unit !== "повт" ? pp.unit : ""}`;
  sv.value = val; fresh = true; sheet.hidden = false;
  main.querySelectorAll(".set.sel").forEach(c => c.classList.remove("sel"));
  el?.classList.add("sel");

}
function closeSheet() { sheet.hidden = true; sheetAt = null; main.querySelectorAll(".set.sel").forEach(c => c.classList.remove("sel")); }
// Первая нажатая цифра заменяет подставленное значение, следующие дописываются.
let fresh = true;
function padKey(k) {
  let v = fresh ? "" : String(sv.value);
  fresh = false;
  if (k === "del") v = String(sv.value).slice(0, -1);
  else if (k === ",") v = (v || "0").includes(",") ? v : (v || "0") + ",";
  else v = (v === "0" ? "" : v) + k;
  sv.value = v.slice(0, 5);
}
// Тап мимо окна ввода (не по клетке подхода) закрывает его без сохранения.
document.addEventListener("pointerdown", e => { if (!sheet.hidden && !sheet.contains(e.target) && !e.target.closest("[data-set],[data-add]")) closeSheet(); }, true);
$("#pad").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) padKey(b.dataset.k); });
document.addEventListener("keydown", e => {
  if (sheet.hidden) return;
  if (/^[0-9]$/.test(e.key)) padKey(e.key);
  else if (e.key === "," || e.key === ".") padKey(",");
  else if (e.key === "Backspace") padKey("del");
  else if (e.key === "Enter") $("#sheetOk").click();
  else if (e.key === "Escape") closeSheet();
  else return;
  e.preventDefault();
});
const num = () => parseFloat(String(sv.value).replace(",", ".")) || 0;
$("#minus").onclick = () => { sv.value = String(Math.max(0, num() - 1)).replace(".", ","); fresh = false; };
$("#plus").onclick = () => { sv.value = String(num() + 1).replace(".", ","); fresh = false; };
$("#sheetClear").onclick = () => { if (sheetAt) { const { i, k } = sheetAt; closeSheet(); setRep(i, k, null); } };
$("#sheetOk").onclick = () => {
  if (!sheetAt) return;
  const { i, k } = sheetAt, v = parseFloat(String(sv.value).replace(",", "."));
  closeSheet(); setRep(i, k, v > 0 ? v : null);
};

// =====================================================================
// ПОХОД
// =====================================================================
function renderJourney() {
  const t = todayISO(), sk = SUM.streak, left = G.FREEZES - (S.meta.freezes || []).length;
  const bar = sk.weeks.map(w => `<i class="${w.status} ${w.tavern ? "tavern" : ""}" title="Неделя ${w.n}"></i>`).join("");
  let h = `<p class="lead">Поход</p><p class="sub">${G.WEEKS.length} недель · ${fmt(G.WEEKS[0].onFrom)} — ${fmt(G.WEEKS[G.WEEKS.length - 1].onTo)}.${G.WEEKS[G.WEEKS.length - 1].onTo.slice(0, 4)}</p>
  <div class="weeksbar" style="--n:${G.WEEKS.length}">${bar}</div>
  <div class="legend"><span style="--c:var(--gold)">выполнена</span><span style="--c:#3e5566">заморозка</span><span style="--c:#3a1410">пропуск</span><span style="--c:rgba(255,170,60,.7)">таверна</span></div>
  <div class="stats"><div><b>${sk.cur}</b><span>серия</span></div><div><b>${sk.best}</b><span>лучшая</span></div><div><b>${left}</b><span>заморозок</span></div></div>
  <p class="hint" style="text-align:left;margin-top:8px">Неделя засчитана, если все обязательные бои проведены. Таверна (разгрузка) серию не рвёт. Заморозка — на экзамен или болезнь.</p>`;
  const shifts = S.meta.shifts || [];
  if (shifts.length) h += `<h2 class="sec">ПЕРЕНОСЫ</h2><ul class="list">${shifts.map((x, k) => `<li><span>${esc(G.DAY_BY_DATE[x.at]?.title || x.at)} (${fmt(x.at)}) · ${x.days > 0 ? "+" : ""}${x.days} дн. ${x.scope === "all" ? "и весь план после" : "только она"}</span><span><button class="ghostbtn" data-unshift="${k}" style="border:1px solid var(--line2);padding:2px 8px;font-family:var(--caps);letter-spacing:.1em;font-size:13px">отменить</button></span></li>`).join("")}</ul>`;
  let lastBlock = null;
  for (const w of G.WEEKS) {
    const bn = +(/Блок (\d+)/.exec(w.block) || [0, 0])[1];
    if (bn !== lastBlock) { lastBlock = bn; h += `<h2 class="sec">${esc(w.block.toUpperCase())} · ${esc(G.dungeon(bn).name.toUpperCase())}</h2>`; }
    const st = sk.weeks.find(x => x.n === w.n);
    const mons = w.days.map(d => {
      const day = G.DAY_BY_DATE[d.date], m = G.monsterFor(day), s = dayState(day);
      const inner = m ? (m.img ? `<img src="${m.img}" alt="">` : "🍺") : patrolSVG();
      return `<button class="mon ${m ? "" : "patrol"} ${s} ${m?.placeholder && m.img ? "ph" : ""} ${d.on === t ? "today" : ""}" data-go="${d.date}" title="${esc(d.title)}${m ? " · " + esc(m.name) : " · патруль"}">${inner}</button>`;
    }).join("");
    const manual = (S.meta.freezes || []).includes(w.n);
    const canFreeze = !st.tavern && st.status !== "ok" && st.status !== "future" && (manual || left > 0);
    h += `<div class="wk ${st.status === "now" ? "now" : ""}"><div class="n">${w.n}</div>
      <div class="mid"><small>${fmt(w.onFrom)}–${fmt(w.onTo)}${w.note ? " · " + esc(w.note) : ""}</small><div class="mons">${mons}</div></div>
      <div class="r">${st.done}/${st.goal}${st.tavern ? "<br>таверна" : ""}${canFreeze ? `<button data-freeze="${w.n}">${manual ? "разморозить" : "заморозить"}</button>` : ""}</div></div>`;
  }
  main.innerHTML = h;
}
main.addEventListener("click", e => {
  const u = e.target.closest("[data-unshift]");
  if (u) { S.meta.shifts.splice(+u.dataset.unshift, 1); touchMeta(); recompute(); renderJourney(); return; }
  const f = e.target.closest("[data-freeze]"); if (!f) return;
  const n = +f.dataset.freeze, fr = S.meta.freezes ||= [];
  const i = fr.indexOf(n); if (i >= 0) fr.splice(i, 1); else fr.push(n);
  touchMeta(); recompute(); renderJourney();
});

// =====================================================================
// ПРОГРЕСС (встроенный анализ)
// =====================================================================
let chosenEx = null;
function renderProgress() {
  const t = todayISO(), series = exerciseSeries(S.logs), wk = weekly(S.logs, t), hs = hints(S.logs, t);
  if (!chosenEx || !series.find(s => s.key === chosenEx)) chosenEx = (series.find(s => /подтягив/.test(s.key)) || series[0])?.key;
  const s = series.find(x => x.key === chosenEx);
  let h = `<p class="lead">Прогресс</p><p class="sub">Считается прямо на телефоне, без интернета.</p>
  <h2 class="sec">ПОДСКАЗКИ</h2><ul class="list hints">${hs.map(x => `<li class="${x.level}">${esc(x.text)}</li>`).join("") || '<li>Пока всё ровно — замечаний нет.</li>'}</ul>
  <h2 class="sec">ВЫПОЛНЕНИЕ ПЛАНА ПО НЕДЕЛЯМ</h2>${barChart(wk)}
  <h2 class="sec">УПРАЖНЕНИЕ</h2>`;
  if (s) {
    h += `<select id="exSel">${series.map(x => `<option value="${esc(x.key)}" ${x.key === chosenEx ? "selected" : ""}>${esc(x.name)} (${x.points.length})</option>`).join("")}</select>
    ${lineChart(s.points.map(p => ({ x: fmt(p.date), y: p.best })), "лучший подход, " + s.unit)}
    ${s.points.some(p => p.kg) ? lineChart(s.points.map(p => ({ x: fmt(p.date), y: p.kg })), "вес, кг", "#c9a24a") : ""}
    <ul class="list">${s.points.slice(-8).reverse().map(p => `<li><span>${fmt(p.date)} · ${esc(p.weight || "свой вес")}</span><span>${p.sets} подх., лучш. ${p.best}, всего ${p.total}${p.planPct != null ? ` · ${Math.round(p.planPct * 100)}%` : ""}</span></li>`).join("")}</ul>`;
  } else h += `<p class="hint">Здесь появятся графики после первых записей.</p>`;
  h += `<h2 class="sec">ЛИЧНЫЕ РЕКОРДЫ</h2><ul class="list">${SUM.prList.slice(-12).reverse().map(p => `<li><span>${fmt(p.date)} · ${esc(p.name)}</span><span>${esc(p.text)}</span></li>`).join("") || "<li><span>Пока нет — первый крит впереди.</span></li>"}</ul>`;
  main.innerHTML = h;
  $("#exSel")?.addEventListener("change", e => { chosenEx = e.target.value; renderProgress(); });
}

function lineChart(pts, label, color = "#efe8d6") {
  if (pts.length < 1) return "";
  const W = 400, H = 170, L = 30, R = 12, T = 22, B = 24;
  const ys = pts.map(p => p.y), lo = Math.min(0, ...ys), hi = Math.max(...ys, 1);
  const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const step = Math.ceil(pts.length / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <text x="${L}" y="12">${esc(label.toUpperCase())}</text>
    <line x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}" stroke="#2e2b25"/>
    <text x="${L - 6}" y="${y(hi) + 4}" text-anchor="end">${hi}</text><text x="${L - 6}" y="${y(lo) + 4}" text-anchor="end">${lo}</text>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="3.5" fill="${color}"><title>${p.x}: ${p.y}</title></circle>`).join("")}
    ${pts.map((p, i) => i % step === 0 || i === pts.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${p.x}</text>` : "").join("")}
  </svg>`;
}
function barChart(wk) {
  if (!wk.length) return `<p class="hint">План ещё не начался.</p>`;
  const W = 400, H = 150, L = 30, B = 22, T = 10, n = G.WEEKS.length, bw = (W - L) / n;
  const y = v => T + (H - T - B) * (1 - Math.min(v, 1.2) / 1.2);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Выполнение плана по неделям">
    <line x1="${L}" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="#5a5244" stroke-dasharray="3 3"/><text x="${L - 6}" y="${y(1) + 4}" text-anchor="end">100</text>
    <text x="${L - 6}" y="${y(0) + 4}" text-anchor="end">0</text>
    ${wk.map(w => { const xx = L + (w.n - 1) * bw + 1, yy = y(w.pct); return `<rect x="${xx}" y="${yy}" width="${Math.max(2, bw - 2)}" height="${y(0) - yy}" fill="${w.current ? "#6d675a" : w.pct >= 0.95 ? "#c9a24a" : "#8e1a12"}"><title>Неделя ${w.n}: ${Math.round(w.pct * 100)}%</title></rect>`; }).join("")}
    ${[1, Math.ceil(n / 2), n].map(k => `<text x="${L + (k - 0.5) * bw}" y="${H - 6}" text-anchor="middle">${k}</text>`).join("")}
  </svg>`;
}

// =====================================================================
// ГЕРОЙ
// =====================================================================
function renderHero() {
  const s = SUM;
  let h = `<p class="lead">${esc(s.title)} · ур. ${s.level}</p><p class="sub">Всего опыта: ${s.xp}. До следующего уровня: ${s.need - s.into}.</p>
  <div class="stats"><div><b>${s.kills}</b><span>убито</span></div><div><b>${s.fled}</b><span>сбежало</span></div><div><b>${s.prList.length}</b><span>рекордов</span></div>
  <div><b>${s.streak.cur}</b><span>серия недель</span></div><div><b>${s.cardio}</b><span>патрулей</span></div><div><b>${s.achievements.filter(a => a.got).length}/${s.achievements.length}</b><span>достижений</span></div></div>
  <h2 class="sec">ДОСТИЖЕНИЯ</h2><div class="ach">${s.achievements.map(a => `<div class="${a.got ? "got" : ""}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`).join("")}</div>
  <h2 class="sec">БЕСТИАРИЙ</h2><div class="beasts">`;
  for (const m of Object.values(G.MONSTERS)) {
    if (m.tavern) continue;
    const k = s.killed[m.id] || 0;
    h += `<div class="beast ${k ? "" : "unseen"}"><div class="pic"><img src="${m.img}" alt="" loading="lazy"></div><b>${k || !m.placeholder ? esc(m.name) : "???"}</b><span>${k ? "убит ×" + k : m.boss ? "босс" : "не встречен"}</span></div>`;
  }
  h += `</div><h2 class="sec">ТИТУЛЫ</h2><ul class="list">${G.TITLES.map((t, i) => `<li><span>${esc(t)}</span><span>с ${i * 2 + 1} уровня${s.title === t ? " · сейчас" : ""}</span></li>`).join("")}</ul>
  <h2 class="sec">КАК КАЧАЕТСЯ ГЕРОЙ</h2><div class="help">
  <p>Здоровье монстра = плановый объём дня: каждый плановый подход отнимает свою долю. Выполнил всё — монстр повержен (+${G.XP_KILL} опыта, босс ×3).</p>
  <p>Перевыполнение даёт бонусный опыт, но не больше +20% здоровья монстра. Личный рекорд — критический удар (+${G.XP_PR}). Не добил — монстр сбегает раненым, опыт за урон остаётся.</p>
  <p>Реванш: сбежавший монстр приходит вместо монстра следующей обычной тренировки (если она в течение ${G.REVENGE_WINDOW} дней). Добил — убийство засчитывается, в том числе за день, когда он сбежал, и +${G.XP_REVENGE} опыта сверху. Сбежал второй раз — ушёл насовсем.</p>
  <p>Блоки плана — подземелья, тесты — боссы, разгрузочные недели — таверна: серия не рвётся, а первый бой после таверны даёт +${G.XP_TAVERN_BUFF} бодрости.</p></div>
  <p style="margin:24px 0"><a href="#/settings" class="act" style="display:grid;place-items:center;text-decoration:none;color:var(--bone)">НАСТРОЙКИ И СОХРАНЕНИЕ</a></p>`;
  main.innerHTML = h;
}

// =====================================================================
// НАСТРОЙКИ
// =====================================================================
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (route().tab === "settings") renderSettings(); });

function renderSettings() {
  const c = S.cfg;
  main.innerHTML = `<p class="lead">Настройки</p>
  <h2 class="sec">СОХРАНЕНИЕ В GITHUB</h2>
  <div class="set-form">
    <label>Токен GitHub<input id="cfgToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off"></label>
    <label>Репозиторий<input id="cfgRepo" value="${esc(c.owner + "/" + c.repo)}"></label>
    <label>Ветка для данных<input id="cfgBranch" value="${esc(c.branch)}"></label>
    <button class="act gold" id="cfgSave">СОХРАНИТЬ И СИНХРОНИЗИРОВАТЬ</button>
    <div class="msg" id="cfgMsg"></div>
  </div>
  <div class="help"><p>Записи всегда сначала сохраняются на телефоне и работают без интернета. Токен нужен, чтобы копия уходила в репозиторий (папка <code>data/log</code> в ветке <code>data</code>) — оттуда её можно разобрать вместе с Claude и восстановить на другом устройстве.</p>
  <ol><li>Открой <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>.</li>
  <li>Repository access → <b>Only select repositories</b> → <code>training</code>.</li>
  <li>Permissions → Repository → <b>Contents: Read and write</b>. Срок — какой удобно (например, год).</li>
  <li>Скопируй токен и вставь сюда. Он хранится только в этом браузере и никуда, кроме GitHub, не отправляется.</li></ol></div>
  <h2 class="sec">РЕЗЕРВНАЯ КОПИЯ</h2>
  <div class="set-form"><button class="act" id="exp">СКАЧАТЬ JSON</button>
  <label>Загрузить из файла<input type="file" id="imp" accept="application/json"></label></div>
  ${installEvt ? `<h2 class="sec">ПРИЛОЖЕНИЕ</h2><button class="act gold" id="inst">УСТАНОВИТЬ НА ТЕЛЕФОН</button>` : `<h2 class="sec">ПРИЛОЖЕНИЕ</h2><p class="help">Чтобы поставить на телефон: Chrome → ⋮ → «Добавить на главный экран» (или «Установить приложение»). После этого открывается без интернета.</p>`}
  <p class="hint" style="margin:24px 0">Записей: ${Object.keys(S.logs).length} · не отправлено: ${dirtyCount()}${S.lastSync ? " · последняя синхронизация " + new Date(S.lastSync).toLocaleString("ru-RU") : ""}</p>`;
  renderSettingsMsg();
  $("#cfgSave").onclick = async () => {
    const [owner, repo] = $("#cfgRepo").value.trim().split("/");
    Object.assign(S.cfg, { token: $("#cfgToken").value.trim(), owner: owner || "getman-danil", repo: repo || "training", branch: $("#cfgBranch").value.trim() || "data" });
    S.sha = {}; save();
    const ok = await runSync(); recompute(); renderTop();
    if (ok) toast("Связь с GitHub есть");
  };
  $("#exp").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportAll()], { type: "application/json" }));
    a.download = `training-backup-${todayISO()}.json`; a.click();
  };
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      for (const [d, L] of Object.entries(j.logs || {})) if (!S.logs[d] || (L.updatedAt || 0) > (S.logs[d].updatedAt || 0)) touchLog(L);
      if (j.meta) { S.meta = j.meta; touchMeta(); }
      recompute(); renderTop(); toast("Копия загружена");
    } catch (err) { toast("Не удалось прочитать файл"); }
  };
  $("#inst")?.addEventListener("click", async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderSettings(); });
}
function renderSettingsMsg() { const m = $("#cfgMsg"); if (m) m.textContent = sync.msg || ""; }

// ---------- старт ----------
recompute(); renderTop(); renderSync(); render();
if (S.cfg.token) runSync().then(() => { recompute(); renderTop(); if (route().tab !== "settings" && sheet.hidden) render(); });
else scheduleSync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
