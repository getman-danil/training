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
  L.game = m ? { monster: m.name, hp: b.hp, dealt: b.dealt, overkill: b.over, killed: b.killed, ...(b.replaced ? { replaced: true } : {}) } : { patrol: true };
  // Перенос из тетради: прошедший день по умолчанию считается сделанным в свою дату.
  if (!L.performedOn && (b.setsDone || L.items.some(x => x.done))) L.performedOn = day.on < todayISO() ? day.on : todayISO();
  const before = SUM?.level, rw = SUM?.unclaimed;
  touchLog(L);
  recompute(); renderTop();
  if (before && SUM.level > before) toast(`Новый уровень: ${SUM.level} · ${SUM.title} · +1 очко характеристики и навыка`);
  else if (rw != null && SUM.unclaimed > rw) toast("Новая награда — забери её в Летописи");
}

// Вылазка — тренировка вне плана, своя запись с ключом "x-<дата>".
function commitSortie(L) {
  L.game = { sortie: true, sets: G.customSets(L) };
  const before = SUM?.level;
  touchLog(L);
  recompute(); renderTop();
  if (before && SUM.level > before) toast(`Новый уровень: ${SUM.level} · ${SUM.title} · +1 очко характеристики и навыка`);
}
function newSortie(on) {
  let key = "x-" + on, n = 1;
  while (S.logs[key]) key = `x-${on}-${++n}`;
  const L = { date: key, sortie: true, title: "Вылазка", performedOn: on, finished: false, finishedAt: null, dayNote: "", items: [], extra: [blankEx()] };
  S.logs[key] = L; commitSortie(L);
  return key;
}
const blankEx = () => ({ name: "", weight: "", reps: [], note: "" });
// Экран работает либо с днём плана (cur.day), либо с вылазкой (cur.sortie).
function curLog(create) { return cur.sortie ? S.logs[cur.sortie] : getLog(cur.day, create); }
function commitCur(L) { if (cur.sortie) commitSortie(L); else commit(cur.day, L); }

// ---------- верхняя панель ----------
function renderTop() {
  $("#lvl").textContent = SUM.level;
  $("#lvlBtn").classList.toggle("pts", SUM.free > 0 || SUM.skillFree > 0);
  document.querySelector('.tabs [data-tab="chronicle"]').classList.toggle("pts", SUM.unclaimed > 0);
  $("#xpTxt").textContent = `${SUM.shownTitle} · ${SUM.into} / ${SUM.need}`;
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
  const tab = r.tab === "sortie" ? "battle" : r.tab;
  document.querySelectorAll(".tabs a").forEach(a => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (r.tab === "journey") renderJourney();
  else if (r.tab === "progress") renderProgress();
  else if (r.tab === "hero") renderHero();
  else if (r.tab === "chronicle") renderChronicle();
  else if (r.tab === "settings") renderSettings();
  else if (r.tab === "sortie") renderSortie(decodeURIComponent(r.arg || ""));
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
  if (cur?.day?.date !== date) subOpen.clear();
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
  const cls = m.boss ? "boss" : m.tavern ? "tavern" : m.elite ? "elite" : "";
  const art = m.tavern ? tavernSVG() : `<img src="${m.img}" alt="${esc(m.name)}">${m.placeholder ? '<div class="q">?</div>' : ""}`;
  const rv = G.REVENGE[day.date];
  const tag = m.boss ? "БОСС" : m.tavern ? "ТАВЕРНА" : rv ? "РЕВАНШ" : m.elite ? "ЭЛИТА" : m.chief ? "ВОЖАК" : "";
  return `<div class="stage ${cls}" id="stage">
    <div class="fog"></div>
    <i class="ember" style="left:62%"></i><i class="ember" style="left:74%;animation-delay:1.7s"></i><i class="ember" style="left:55%;animation-delay:3.1s"></i>
    <div class="flash"></div><div class="dmg" id="dmg"></div>
    <div class="art ${m.placeholder && !m.tavern ? "shadow" : ""}" id="art">${art}</div>
    <div class="mname"><span>${esc(m.name)}</span><small>${tag ? tag + " · " : ""}УР. ${G.monsterLevel(day)}</small></div>
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
  const pd = SUM.perDay[day.date], loot = (pd?.loot || []).map(G.itemOf);
  const found = (loot.length ? `<br>добыча: ${loot.map(it => `<span class="${it.rarity}">${esc(it.name)}</span>`).join(", ")}` : "") + (pd?.trophy ? `<br>трофей: <span class="legendary">${esc(pd.trophy)}</span>` : "");
  if (b.killed) host.innerHTML = `<div class="banner">${m.tavern ? "СПАРРИНГ ВЫИГРАН" : m.boss ? "БОСС ПОВЕРЖЕН" : G.REVENGE[day.date] ? "РЕВАНШ ВЗЯТ" : m.elite ? "ЭЛИТА ПОВЕРЖЕНА" : "ВРАГ ПОВЕРЖЕН"}<small>+${pd?.xp || 0} опыта${pd?.inspired ? " (вдохновение)" : ""}${pd?.gold ? ` · +${pd.gold} золота` : ""}${found}</small></div>`;
  else if (L?.skipped) host.innerHTML = `<div class="banner grey">МОНСТР УШЁЛ<small>тренировка пропущена · без штрафа</small></div>`;
  else if (L?.finished && b.dealt > 0) host.innerHTML = `<div class="banner red">МОНСТР СБЕЖАЛ<small>${L.replaced ? "тренировка заменена · " : ""}ранен на ${Math.round(b.pct * 100)}% · +${pd?.xp || 0} опыта${found}${back ? `<br>вернётся ${fmt(G.DAY_BY_DATE[back[0]].on)} — добей его` : ""}</small></div>`;
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
  if (!L?.replaced) day.items.forEach((it, i) => { h += it.type === "ex" ? exHTML(day, i, b) : noteHTML(day, i); });
  h += `</div>${customHTML(L, false)}${offPlanHTML(day, L)}<div class="finish">
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
  const el = $("#finBtns"); if (!el) return;
  if (cur.sortie) { el.innerHTML = sortieFinish(S.logs[cur.sortie]); return; }
  const day = cur.day, L = S.logs[day.date];
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
  const exb = b.exs.find(e => e.i === i);
  // С другим весом в пустой клетке показываем, сколько повторов нужно для полного урона.
  const need = pp.target && exb ? Math.ceil(pp.target / exb.lf - 1e-9) : pp.target;
  let cells = "";
  for (let k = 0; k < n; k++) {
    const r = reps[k], has = r != null && r !== "" && +r > 0;
    const cls = ["set", has ? "d" : "", has && need && +r < need ? "lo" : "", prs[i + ":" + k] ? "pr" : "", k >= pp.sets ? "extra" : ""].join(" ");
    cells += `<button class="${cls}" data-set="${i}:${k}"><small>${k + 1}</small>${has ? r : need ? `<span class="g">${need}</span>` : '<span class="g">·</span>'}</button>`;
  }
  cells += `<button class="set add" data-add="${i}" aria-label="Добавить подход">+</button>`;
  const done = exb && exb.dealt >= exb.hp - 0.5;
  const unit = pp.unit !== "повт" ? ` · ${pp.unit}` : "";
  const sub = li?.sub != null || subOpen.has(i);
  const head = sub
    ? `<div class="h"><input class="cname" data-sub="${i}" list="exNames" value="${esc(li?.sub || "")}" placeholder="чем заменил" aria-label="Чем заменил упражнение" autocomplete="off"><em>${esc(it.plan || "")}</em><button class="ghostbtn cdel" data-unsub="${i}" aria-label="Вернуть плановое упражнение">✕</button></div>
    <div class="spec">вместо: ${esc(it.name)} · подход засчитан, если повторов не меньше плановых · рекорд без крита</div>`
    : `<div class="h"><b>${esc(it.name)}</b><em>${esc(it.plan || "")}</em></div>
    <div class="spec">${esc([it.weight, it.rest].filter(Boolean).join(" · "))}${unit} <button class="sublink" data-subbtn="${i}">заменить</button></div>`;
  return `<div class="ex ${done ? "done" : ""} ${sub ? "cx" : ""}" data-ex="${i}">
    ${head}${it.hint && !sub ? `<div class="spec">${esc(it.hint)}</div>` : ""}
    <div class="sets">${cells}</div>
    <div class="fields"><input data-w="${i}" value="${esc(li ? li.weight : it.weight || "")}" placeholder="вес" aria-label="Вес"><input data-n="${i}" value="${esc(li?.note || "")}" placeholder="заметка" aria-label="Заметка к упражнению"></div>
    ${exb && Math.abs(exb.lf - 1) > 0.005 ? `<div class="spec lf">вес не как в плане · урон за повтор ×${exb.lf.toFixed(2).replace(".", ",")}</div>` : ""}
  </div>`;
}
function noteHTML(day, i) {
  const it = day.items[i], on = !!S.logs[day.date]?.items?.[i]?.done;
  return `<button class="note-it ${on ? "on" : ""}" data-note="${i}"><span class="box">${on ? "✓" : ""}</span><span>${esc(it.text)}${it.hint ? `<br><small>${esc(it.hint)}</small>` : ""}</span></button>`;
}

// ---------- своя тренировка ----------
// Свои упражнения дня (дополнение или замена) и упражнения вылазки: название, подходы, вес, заметка.
function customHTML(L, sortie) {
  const xs = L?.extra || [];
  if (!xs.length && !sortie && !L?.replaced) return `<div id="custom"></div>`;
  const head = sortie ? "УПРАЖНЕНИЯ" : L.replaced ? "ТВОЯ ТРЕНИРОВКА ВМЕСТО ПЛАНА" : "СВЕРХ ПЛАНА";
  return `<div id="custom"><h2 class="sec">${head}</h2>${xs.map((x, j) => cxHTML(L, j)).join("")}
    <button class="act" data-cnew style="margin-top:10px">+ УПРАЖНЕНИЕ</button></div>`;
}
function cxHTML(L, j) {
  const x = L.extra[j], prs = SUM.prs[L.date] || {}, reps = x.reps || [];
  const cells = reps.map((r, k) => { const has = r != null && +r > 0; return `<button class="${["set", has ? "d" : "", prs[`x${j}:${k}`] ? "pr" : ""].join(" ")}" data-cset="${j}:${k}"><small>${k + 1}</small>${has ? r : '<span class="g">·</span>'}</button>`; }).join("");
  return `<div class="ex cx" data-cx="${j}">
    <div class="h"><input class="cname" data-cname="${j}" list="exNames" value="${esc(x.name)}" placeholder="упражнение" aria-label="Упражнение" autocomplete="off"><button class="ghostbtn cdel" data-cdel="${j}" aria-label="Убрать упражнение">✕</button></div>
    <div class="sets">${cells}<button class="set add" data-cadd="${j}" aria-label="Добавить подход">+</button></div>
    <div class="fields"><input data-cw="${j}" value="${esc(x.weight)}" placeholder="вес" aria-label="Вес"><input data-cn="${j}" value="${esc(x.note)}" placeholder="заметка" aria-label="Заметка к упражнению"></div>
  </div>`;
}
function refreshCx(j) {
  const L = curLog(), el = main.querySelector(`[data-cx="${j}"]`);
  if (el) { const tmp = document.createElement("div"); tmp.innerHTML = cxHTML(L, j); el.replaceWith(tmp.firstElementChild); }
}
// Три режима «не по плану». Заменённый день можно вернуть к плану — свои упражнения останутся дополнением.
function offPlanHTML(day, L) {
  if (L?.skipped) return "";
  if (L?.replaced) return `<div class="finish" style="margin-bottom:0"><div class="hint">Тренировка заменена своей. Каждый твой подход бьёт монстра как плановый, но не больше чем на ${Math.round(G.REPLACE_CAP * 100)}%: убить можно только по плану. Монстр сбежит и вернётся на реванш. Неделя для серии засчитывается.</div>
    <button class="act" id="unreplace">ВЕРНУТЬ ПЛАН</button></div>`;
  const cardio = G.isCardio(day);
  return `<details class="move offplan"><summary class="act">ВЫШЛО НЕ ПО ПЛАНУ</summary>
    <button class="act" data-off="add">ДОПОЛНИТЬ ТРЕНИРОВКУ</button>
    ${cardio ? "" : `<button class="act" data-off="replace">ЗАМЕНИТЬ ТРЕНИРОВКУ</button>`}
    <button class="act" data-off="sortie">ОТДЕЛЬНЫМ ДНЁМ</button>
    <div class="hint" style="text-align:left">${cardio ? "" : `<b>Дополнить</b> — свои упражнения к плановым: идут в перебор, бонус за перебор общий, не больше +${Math.round(G.OVERKILL_CAP * 100)}%. <b>Заменить</b> — сделал другое вместо плана: подходы бьют монстра до ${Math.round(G.REPLACE_CAP * 100)}%, он сбегает и вернётся на реванш, серия не рвётся. `}<b>Отдельным днём</b> — вылазка вне плана: +${G.SORTIE_XP_SET} опыта за подход, не больше ${G.SORTIE_XP_MAX} за день. Любое упражнение дня можно <b>заменить</b> отдельно — кнопка у упражнения. Рекорды в своих и заменённых упражнениях записываются, но крита не дают.</div>
  </details>`;
}
function sortieSVG() {
  // Знамя вылазки.
  return `<svg class="torch" viewBox="0 0 40 40" aria-hidden="true"><path d="M11 4v33" stroke="#c9a24a" stroke-width="2"/><path d="M12 6h18l-5 6l5 6h-18z" fill="#8e1a12" stroke="#c9a24a" stroke-width="1"/></svg>`;
}
function renderSortie(key) {
  const L = S.logs[key];
  if (!G.isSortieKey(key) || !L || L.deleted) { location.hash = "#/journey"; return; }
  cur = { sortie: key };
  const on = G.sortieDate(L);
  main.innerHTML = `<div class="loc">ВЫЛАЗКА ВНЕ ПЛАНА · НЕДЕЛЯ ${G.weekOf(on).n}</div>
  <div class="cardio">${sortieSVG()}<h2>ВЫЛАЗКА</h2><p>Тренировка вне плана: +${G.SORTIE_XP_SET} опыта за подход, не больше ${G.SORTIE_XP_MAX} за день. Рекорды записываются, но без крита. Золота, находок и серии нет: главное — сам план.</p></div>
  <div class="dayhead"><input id="sTitle" class="ctitle" value="${esc(L.title || "")}" placeholder="Вылазка" aria-label="Название вылазки"><p>${G.dowOf(on)}, ${fmt(on)}</p></div>
  ${customHTML(L, true)}
  <div class="finish"><textarea id="dayNote" placeholder="Заметка: что делал и почему не по плану">${esc(L.dayNote || "")}</textarea>
  <div id="finBtns" class="finish" style="margin:0">${sortieFinish(L)}</div></div>`;
}
function sortieFinish(L) {
  const pd = SUM.perDay[L.date];
  return `${L.finished ? `<button class="act" id="sReopen">ВЫЛАЗКА ЗАВЕРШЕНА ✦</button>` : `<button class="act gold" id="sFinish">ЗАВЕРШИТЬ ВЫЛАЗКУ</button>`}
  ${pd?.xp ? `<div class="hint">+${pd.xp} опыта${pd.prs ? ` · рекордов: ${pd.prs}` : ""}</div>` : ""}
  <label class="hint" style="display:flex;gap:10px;align-items:center;justify-content:center">сделал <input type="date" id="performedOn" value="${esc(L.performedOn)}" style="width:auto;font-size:16px"></label>
  <button class="act" id="sDelete">УДАЛИТЬ ВЫЛАЗКУ</button>`;
}
// Подход своего упражнения: та же клавиатура, урон по монстру дня (в перебор или при замене) и криты.
function setXRep(j, k, val) {
  const L = curLog(true), x = L.extra[j];
  const before = cur.sortie ? null : G.battle(cur.day, L);
  const prBefore = Object.keys(SUM.prs[L.date] || {}).length;
  x.reps ||= [];
  if (val == null) { if (k === x.reps.length - 1) x.reps.pop(); else x.reps[k] = null; }
  else { while (x.reps.length < k) x.reps.push(null); x.reps[k] = val; }
  L.skipped = false;
  commitCur(L);
  const rec = !!(SUM.prs[L.date] || {})[`x${j}:${k}`] && Object.keys(SUM.prs[L.date] || {}).length > prBefore;
  refreshCx(j); refreshFinish();
  if (before) { const after = G.battle(cur.day, L); updateStage(true, { dmg: (after.dealt + after.over) - (before.dealt + before.over) }); }
  if (rec) toast("Личный рекорд записан");
}
// Замена одного планового упражнения: li.sub — чем заменил. Пока название не введено, поле держится открытым в subOpen.
const subOpen = new Set();
const lfOf = (it, li) => (String(li?.sub || "").trim() ? 1 : G.loadFactor(it, li));
function focusLastEx() { const ins = main.querySelectorAll("[data-cname]"); const el = ins[ins.length - 1]; if (el && !el.value) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); } }

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
  ${customHTML(L, false)}${offPlanHTML(day, L)}
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
  const pr = (SUM.prs[day.date] || {})[i + ":" + k], fresh = !!pr && Object.keys(SUM.prs[day.date] || {}).length > prBefore;
  const crit = fresh && !pr.custom;
  const dmg = (after.dealt + after.over) - (before.dealt + before.over);
  refreshEx(i); refreshFinish();
  updateStage(true, { dmg, crit });
  if (!before.killed && after.killed) { const m = G.monsterFor(day); toast(m.tavern ? "Спарринг выигран" : G.REVENGE[day.date] ? `Реванш взят: ${m.name} повержен! +${G.XP_REVENGE} опыта` : `${m.name} повержен!`); if (navigator.vibrate) navigator.vibrate([60, 60, 120]); }
  if (crit) toast("Критический удар: личный рекорд!");
  else if (fresh) toast("Личный рекорд записан");
}

main.addEventListener("click", e => {
  const go = e.target.closest("[data-go]"); if (go) { location.hash = "#/battle/" + go.dataset.go; return; }
  const wk = e.target.closest("[data-wk]"); if (wk) { const w = G.WEEKS[+wk.dataset.wk]; if (w) location.hash = "#/battle/" + w.days[0].date; return; }
  const s = e.target.closest("[data-set]");
  if (s) {
    const [i, k] = s.dataset.set.split(":").map(Number);
    const day = cur.day, it = day.items[i], pp = G.parsePlan(it);
    const r = S.logs[day.date]?.items?.[i]?.reps?.[k];
    if ((r == null || r === "") && pp.target) setRep(i, k, Math.ceil(pp.target / lfOf(it, S.logs[day.date]?.items?.[i]) - 1e-9));
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
  const sb = e.target.closest("[data-subbtn]");
  if (sb) { const i = +sb.dataset.subbtn; subOpen.add(i); refreshEx(i); main.querySelector(`[data-sub="${i}"]`)?.focus(); return; }
  const us = e.target.closest("[data-unsub]");
  if (us) {
    const i = +us.dataset.unsub, day = cur.day, L = S.logs[day.date], li = L?.items?.[i];
    subOpen.delete(i);
    if (li && li.sub != null) { delete li.sub; li.weight = day.items[i].weight || ""; commit(day, L); }
    refreshEx(i); updateStage(false); refreshFinish(); return;
  }
  const cs = e.target.closest("[data-cset]");
  if (cs) { const [j, k] = cs.dataset.cset.split(":").map(Number); openSheet(j, k, cs, true); return; }
  const ca = e.target.closest("[data-cadd]");
  if (ca) { const j = +ca.dataset.cadd; openSheet(j, (curLog()?.extra?.[j]?.reps || []).length, ca, true); return; }
  if (e.target.closest("[data-cnew]")) { const L = curLog(true); (L.extra ||= []).push(blankEx()); commitCur(L); render(); focusLastEx(); return; }
  const cdel = e.target.closest("[data-cdel]");
  if (cdel) {
    const L = curLog(true), j = +cdel.dataset.cdel, x = L.extra[j];
    if (G.customSets({ extra: [x] }) && !confirm(`Убрать «${x.name || "упражнение"}» со всеми подходами?`)) return;
    L.extra.splice(j, 1); commitCur(L); render(); return;
  }
  const off = e.target.closest("[data-off]");
  if (off) {
    const day = cur.day, mode = off.dataset.off;
    if (mode === "sortie") { location.hash = "#/sortie/" + newSortie(todayISO()); return; }
    const L = getLog(day, true);
    if (mode === "replace") {
      const had = G.battle(day, L).setsDone - G.customSets(L);
      if (!confirm(`Заменить тренировку своей?${had ? " Плановые подходы этого дня перестанут считаться (они сохранятся — вернёшь план, и они вернутся)." : ""} Убить монстра заменой нельзя: урон не больше ${Math.round(G.REPLACE_CAP * 100)}%, он сбежит и вернётся на реванш.`)) return;
      L.replaced = true;
    }
    if (!(L.extra || []).length || mode === "add") (L.extra ||= []).push(blankEx());
    commit(day, L); render(); focusLastEx(); return;
  }
  if (e.target.closest("#unreplace")) {
    const day = cur.day, L = getLog(day, true); L.replaced = false;
    L.extra = (L.extra || []).filter(x => x.name || G.customSets({ extra: [x] }));
    commit(day, L); render(); return;
  }
  if (e.target.closest("#sFinish") || e.target.closest("#sReopen")) {
    const L = curLog(); L.finished = !L.finished; L.finishedAt = L.finished ? new Date().toISOString() : null;
    commitSortie(L); render(); if (L.finished) { scrollTo({ top: 0, behavior: "smooth" }); runSync(); }
    return;
  }
  if (e.target.closest("#sDelete")) {
    const L = curLog();
    if (!confirm("Удалить вылазку? Её подходы и рекорды перестанут считаться.")) return;
    Object.assign(L, { deleted: true, extra: [], finished: false });
    commitSortie(L); location.hash = "#/journey"; return;
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
    if (t.dataset.w != null) setTimeout(() => { if (cur?.day === day) { refreshEx(i); updateStage(false); refreshFinish(); } });
  }
  if (t.matches("[data-sub]") && cur?.day) {
    const day = cur.day, L = getLog(day, true), i = +t.dataset.sub, li = L.items[i], v = t.value.trim();
    if (v) { if (li.sub == null && li.weight === (day.items[i].weight || "")) li.weight = ""; li.sub = v; } else delete li.sub;
    commit(day, L); subOpen.delete(i);
    setTimeout(() => { refreshEx(i); updateStage(false); refreshFinish(); });
  }
  if (t.matches("[data-cname],[data-cw],[data-cn]") && cur) {
    const L = curLog(true), j = +(t.dataset.cname ?? t.dataset.cw ?? t.dataset.cn), x = L.extra[j];
    if (t.dataset.cname != null) x.name = t.value.trim(); else if (t.dataset.cw != null) x.weight = t.value.trim(); else x.note = t.value.trim();
    commitCur(L); setTimeout(() => refreshCx(j));
  }
  if (t.id === "sTitle" && cur?.sortie) { const L = curLog(); L.title = t.value.trim() || "Вылазка"; commitSortie(L); }
  if (t.id === "performedOn" && cur && t.value) { const L = curLog(true); L.performedOn = t.value; commitCur(L); if (cur.sortie) render(); }
  if (t.id === "dayNote" && cur) { const L = curLog(true); L.dayNote = t.value; commitCur(L); }
});

// ---------- лист ввода повторов ----------
const sheet = $("#sheet"), sv = $("#sheetVal");
let sheetAt = null;
function openSheet(i, k, el, x) {
  if (x) {
    const c = curLog()?.extra?.[i] || blankEx(), reps = c.reps || [];
    sheetAt = { i, k, x: true };
    $("#sheetTitle").textContent = `${c.name || "Своё упражнение"} · подход ${k + 1}`;
    sv.value = reps[k] ?? reps[k - 1] ?? ""; fresh = true; sheet.hidden = false;
    main.querySelectorAll(".set.sel").forEach(c => c.classList.remove("sel"));
    el?.classList.add("sel");
    return;
  }
  const day = cur.day, it = day.items[i], pp = G.parsePlan(it);
  const reps = S.logs[day.date]?.items?.[i]?.reps || [];
  const need = pp.target && Math.ceil(pp.target / lfOf(it, S.logs[day.date]?.items?.[i]) - 1e-9);
  const val = reps[k] ?? reps[k - 1] ?? need ?? "";
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
document.addEventListener("pointerdown", e => { if (!sheet.hidden && !sheet.contains(e.target) && !e.target.closest("[data-set],[data-add],[data-cset],[data-cadd]")) closeSheet(); }, true);
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
$("#sheetClear").onclick = () => { if (sheetAt) { const { i, k, x } = sheetAt; closeSheet(); (x ? setXRep : setRep)(i, k, null); } };
$("#sheetOk").onclick = () => {
  if (!sheetAt) return;
  const { i, k, x } = sheetAt, v = parseFloat(String(sv.value).replace(",", "."));
  closeSheet(); (x ? setXRep : setRep)(i, k, v > 0 ? v : null);
};

// =====================================================================
// ПОХОД
// =====================================================================
function renderJourney() {
  const t = todayISO(), sk = SUM.streak, left = Math.max(0, G.freezeLimit(S.meta) - (S.meta.freezes || []).length);
  const bar = sk.weeks.map(w => `<i class="${w.status} ${w.tavern ? "tavern" : ""}" title="Неделя ${w.n}"></i>`).join("");
  let h = `<p class="lead">Поход</p><p class="sub">${G.WEEKS.length} недель · ${fmt(G.WEEKS[0].onFrom)} — ${fmt(G.WEEKS[G.WEEKS.length - 1].onTo)}.${G.WEEKS[G.WEEKS.length - 1].onTo.slice(0, 4)}</p>
  <div class="weeksbar" style="--n:${G.WEEKS.length}">${bar}</div>
  <div class="legend"><span style="--c:var(--gold)">выполнена</span><span style="--c:#3e5566">заморозка</span><span style="--c:#3a1410">пропуск</span><span style="--c:rgba(255,170,60,.7)">таверна</span></div>
  <div class="stats"><div><b>${sk.cur}</b><span>серия</span></div><div><b>${sk.best}</b><span>лучшая</span></div><div><b>${left}</b><span>заморозок</span></div></div>
  <p class="hint" style="text-align:left;margin-top:8px">Неделя засчитана, если все обязательные бои проведены. Таверна (разгрузка) серию не рвёт. Заморозка — на экзамен или болезнь.</p>`;
  const shifts = S.meta.shifts || [];
  if (shifts.length) h += `<h2 class="sec">ПЕРЕНОСЫ</h2><ul class="list">${shifts.map((x, k) => `<li><span>${esc(G.DAY_BY_DATE[x.at]?.title || x.at)} (${fmt(x.at)}) · ${x.days > 0 ? "+" : ""}${x.days} дн. ${x.scope === "all" ? "и весь план после" : "только она"}</span><span><button class="ghostbtn" data-unshift="${k}" style="border:1px solid var(--line2);padding:2px 8px;font-family:var(--caps);letter-spacing:.1em;font-size:13px">отменить</button></span></li>`).join("")}</ul>`;
  const srt = G.sorties(S.logs);
  h += `<h2 class="sec">ВЫЛАЗКИ ВНЕ ПЛАНА</h2>${srt.length ? `<ul class="list">${srt.slice().reverse().map(L => `<li><span><a href="#/sortie/${esc(L.date)}">${fmt(G.sortieDate(L))} · ${esc(L.title || "Вылазка")}</a></span><span>${G.customSets(L)} подх.${SUM.perDay[L.date]?.xp ? ` · +${SUM.perDay[L.date].xp}` : ""}</span></li>`).join("")}</ul>` : ""}
  <button class="act" id="sNew">+ НОВАЯ ВЫЛАЗКА</button><p class="hint">Тренировка не из плана: опыт за подходы (не больше ${G.SORTIE_XP_MAX} в день), рекорды. Заменить или дополнить тренировку дня — внизу её экрана.</p>`;
  let lastBlock = null;
  for (const w of G.WEEKS) {
    const bn = +(/Блок (\d+)/.exec(w.block) || [0, 0])[1];
    if (bn !== lastBlock) { lastBlock = bn; h += `<h2 class="sec">${esc(w.block.toUpperCase())} · ${esc(G.dungeon(bn).name.toUpperCase())}</h2>`; }
    const st = sk.weeks.find(x => x.n === w.n);
    const mons = w.days.map(d => {
      const day = G.DAY_BY_DATE[d.date], m = G.monsterFor(day), s = dayState(day);
      const inner = m ? (m.img ? `<img src="${m.img}" alt="">` : "🍺") : patrolSVG();
      return `<button class="mon ${m ? "" : "patrol"} ${s} ${m?.placeholder && m.img ? "ph" : ""} ${m?.elite ? "elite" : ""} ${d.on === t ? "today" : ""}" data-go="${d.date}" title="${esc(d.title)}${m ? " · " + esc(m.name) : " · патруль"}">${inner}</button>`;
    }).join("") + srt.filter(L => G.sortieDate(L) >= w.onFrom && G.sortieDate(L) <= w.onTo).map(L => `<a class="mon patrol sortie ${L.finished ? "kill" : ""}" href="#/sortie/${esc(L.date)}" title="${esc(L.title || "Вылазка")}">${sortieSVG()}</a>`).join("");
    const manual = (S.meta.freezes || []).includes(w.n);
    const canFreeze = !st.tavern && st.status !== "ok" && st.status !== "future" && (manual || left > 0);
    h += `<div class="wk ${st.status === "now" ? "now" : ""}"><div class="n">${w.n}</div>
      <div class="mid"><small>${fmt(w.onFrom)}–${fmt(w.onTo)}${G.SWAMP_WEEKS.has(w.n) ? " · вылазка в " + esc(G.SWAMP.name.toLowerCase()) : ""}${w.note ? " · " + esc(w.note) : ""}</small><div class="mons">${mons}</div></div>
      <div class="r">${st.done}/${st.goal}${st.tavern ? "<br>таверна" : ""}${canFreeze ? `<button data-freeze="${w.n}">${manual ? "разморозить" : "заморозить"}</button>` : ""}</div></div>`;
  }
  main.innerHTML = h;
}
main.addEventListener("click", e => {
  if (e.target.closest("#sNew")) { location.hash = "#/sortie/" + newSortie(todayISO()); return; }
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
  let h = `<p class="lead">${esc(s.shownTitle)} · ур. ${s.level}</p><p class="sub">Всего опыта: ${s.xp}. До следующего уровня: ${s.need - s.into}. Золото: <b class="gold">${s.gold}</b>.${buffsText(s)}${s.unclaimed ? ` <a href="#/chronicle" class="gold">Награды ждут в Летописи: ${s.unclaimed}</a>.` : ""}</p>
  <div class="stats"><div><b>${s.kills}</b><span>убито</span></div><div><b>${s.fled}</b><span>сбежало</span></div><div><b>${s.prList.length}</b><span>рекордов</span></div>
  <div><b>${s.streak.cur}</b><span>серия недель</span></div><div><b>${s.cardio}</b><span>патрулей</span></div><div><b>${s.achievements.filter(a => a.got).length}/${s.achievements.length}</b><span>достижений</span></div></div>
  ${buildHTML(s)}
  <h2 class="sec">КАК КАЧАЕТСЯ ГЕРОЙ</h2><div class="help">
  <p>Здоровье монстра = плановый объём дня: каждый плановый подход отнимает свою долю. Выполнил всё — монстр повержен (+${G.XP_KILL} опыта, босс ×3).</p>
  <p>У монстров есть уровень: он растёт по ходу плана вместе со здоровьем (+${Math.round(G.HP_PER_LVL * 100)}% за уровень, у боссов ещё ×${G.BOSS_HP}). Уровень монстра — это уровень героя, который идёт ровно по плану, ±1 по месту в стае. Монстр выше тебя даёт больше опыта (до +${Math.round((G.LVL_XP_MAX - 1) * 100)}%), ниже — меньше (до −${Math.round((1 - G.LVL_XP_MIN) * 100)}%): отстал — догонишь быстрее. Убить всё равно можно только выполнив план целиком.</p>
  <p>За каждый уровень — очко характеристики и очко навыка, за босса — ещё очко характеристики. У каждой характеристики своя ветка древа: малые узлы дают +1 к ней, большие — особые эффекты. Вещи падают с находок и боссов и дают характеристики или узлы древа. За каждое убийство — ${G.GOLD_KILL} золота, за босса ${G.GOLD_BOSS}: у торговца на него покупаются обычные вещи, в кузнице из двух обычных одного слота куётся редкая, а легендарку можно пробудить до мифической. Билд и снаряжение действуют на бои с того дня, как ты их поменял.</p>
  <p>Перевыполнение даёт бонусный опыт, но не больше +20% здоровья монстра. Личный рекорд — критический удар (+${G.XP_PR}). Не добил — монстр сбегает раненым, опыт за урон остаётся.</p>
  <p>Если вес не как в плане, урон пересчитывается: повтор стоит пропорционально поднятой нагрузке. В упражнениях со своим весом нагрузка = вес тела + отягощение − резинка (вес тела — в настройках). Без резинки 5 подтягиваний могут убить монстра, рассчитанного на 6 с резинкой.</p>
  <p>Реванш: сбежавший монстр приходит вместо монстра следующей обычной тренировки (если она в течение ${G.REVENGE_WINDOW} дней). Добил — убийство засчитывается, в том числе за день, когда он сбежал, и +${G.XP_REVENGE} опыта сверху. Сбежал второй раз — ушёл насовсем.</p>
  <p>Элита: иногда обычный монстр приходит матёрым — та же тварь в золотой ауре, на уровень выше. Убить его тоже можно только выполнив план; за это ×${G.ELITE_KILL} опыта за убийство, ×${G.ELITE_GOLD} золота и трофей в коллекцию Летописи.</p>
  <p>Блоки плана — подземелья, тесты — боссы, разгрузочные недели — таверна: серия не рвётся, а первый бой после таверны даёт +${G.XP_TAVERN_BUFF} бодрости.</p>
  <p>За достижения, новые титулы и первое убийство каждого вида монстров дают награды — их забирают в Летописи. Бафы действуют несколько дней с того дня, как награду забрали: ${Object.values(G.BUFFS).map(b => `${b.name} — ${b.desc}`).join(", ")}. Тот же баф ещё раз продлевает срок. Часть достижений вместо награды даёт почётный титул: его эффект работает, пока титул надет, носить можно один. Изученный вид монстров даёт +${Math.round(G.STUDY * 100)}% опыта в боях с ним. За самые трудные достижения и титул «Легенда» — уникальные вещи: +1 к характеристике и два особых эффекта. Всё действует с того дня, как награду забрали.</p></div>
  <p style="margin:24px 0"><a href="#/settings" class="act" style="display:grid;place-items:center;text-decoration:none;color:var(--bone)">НАСТРОЙКИ И СОХРАНЕНИЕ</a></p>`;
  main.innerHTML = h;
}

// =====================================================================
// ЛЕТОПИСЬ: достижения, бестиарий, титулы
// =====================================================================
function renderChronicle() {
  const s = SUM, rw = Object.fromEntries(s.rewards.map(r => [r.id, r]));
  // Состояние награды: забрана, ждёт или ещё закрыта.
  const tag = r => !r ? "" : r.at ? `<em class="rw got">${esc(r.text)} · получено</em>` : r.open ? `<button class="claim" data-claim="${r.id}">забрать: ${esc(r.text)}</button>` : `<em class="rw">награда: ${esc(r.text)}</em>`;
  const ready = s.rewards.filter(r => r.open && !r.at);
  let h = `<p class="lead">Летопись</p><p class="sub">Достижений: ${s.achievements.filter(a => a.got).length} из ${s.achievements.length} · убито монстров: ${s.kills}.${buffsText(s)}</p>`;
  if (ready.length) h += `<h2 class="sec">НАГРАДЫ ЖДУТ</h2><ul class="list rewards">${ready.map(r => `<li><span><b>${esc(r.name)}</b><small>${esc(r.text)}</small></span><button class="ghostbtn" data-claim="${r.id}">забрать</button></li>`).join("")}</ul>
  ${ready.length > 1 ? `<button class="act gold" id="claimAll">ЗАБРАТЬ ВСЁ · ${ready.length}</button>` : ""}`;
  h += `<h2 class="sec">ДОСТИЖЕНИЯ</h2><div class="ach">${s.achievements.map(a => `<div class="${a.got ? "got" : ""} ${rw["a:" + a.id]?.reward.item ? "hard" : ""}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>${tag(rw["a:" + a.id])}</div>`).join("")}</div>
  <h2 class="sec">БЕСТИАРИЙ</h2><p class="sub">Первое убийство открывает вид. Забери запись — и бои с ним дают +${Math.round(G.STUDY * 100)}% опыта.</p><div class="beasts">`;
  for (const m of Object.values(G.MONSTERS)) {
    if (m.tavern) continue;
    const k = s.killed[m.id] || 0, r = rw["m:" + m.id];
    const st = r?.at ? "изучен" : k ? `<button class="claim" data-claim="${r.id}">изучить</button>` : "";
    h += `<div class="beast ${k ? "" : "unseen"} ${r?.at ? "studied" : ""}"><div class="pic"><img src="${m.img}" alt="" loading="lazy"></div><b>${k || !m.placeholder ? esc(m.name) : "???"}</b><span>${k ? "убит ×" + k : m.boss ? "босс" : "не встречен"}</span>${st ? `<span class="st">${st}</span>` : ""}</div>`;
  }
  // Элита: отдельная строка бестиария на каждый вид, трофей — просто в коллекцию.
  h += `</div><h2 class="sec">ЭЛИТА И ТРОФЕИ</h2><p class="sub">Иногда монстр приходит матёрым: на уровень выше, ×${G.ELITE_KILL} опыта за убийство, ×${G.ELITE_GOLD} золота и трофей. Убито элиты: ${s.eliteKills}.</p><div class="beasts">`;
  for (const id of G.ELITE_SPECIES) {
    const m = G.eliteOf(G.MONSTERS[id]), k = s.eliteKilled[id] || 0;
    h += `<div class="beast elite ${k ? "" : "unseen"}"><div class="pic"><img src="${m.img}" alt="" loading="lazy"></div><b>${k ? esc(m.name) : "???"}</b><span>${k ? "убит ×" + k : "не встречен"}</span>${k ? `<span class="st">${esc(m.trophy)}</span>` : ""}</div>`;
  }
  // Почётные титулы: получены за достижения, носится один. Пустой id — снова носить титул уровня.
  h += `</div><h2 class="sec">ПОЧЁТНЫЕ ТИТУЛЫ</h2><p class="sub">Даются вместо награды за некоторые достижения. Эффект работает, пока титул надет.</p><ul class="list titles">${Object.entries(G.HONOR).map(([id, t]) => {
    const own = s.honors.includes(id), worn = s.honor === id;
    return `<li class="${own ? "" : "locked"}"><span><b>${esc(t.name)}</b><small>${esc(t.desc)} · за «${esc(s.achievements.find(a => a.id === id).name)}»</small></span>${worn ? `<button class="ghostbtn" data-wear="">снять</button>` : own ? `<button class="ghostbtn" data-wear="${id}">надеть</button>` : `<em>закрыт</em>`}</li>`;
  }).join("")}</ul>`;
  h += `<h2 class="sec">ТИТУЛЫ УРОВНЯ</h2><ul class="list titles">${G.TITLES.map((t, i) => { const r = rw["t:" + i]; return `<li class="${r?.reward.item ? "hard" : ""}"><span><b>${esc(t)}</b><small>с ${i * 2 + 1} уровня${s.title === t ? " · сейчас" : ""}</small></span>${r ? (r.at ? `<em>${esc(r.text)} · получено</em>` : r.open ? `<button class="ghostbtn" data-claim="${r.id}">забрать</button>` : `<em>${esc(r.text)}</em>`) : ""}</li>`; }).join("")}</ul>
`;
  main.innerHTML = h;
}
function wear(id, quiet) {
  const m = S.meta.honor ||= { log: [] }, t = todayISO(), last = m.log[m.log.length - 1];
  if (last?.at === t) last.id = id; else m.log.push({ at: t, id });
  if (!quiet) { touchMeta(); recompute(); }
}
// Забрать награды: запись в журнал наград с сегодняшней датой — с неё начинают действовать бафы и вещи.
function claim(ids) {
  const m = S.meta.rewards ||= { log: [] }, have = new Set(m.log.map(e => e.id));
  ids = ids.filter(id => !have.has(id));
  if (!ids.length) return;
  for (const id of ids) m.log.push({ at: todayISO(), id });
  // Первый полученный почётный титул надевается сам.
  const hon = ids.map(G.rewardOf).find(r => r.honor);
  if (hon && !SUM.honor) wear(hon.honor, true);
  touchMeta(); recompute(); renderTop(); renderChronicle();
  const items = ids.map(G.rewardOf).filter(r => r.item).map(r => G.UNIQUE[r.item].name);
  toast(ids.length === 1 ? `Получено: ${G.rewardText(G.rewardOf(ids[0]), ids[0])}` : `Забрано наград: ${ids.length}${items.length ? ` · уникальные вещи: ${items.join(", ")}` : ""}`);
}
main.addEventListener("click", e => {
  if (route().tab !== "chronicle") return;
  const c = e.target.closest("[data-claim]");
  if (c) { claim([c.dataset.claim]); return; }
  const w = e.target.closest("[data-wear]");
  if (w) { wear(w.dataset.wear); renderTop(); renderChronicle(); return; }
  if (e.target.closest("#claimAll")) claim(SUM.rewards.filter(r => r.open && !r.at).map(r => r.id));
});

// ---------- билд: характеристики, древо, снаряжение ----------
let treeTab = "str";
function buildHTML(s) {
  const a = s.build.alloc, eff = s.build.stats, prev = prevAlloc();
  let h = `<h2 class="sec">ХАРАКТЕРИСТИКИ</h2><p class="sub">Свободных очков: <b class="gold">${s.free}</b> из ${s.points} (уровни + боссы).</p><div class="build">`;
  for (const st of G.STATS) {
    const v = a.stats[st.id], bonus = eff[st.id] - v, canDown = v > prev.stats[st.id];
    h += `<div class="stat"><div class="row"><b>${st.name}</b><button data-st="${st.id}" data-d="-1" ${canDown ? "" : "disabled"} aria-label="Убрать очко">−</button><span class="v">${eff[st.id]}</span><button data-st="${st.id}" data-d="1" ${s.free > 0 ? "" : "disabled"} aria-label="Добавить очко">+</button></div>
      <small>${esc(st.per)} за очко${bonus ? ` · ${v} вложено, +${bonus} от узлов и вещей` : ""}${st.id === "lck" ? `<br>Сейчас: находка ${Math.round(s.findNow.find * 100)}%${s.findNow.rare ? `, из них редких ${Math.round(s.findNow.rare * 100)}%` : ""}. Сверх ${Math.round(G.FIND_MAX * 100)}% излишок идёт в шанс редкой находки.` : ""}</small></div>`;
  }
  h += `</div><h2 class="sec">ДРЕВО НАВЫКОВ</h2><p class="sub">Очков навыка: <b class="gold">${s.skillFree}</b> из ${s.skillPoints} (1 за уровень). Узел открывается, когда взяты те, что над ним. Из двух вершин — только одна.</p>
  <div class="ttabs">${G.STATS.map(st => `<button data-tt="${st.id}" aria-current="${treeTab === st.id}">${st.name}</button>`).join("")}</div>${treeHTML(s, treeTab)}`;
  h += gearHTML(s) + shopHTML(s);
  const can = G.canRespec(S.meta, todayISO());
  if (s.spent || s.skillSpent) h += can ? `<button class="act" id="respec">СБРОСИТЬ ОЧКИ И ДРЕВО</button><p class="hint">Сброс — один раз за блок. Снаряжение не снимается, полученный опыт не пересчитывается.</p>` : `<p class="hint">Сброс в этом блоке уже использован. Вложенное сегодня можно вернуть.</p>`;
  return h;
}
function treeHTML(s, st) {
  const taken = s.build.alloc.nodes, eff = s.build.nodes, prev = prevAlloc().nodes;
  const rows = [0, 1, 2, 3].map(r => G.TREE[st].filter(n => n.row === r));
  return `<div class="tree">${rows.map((ns, r) => `<div class="trow r${r}">${ns.map(n => {
    const own = taken.includes(n.id), fromGear = !own && eff.includes(n.id);
    const can = !own && s.skillFree > 0 && G.canTakeNode(taken, n.id);
    // Вернуть можно узел, взятый сегодня, если от него ничего не зависит.
    const undo = own && !prev.includes(n.id) && !taken.some(x => G.NODE_BY_ID[x].req.includes(n.id));
    const cls = [n.kind, n.col, own || fromGear ? "on" : can ? "pick" : "off", fromGear ? "gear" : ""].join(" ");
    return `<button class="node ${cls}" data-node="${n.id}" ${can || undo ? "" : "disabled"}><b>${esc(n.name)}</b><small>${esc(n.desc)}${fromGear ? " · от вещи" : ""}</small></button>`;
  }).join("")}</div>`).join("")}</div>`;
}
const RARITY = { common: "обычная", rare: "редкая", unique: "уникальная", legendary: "легендарная", mythic: "мифическая" };
// Активные бафы: «Вдохновение — ещё 5 дн.»; если баф начнётся позже (продление очереди), показываем дату.
const buffsText = s => s.buffs.length ? ` ${s.buffs.map(b => `<b class="gold">${esc(b.name)}</b> ${b.from > todayISO() ? `с ${fmt(b.from)}` : `ещё ${b.left} дн.`}`).join(", ")}` : "";
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
function gearHTML(s) {
  const eq = s.build.eq, inv = s.inventory;
  let h = `<h2 class="sec">СНАРЯЖЕНИЕ</h2><div class="slots">${G.SLOTS.map(sl => {
    const it = eq[sl.id] && G.itemOf(eq[sl.id]);
    return `<div class="slot ${it ? it.rarity : "empty"}"><span>${sl.name}</span>${it ? `<b>${esc(it.name)}</b><small>${esc(G.itemText(it))}</small><button class="ghostbtn" data-unequip="${sl.id}">снять</button>` : "<b>пусто</b>"}</div>`;
  }).join("")}</div>`;
  if (!inv.length) return h + `<p class="hint">Вещи падают с находок (шанс растёт с Удачей) и всегда — с боссов.</p>`;
  h += `<ul class="list inv">${inv.slice().reverse().map(it => {
    const on = eq[it.slot] === it.id;
    return `<li class="${it.rarity}"><span><b>${esc(it.name)}</b><small>${G.SLOTS.find(x => x.id === it.slot).name} · ${RARITY[it.rarity]} · ${fmt(it.date)}<br>${esc(G.itemText(it))}</small></span>${on ? "<em>надето</em>" : `<button class="ghostbtn" data-equip="${it.id}">надеть</button>`}</li>`;
  }).join("")}</ul>`;
  return h;
}
// ---------- торговец и кузница ----------
let shopSlot = "weapon", shopStat = "str", forgeSel = [];
function shopHTML(s) {
  const b = s.build, gold = s.gold;
  const pc = G.priceOf(G.PRICE_COMMON, b), fee = G.priceOf(G.FORGE_FEE, b), myth = G.priceOf(G.MYTHIC_COST, b);
  const preview = G.itemOf(`s:${shopSlot}:${shopStat}:0`);
  let h = `<h2 class="sec">ТОРГОВЕЦ</h2><p class="sub">Золото: <b class="gold">${gold}</b> · всего добыто ${s.goldEarned}. Золото дают только убийства.</p>
  <div class="ttabs s4">${G.SLOTS.map(sl => `<button data-sslot="${sl.id}" aria-current="${shopSlot === sl.id}">${sl.name}</button>`).join("")}</div>
  <div class="ttabs">${G.STATS.map(st => `<button data-sstat="${st.id}" aria-current="${shopStat === st.id}">${st.name}</button>`).join("")}</div>
  <button class="act ${gold >= pc ? "gold" : ""}" id="buy" ${gold >= pc ? "" : "disabled"}>КУПИТЬ · ${pc} з.</button>
  <p class="hint">${esc(preview.name)}: ${esc(G.itemText(preview))}. Торговец продаёт только обычные вещи.</p>`;
  // Кузница: две обычные вещи одного слота + плата → редкая с их характеристиками (без узла).
  const commons = s.inventory.filter(it => it.rarity === "common");
  forgeSel = forgeSel.filter(id => commons.some(it => it.id === id));
  h += `<h2 class="sec">КУЗНИЦА</h2><p class="sub">Выбери две обычные вещи одного слота — кузнец скуёт из них редкую с обеими характеристиками. Плата ${fee} з. Легендарную сковать нельзя.</p>`;
  if (commons.length < 2) h += `<p class="hint">Нужно хотя бы две обычные вещи.</p>`;
  else {
    const selSlot = forgeSel.length && G.itemOf(forgeSel[0]).slot;
    h += `<ul class="list inv forge">${commons.map(it => {
      const on = forgeSel.includes(it.id), can = on || (forgeSel.length < 2 && (!selSlot || selSlot === it.slot));
      return `<li class="${on ? "sel" : ""}"><span><b>${esc(it.name)}</b><small>${G.SLOTS.find(x => x.id === it.slot).name} · ${esc(G.itemText(it))}${b.eq[it.slot] === it.id ? " · надето" : ""}</small></span><button class="ghostbtn" data-fsel="${it.id}" ${can ? "" : "disabled"}>${on ? "убрать" : "в горн"}</button></li>`;
    }).join("")}</ul>`;
    if (forgeSel.length === 2) {
      const out = G.itemOf(forgeId(forgeSel));
      h += `<button class="act ${gold >= fee ? "gold" : ""}" id="forge" ${gold >= fee ? "" : "disabled"}>СКОВАТЬ · ${fee} з.</button><p class="hint">Выйдет: ${esc(out.name)}, ${esc(G.itemText(out))}.</p>`;
    }
  }
  const legs = s.inventory.filter(it => it.rarity === "legendary");
  h += `<p class="sub" style="margin-top:14px">Пробуждение: легендарная вещь становится мифической (+5 к характеристике, усиленный эффект). Только из своей легендарки, ${myth} з.</p>`;
  h += legs.length ? `<ul class="list inv">${legs.map(it => { const M = G.itemOf("M:" + it.id); return `<li class="mythic"><span><b>${esc(it.name)} → ${esc(M.name)}</b><small>${esc(G.itemText(M))}</small></span><button class="ghostbtn" data-myth="${it.id}" ${gold >= myth ? "" : "disabled"}>пробудить</button></li>`; }).join("")}</ul>` : `<p class="hint">Легендарки пока нет — она падает только с боссов.</p>`;
  return h;
}
function forgeId(ids) {
  const [a, b] = ids.map(G.itemOf), n = (S.meta.shop?.log || []).length;
  return `f:${a.slot}:${Object.keys(a.stats)[0]}:${Object.keys(b.stats)[0]}:${n}`;
}
// Запись в журнал лавки. Если израсходованная вещь была надета, на её место сразу надевается новая.
function shopAct(act, id, use, cost) {
  if (SUM.gold < cost) return;
  const m = S.meta.shop ||= { log: [] };
  m.log.push({ at: todayISO(), act, id, use, cost });
  const eqNow = G.gearAt(S.meta, "9999-12-31"), slot = G.itemOf(id).slot;
  if (use.some(u => eqNow[slot] === u)) { const [g] = todayEntry("gear", () => ({ eq: eqNow })); g.eq[slot] = id; }
  saveHero();
}

// Что было вложено до сегодняшнего дня: сегодняшние изменения можно откатить без сброса. После сброса сегодня пол нулевой.
function prevAlloc() {
  const log = S.meta.build?.log || [], last = log[log.length - 1];
  return last?.at === todayISO() && last.respec ? G.allocAt({}, "") : G.allocAt(S.meta, G.addDays(todayISO(), -1));
}
function todayEntry(key, init) {
  const t = todayISO(), m = S.meta[key] ||= { log: [] };
  let e = m.log[m.log.length - 1];
  if (!e || e.at !== t) { e = { at: t, ...init() }; m.log.push(e); }
  return [e, m];
}
function saveHero() { touchMeta(); recompute(); renderTop(); renderHero(); }
main.addEventListener("click", e => {
  if (route().tab !== "hero") return;
  const tt = e.target.closest("[data-tt]");
  if (tt) { treeTab = tt.dataset.tt; renderHero(); return; }
  const st = e.target.closest("[data-st]");
  if (st) {
    const d = +st.dataset.d, k = st.dataset.st;
    if (d > 0 && SUM.free <= 0) return;
    const [b] = todayEntry("build", () => { const a = G.allocAt(S.meta, "9999-12-31"); return { stats: a.stats, nodes: a.nodes }; });
    b.stats[k] = Math.max(prevAlloc().stats[k], b.stats[k] + d);
    saveHero(); return;
  }
  const nd = e.target.closest("[data-node]");
  if (nd) {
    const id = nd.dataset.node;
    const [b] = todayEntry("build", () => { const a = G.allocAt(S.meta, "9999-12-31"); return { stats: a.stats, nodes: a.nodes }; });
    if (b.nodes.includes(id)) b.nodes = b.nodes.filter(x => x !== id);
    else if (SUM.skillFree > 0 && G.canTakeNode(b.nodes, id)) b.nodes.push(id);
    saveHero(); return;
  }
  const eq = e.target.closest("[data-equip]"), uq = e.target.closest("[data-unequip]");
  if (eq || uq) {
    const [g] = todayEntry("gear", () => ({ eq: G.gearAt(S.meta, "9999-12-31") }));
    if (eq) g.eq[G.itemOf(eq.dataset.equip).slot] = eq.dataset.equip; else delete g.eq[uq.dataset.unequip];
    saveHero(); return;
  }
  const ss = e.target.closest("[data-sslot]"), sst = e.target.closest("[data-sstat]");
  if (ss || sst) { if (ss) shopSlot = ss.dataset.sslot; else shopStat = sst.dataset.sstat; renderHero(); return; }
  if (e.target.closest("#buy")) {
    const cost = G.priceOf(G.PRICE_COMMON, SUM.build), it = G.itemOf(`s:${shopSlot}:${shopStat}:${(S.meta.shop?.log || []).length}`);
    if (confirm(`Купить «${it.name}» за ${cost} золота?`)) { shopAct("buy", it.id, [], cost); toast(`Куплено: ${it.name}`); }
    return;
  }
  const fs = e.target.closest("[data-fsel]");
  if (fs) { const id = fs.dataset.fsel; forgeSel = forgeSel.includes(id) ? forgeSel.filter(x => x !== id) : [...forgeSel, id].slice(0, 2); renderHero(); return; }
  if (e.target.closest("#forge") && forgeSel.length === 2) {
    const id = forgeId(forgeSel), cost = G.priceOf(G.FORGE_FEE, SUM.build);
    if (confirm(`Сковать «${G.itemOf(id).name}»? Две вещи уйдут в горн, плата ${cost} золота.`)) { const use = forgeSel; forgeSel = []; shopAct("forge", id, use, cost); toast(`Скована: ${G.itemOf(id).name}`); }
    return;
  }
  const my = e.target.closest("[data-myth]");
  if (my) {
    const id = "M:" + my.dataset.myth, cost = G.priceOf(G.MYTHIC_COST, SUM.build);
    if (confirm(`Пробудить легендарку за ${cost} золота? Она станет «${G.itemOf(id).name}».`)) { shopAct("mythic", id, [my.dataset.myth], cost); toast(`Пробуждена: ${G.itemOf(id).name}`); }
    return;
  }
  if (e.target.closest("#respec")) {
    if (!confirm("Сбросить все очки характеристик и древо? В этом блоке сброс больше не будет доступен.")) return;
    const [b, bm] = todayEntry("build", () => ({}));
    Object.assign(b, { stats: { str: 0, end: 0, agi: 0, wil: 0, lck: 0 }, nodes: [], respec: true });
    (bm.respecs ||= []).push(G.weekOf(todayISO()).block);
    saveHero();
  }
});

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
  <h2 class="sec">ГЕРОЙ</h2>
  <div class="set-form"><label>Вес тела, кг<input id="cfgBw" inputmode="decimal" value="${esc(S.meta.bodyweight || "")}" placeholder="96"></label></div>
  <p class="help">Нужен, чтобы честно пересчитывать урон в упражнениях со своим весом: убрал резинку или повесил гирю — каждый повтор стоит больше. Пока не указан, считается 96 кг.</p>
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
  $("#cfgBw").onchange = e => { const v = e.target.value.trim().replace(",", "."); S.meta.bodyweight = v ? +v || null : null; touchMeta(); recompute(); renderTop(); toast("Вес тела сохранён"); };
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
// Подсказки названий для своих упражнений: те же имена, что в плане, — тогда рекорды и графики общие.
document.body.insertAdjacentHTML("beforeend", `<datalist id="exNames">${[...new Set(G.DAYS.flatMap(d => d.items.filter(i => i.type === "ex" && !/^ТЕСТ/i.test(i.name)).map(i => i.name.replace(/\s*\(.*?\)\s*/g, " ").trim())))].sort().map(n => `<option value="${esc(n)}">`).join("")}</datalist>`);
recompute(); renderTop(); renderSync(); render();
if (S.cfg.token) runSync().then(() => { recompute(); renderTop(); if (route().tab !== "settings" && sheet.hidden) render(); });
else scheduleSync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
