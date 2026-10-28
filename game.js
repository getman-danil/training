// Игровая логика: монстры, урон, опыт, рекорды, серии, достижения.
// Чистые функции без DOM — всё считается из плана и журнала, ничего игрового не хранится отдельно.
import { PLAN } from "./plan.js";

export const DMG = 30;              // урон за один плановый подход, выполненный полностью
export const MAX_SETS_HP = 5;       // упражнение с кучей подходов (EMOM на 20 минут) весит не больше пяти обычных
export const OVERKILL_CAP = 0.2;    // перевыполнение даёт бонусный опыт не больше 20% здоровья
export const XP_PER_HP = 0.25;      // опыт за урон: 4 единицы здоровья = 1 опыт
export const XP_KILL = 100, XP_PR = 25, XP_CARDIO = 30, XP_TAVERN_BUFF = 50, XP_REVENGE = 50;
export const REVENGE_WINDOW = 14;   // сбежавший монстр возвращается, если следующая тренировка не позже чем через 14 дней
export const FREEZES = 3;           // ручных заморозок серии на весь план

// ---------- монстры ----------
const M = (id, name, file, extra = {}) => ({ id, name, img: `assets/monsters/${file}.webp`, ...extra });
export const MONSTERS = {
  "goblin-raider": M("goblin-raider", "Гоблин-налётчик", "goblin-raider"),
  "goblin-archer": M("goblin-archer", "Гоблин-лучник", "goblin-archer"),
  "goblin-shaman": M("goblin-shaman", "Гоблин-шаман", "goblin-shaman"),
  "goblin-chief": M("goblin-chief", "Грызь, вожак стаи", "goblin-chief"),
  "undead-skeleton": M("undead-skeleton", "Скелет-страж", "undead-skeleton"),
  "undead-ghoul": M("undead-ghoul", "Упырь", "undead-ghoul"),
  "undead-wraith": M("undead-wraith", "Призрак", "undead-wraith"),
  "orc-grunt": M("orc-grunt", "Орк-рубака", "orc-grunt"),
  "orc-berserker": M("orc-berserker", "Орк-берсерк", "orc-berserker"),
  "orc-warg-rider": M("orc-warg-rider", "Наездник варга", "orc-warg-rider"),
  "dragon-drake": M("dragon-drake", "Драконид", "dragon-drake"),
  "dragon-wyvern": M("dragon-wyvern", "Виверна", "dragon-wyvern"),
  // Картинки боссов и хозяина таверны появятся позже: пока силуэт похожего монстра.
  "boss-goblin-king": M("boss-goblin-king", "Король гоблинов", "goblin-chief", { boss: true, placeholder: true }),
  "boss-orc-warlord": M("boss-orc-warlord", "Вождь орков", "orc-berserker", { boss: true, placeholder: true }),
  "boss-ancient-dragon": M("boss-ancient-dragon", "Древний дракон", "dragon-wyvern", { boss: true, placeholder: true }),
  "tavern-keeper": M("tavern-keeper", "Хозяин таверны", "", { tavern: true, placeholder: true, img: null }),
};

export const DUNGEONS = {
  1: { name: "Логово гоблинов", pool: ["goblin-raider", "goblin-archer", "goblin-shaman"] },
  2: { name: "Склеп", pool: ["undead-skeleton", "undead-ghoul", "undead-wraith"] },
  3: { name: "Орочий лагерь", pool: ["orc-grunt", "orc-berserker", "orc-warg-rider"] },
  4: { name: "Драконьи горы", pool: ["dragon-drake", "dragon-wyvern", "dragon-drake"] },
  5: { name: "Тронный зал", pool: ["orc-grunt", "dragon-wyvern", "dragon-drake"] },
  6: { name: "Пепельные руины", pool: ["orc-berserker", "goblin-chief", "undead-wraith"] },
  7: { name: "Склеп (летняя сессия)", pool: ["undead-skeleton", "undead-ghoul", "undead-wraith"] },
  8: { name: "Орочий лагерь", pool: ["orc-grunt", "orc-berserker", "orc-warg-rider"] },
  9: { name: "Драконьи горы", pool: ["dragon-drake", "dragon-wyvern", "dragon-drake"] },
  10: { name: "Тронный зал", pool: ["orc-warg-rider", "dragon-wyvern", "dragon-drake"] },
};
const MINIBOSS_BY_DATE = { "2026-11-13": "goblin-chief" };
// Тесты по порядку: 20.11, 31.03, 03.04, а в конце года снова вождь орков и древний дракон.
const BOSS_ORDER = ["boss-goblin-king", "boss-orc-warlord", "boss-ancient-dragon", "boss-orc-warlord", "boss-ancient-dragon"];

// ---------- план ----------
export const DAYS = PLAN.flatMap(w => w.days.map(d => ({ ...d, week: w.n, block: w.block, blockN: +(/Блок (\d+)/.exec(w.block) || [0, 0])[1], on: d.date })));
export const WEEKS = PLAN.map(w => ({ ...w, days: DAYS.filter(d => d.week === w.n), onFrom: w.from, onTo: w.to }));
export const DAY_BY_DATE = Object.fromEntries(DAYS.map(d => [d.date, d]));

// ---------- переносы ----------
// day.date — дата по плану, она же id записи и не меняется никогда. day.on — когда тренировка стоит сейчас с учётом переносов.
// meta.shifts = [{ at: "<дата плана>", days: N, scope: "one" | "all" }]: «one» двигает одну тренировку, «all» — её и весь план после.
export const DOW_NAMES = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
export function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5); }
export function dowOf(iso) { return DOW_NAMES[new Date(iso + "T12:00:00Z").getUTCDay()]; }
export function applyShifts(shifts = []) {
  const offAll = date => shifts.reduce((a, s) => a + (s.scope !== "one" && date >= s.at ? s.days : 0), 0);
  for (const d of DAYS) d.on = addDays(d.date, offAll(d.date) + shifts.reduce((a, s) => a + (s.scope === "one" && s.at === d.date ? s.days : 0), 0));
  for (const w of WEEKS) {
    w.days.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
    const ons = w.days.map(d => d.on);
    w.onFrom = [addDays(w.from, offAll(w.from)), ...ons].sort()[0];
    w.onTo = [addDays(w.to, offAll(w.to)), ...ons].sort().pop();
  }
}
// План может расти (например, до 52 недель): боссы и таверны выводятся из самого плана, а не из дат.
// Тест = босс, по очереди; лёгкие/разгрузочные недели = таверна.
const BOSS_BY_DATE = {};
DAYS.filter(d => /ТЕСТ/.test(d.title)).forEach((d, k) => { BOSS_BY_DATE[d.date] = BOSS_ORDER[k % BOSS_ORDER.length]; });
export const TAVERN_WEEKS = new Set(PLAN.filter(w => /разгруз|л[её]гкая|отдых|восстановл/i.test(w.note || "")).map(w => w.n));
export function isBoss(day) { return !!BOSS_BY_DATE[day.date]; }

export function isCardio(day) { return !day.items.some(i => i.type === "ex"); }
export function isOptional(day) { return /по желанию/i.test(day.title); }

// Разбор строки плана в число подходов и целевые повторы.
export function parsePlan(item) {
  const p = item.plan || "";
  let m;
  if ((m = /(\d+)\s*мин\s*×\s*(\d+)/.exec(p))) return { sets: +m[1], target: +m[2], unit: "повт", emom: true };
  if ((m = /(\d+)\s*×\s*макс/.exec(p))) return { sets: +m[1], target: null, unit: "повт" };
  if (/^\d+\s*мин$/.test(p.trim())) return { sets: 1, target: null, unit: "кругов" };
  if ((m = /^подход\s*×\s*(\d+)/.exec(p))) return { sets: 1, target: +m[1], unit: "повт" };
  if ((m = /(\d+)\s*×\s*(\d+)\s*(с|мин)?/.exec(p))) {
    const unit = m[3] === "с" ? "сек" : m[3] === "мин" ? "мин" : "повт";
    return { sets: +m[1], target: +m[2], unit };
  }
  return { sets: item.sets || 1, target: null, unit: "повт" };
}

export function monsterFor(day) {
  if (isCardio(day)) return null;
  if (BOSS_BY_DATE[day.date]) return MONSTERS[BOSS_BY_DATE[day.date]];
  if (MINIBOSS_BY_DATE[day.date]) return MONSTERS[MINIBOSS_BY_DATE[day.date]];
  if (isTavern(day)) return MONSTERS["tavern-keeper"];
  if (REVENGE[day.date]) return MONSTERS[REVENGE[day.date].id];
  return planMonster(day);
}
function planMonster(day) {
  const pool = dungeon(day.blockN).pool;
  const t = day.title.trim();
  let k = t.startsWith("А") ? 0 : t.startsWith("Б") ? 1 : 2;
  if (pool[2] === pool[0] && k === 2) k = day.week % 2;   // в горах всего два дракона — чередуем
  return MONSTERS[pool[k]];
}
// ---------- реванш ----------
// Монстр, который сбежал раненым, приходит вместо монстра следующей обычной тренировки (не босс, не таверна,
// не кардио и не «по желанию»). Возвращается один раз: если сбежит снова — ушёл насовсем.
// Считается заново из записей, поэтому одинаково на всех устройствах. Ключ — дата дня в плане.
export let REVENGE = {};
function regular(d) { return !isCardio(d) && !isOptional(d) && !isTavern(d) && !BOSS_BY_DATE[d.date] && !MINIBOSS_BY_DATE[d.date]; }
export function fledOn(day, log, today) {
  if (!log || log.skipped) return false;
  const b = battle(day, log);
  return !b.killed && b.dealt > 0 && (!!log.finished || day.on < today);
}
export function computeRevenge(logs, today) {
  REVENGE = {};
  const days = DAYS.filter(d => !isCardio(d) && !isOptional(d)).sort((a, b) => a.on < b.on ? -1 : a.on > b.on ? 1 : 0);
  days.forEach((d, k) => {
    if (BOSS_BY_DATE[d.date] || isTavern(d) || !fledOn(d, logs[d.date], today)) return;
    if (REVENGE[d.date]) return;                      // вернувшийся монстр сбежал снова — больше не придёт
    const next = days.slice(k + 1).find(x => x.on > d.on);
    if (!next || !regular(next) || daysBetween(d.on, next.on) > REVENGE_WINDOW || logs[next.date]?.skipped) return;
    REVENGE[next.date] = { id: monsterFor(d).id, from: d.date };
  });
  return REVENGE;
}

export function isTavern(day) {
  if (BOSS_BY_DATE[day.date]) return false;
  return TAVERN_WEEKS.has(day.week) || /подводка/i.test(day.title);
}
export function locationFor(day) {
  if (BOSS_BY_DATE[day.date]) return "Логово босса";
  if (isTavern(day)) return "Таверна «Ржавая гиря»";
  return dungeon(day.blockN).name;
}
export function dungeon(n) { return DUNGEONS[n] || DUNGEONS[((n - 1) % 4) + 1] || DUNGEONS[1]; }

// ---------- бой ----------
// log: { items:[{reps:[...], weight, note}|{done}], finished, ... } — индекс совпадает с планом.
export function battle(day, log) {
  const exs = [];
  let hp = 0, dealt = 0, over = 0, setsDone = 0;
  day.items.forEach((it, i) => {
    if (it.type !== "ex") return;
    const pp = parsePlan(it);
    const reps = (log?.items?.[i]?.reps || []);
    const exHp = DMG * Math.min(pp.sets, MAX_SETS_HP), per = exHp / pp.sets;
    const lf = loadFactor(it, log?.items?.[i]);
    let d = 0, o = 0;
    reps.forEach((r, k) => {
      if (r == null || r === "") return;
      r = +r; if (!(r > 0)) return;
      setsDone++;
      const frac = pp.target ? r * lf / pp.target : lf;
      if (k < pp.sets) { d += per * Math.min(frac, 1); o += per * Math.max(frac - 1, 0); }
      else o += per * frac;
    });
    hp += exHp; dealt += d; over += o;
    exs.push({ i, pp, per, lf, dealt: d, over: o, hp: exHp });
  });
  dealt = Math.round(dealt); over = Math.round(over);
  const killed = hp > 0 && dealt >= hp - 0.5;
  const overXp = Math.round(Math.min(over, hp * OVERKILL_CAP));
  return { hp, dealt, left: Math.max(0, hp - dealt), over, overXp, killed, exs, setsDone, pct: hp ? dealt / hp : 0 };
}

// ---------- рекорды ----------
// «Отжимания на брусьях (основные)» и «ТЕСТ: отжимания на брусьях на максимум» — одно упражнение для рекордов.
export function normName(n) {
  return String(n || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/ё/g, "е").replace(/^тест:\s*/, "").replace(/\s+на (максимум|\d+ раза?)$/, "").replace(/\s+/g, " ").trim();
}
// Вес в кг для сравнения: «24 + 16» = 40, «+8 кг» = 8, «свой вес» = 0, резинка помогает — поэтому со знаком минус.
export function kg(w) {
  // «+20 кг (16+4)» — в скобках расшифровка, её не складываем; «махи 24–32 кг» — берём первое число.
  w = String(w || "").toLowerCase().replace(/\(.*?\)/g, "");
  const nums = w.split("+").map(p => /(\d+(?:[.,]\d+)?)/.exec(p)).filter(Boolean).map(m => parseFloat(m[1].replace(",", ".")));
  const sum = nums.reduce((a, b) => a + b, 0);
  return /резин/.test(w) ? -sum : sum;
}

// ---------- пересчёт урона под фактический вес ----------
// Повтор с другим весом стоит пропорционально поднятой нагрузке. В упражнениях со своим весом нагрузка = вес тела
// + отягощение − помощь резинки: убрал резинку 15 кг при весе 96 — каждый повтор весит 96/81 ≈ 1,19 планового.
export let BODYWEIGHT = 96;
export function setBodyweight(v) { v = parseFloat(String(v || "").replace(",", ".")); BODYWEIGHT = v >= 30 && v <= 250 ? v : 96; }
const bodyBased = w => /свой вес|резин/.test(w) || /^\s*\+/.test(w);
export function loadFactor(it, li) {
  const pw = String(it.weight || "").toLowerCase(), aw = String(li?.weight ?? it.weight ?? "").toLowerCase();
  if (!aw.trim() || aw.trim() === pw.trim()) return 1;
  let p, a;
  if (bodyBased(pw)) { p = BODYWEIGHT + kg(pw); a = BODYWEIGHT + (/свой вес/.test(aw) && !/\d/.test(aw) ? 0 : kg(aw)); }
  else { p = kg(pw); a = kg(aw); }
  if (!(p > 0) || !(a > 0)) return 1;
  return Math.min(Math.max(a / p, 0.25), 3);
}

// Проходит по журналу в хронологическом порядке и отмечает подходы-рекорды.
// Сравнение идёт с лучшим результатом до этого дня: подход, побивший прошлые тренировки, — крит.
// В список рекордов от одного упражнения за день попадает одна строка — с лучшим подходом дня.
export function computePRs(logs) {
  const bestReps = {}, bestKg = {}, prs = {}, list = [];
  const dates = Object.keys(logs).filter(d => DAY_BY_DATE[d]).sort();
  for (const date of dates) {
    const day = DAY_BY_DATE[date], L = logs[date];
    const updates = [];
    day.items.forEach((it, i) => {
      if (it.type !== "ex") return;
      const li = L.items?.[i]; if (!li) return;
      const name = normName(it.name), w = (li.weight ?? it.weight ?? "").trim().toLowerCase();
      const key = name + "|" + w, wk = kg(w);
      const preReps = bestReps[key], preKg = bestKg[name];
      const reps = (li.reps || []).map(Number).filter(r => r > 0);
      if (!reps.length) return;
      const newKg = preKg != null && wk > preKg;
      let dayBest = 0;
      (li.reps || []).forEach((r, k) => {
        r = +r; if (!(r > 0)) return;
        if (newKg || (preReps != null && r > preReps)) {
          (prs[date] ||= {})[i + ":" + k] = newKg ? { kind: "kg" } : { kind: "reps" };
          dayBest = Math.max(dayBest, r);
        }
      });
      if (dayBest) list.push(newKg
        ? { date, name: it.name, kind: "kg", text: `${li.weight || it.weight}: новый вес, лучший подход ${dayBest}` }
        : { date, name: it.name, kind: "reps", text: `${dayBest} повт. (было ${preReps})` });
      updates.push([key, name, Math.max(...reps), wk]);
    });
    for (const [key, name, r, wk] of updates) {
      bestReps[key] = Math.max(bestReps[key] ?? 0, r);
      bestKg[name] = Math.max(bestKg[name] ?? -Infinity, wk);
    }
  }
  return { prs, list, bestReps, bestKg };
}

// ---------- опыт и уровни ----------
export const TITLES = ["Странник", "Оруженосец", "Наёмник", "Страж", "Рыцарь", "Ветеран", "Чемпион", "Паладин", "Герой", "Легенда"];
export function xpForLevel(l) { return 200 + 100 * (l - 1); }
export function levelFromXp(xp) {
  let l = 1, rest = xp;
  while (rest >= xpForLevel(l)) { rest -= xpForLevel(l); l++; }
  return { level: l, into: rest, need: xpForLevel(l), title: TITLES[Math.min(TITLES.length - 1, Math.floor((l - 1) / 2))] };
}

// ---------- недели и серии ----------
export function weekGoal(w) { return w.days.filter(d => !isCardio(d) && !isOptional(d)).length; }
export function weekOf(dateISO) {
  return WEEKS.find(w => dateISO >= w.onFrom && dateISO <= w.onTo) || (dateISO < WEEKS[0].onFrom ? WEEKS[0] : WEEKS[WEEKS.length - 1]);
}
// Бой засчитан, если есть записи и он завершён — или день уже прошёл (перенос из тетради без кнопки «Завершить»).
// Пропущенный день (skipped) и пустой день просто не засчитываются: никаких других последствий.
function dayFinished(L, past) { return !!(L && !L.skipped && (L.finished || past) && L.items?.some(x => (x.reps || []).some(r => +r > 0) || x.done)); }

export function weekStatus(w, logs, meta, today) {
  const goal = weekGoal(w);
  const done = w.days.filter(d => !isCardio(d) && dayFinished(logs[d.date], d.on < today)).length;
  const tavern = TAVERN_WEEKS.has(w.n);
  const frozen = (meta.freezes || []).includes(w.n);
  let s;
  if (done >= goal && goal > 0) s = "ok";
  else if (today <= w.onTo) s = today >= w.onFrom ? "now" : "future";
  else if (tavern || frozen) s = "frozen";
  else s = "miss";
  return { n: w.n, goal, done, status: s, tavern, frozen };
}

export function streak(logs, meta, today) {
  const st = WEEKS.map(w => weekStatus(w, logs, meta, today));
  let cur = 0, best = 0, run = 0;
  for (const s of st) {
    if (s.status === "ok") { run++; best = Math.max(best, run); }
    else if (s.status === "miss") run = 0;
    else if (s.status === "future") break;
  }
  cur = run;
  return { cur, best, weeks: st };
}

// ---------- сводка героя ----------
export function summarize(logs, meta, today) {
  setBodyweight(meta?.bodyweight);
  const { prs, list: prList } = computePRs(logs);
  computeRevenge(logs, today);
  let revenges = 0;
  let xp = 0, kills = 0, fled = 0, cardio = 0, overkills = 0, nightOwl = 0;
  const killed = {}, bossKills = [], perDay = {};
  const tavernBuffWeeks = new Set();
  for (const d of DAYS) {
    const L = logs[d.date]; if (!L) continue;
    if (isCardio(d)) {
      if (L.items?.some(x => x.done) || L.finished) { xp += XP_CARDIO; cardio++; perDay[d.date] = { xp: XP_CARDIO }; }
      continue;
    }
    const b = battle(d, L), m = monsterFor(d);
    const nPR = Object.keys(prs[d.date] || {}).length;
    let dx = Math.round((b.dealt + b.overXp) * XP_PER_HP) + nPR * XP_PR;
    if (b.killed) { dx += XP_KILL * (m?.boss ? 3 : 1); kills++; killed[m.id] = (killed[m.id] || 0) + 1; if (m.boss) bossKills.push(m.id); if (b.over >= b.hp * OVERKILL_CAP) overkills++; if (REVENGE[d.date]) { dx += XP_REVENGE; revenges++; } }
    else if (L.finished && b.dealt > 0) fled++;
    // Бодрость после таверны: первый бой недели после разгрузки даёт бонус.
    if (b.dealt > 0 && TAVERN_WEEKS.has(d.week - 1) && !tavernBuffWeeks.has(d.week)) { tavernBuffWeeks.add(d.week); dx += XP_TAVERN_BUFF; }
    if (L.finishedAt && L.performedOn === L.finishedAt.slice(0, 10) && new Date(L.finishedAt).getHours() >= 22) nightOwl++;
    xp += dx; perDay[d.date] = { xp: dx, battle: b, prs: nPR };
  }
  const lv = levelFromXp(xp);
  const sk = streak(logs, meta, today);
  const ach = achievements({ revenges, kills, fled, cardio, prCount: prList.length, streakBest: sk.best, bossKills, killed, overkills, nightOwl, logs, level: lv.level, weeks: sk.weeks });
  return { xp, ...lv, revenges, kills, fled, cardio, killed, bossKills, prList, prs, perDay, streak: sk, achievements: ach };
}

function dungeonCleared(n, logs) {
  const ds = DAYS.filter(d => d.blockN === n && !isCardio(d) && !isOptional(d) && !isTavern(d) && !BOSS_BY_DATE[d.date]);
  // День засчитан, если монстр убит сразу или добит на реванше.
  const avenged = new Set(Object.entries(REVENGE).filter(([date]) => battle(DAY_BY_DATE[date], logs[date]).killed).map(([, r]) => r.from));
  return ds.length > 0 && ds.filter(d => battle(d, logs[d.date]).killed || avenged.has(d.date)).length >= Math.ceil(ds.length * 0.8);
}

export function achievements(s) {
  const A = (id, name, desc, got) => ({ id, name, desc, got: !!got });
  return [
    A("first-blood", "Первая кровь", "Убить первого монстра", s.kills >= 1),
    A("hunter", "Охотник", "Убить 10 монстров", s.kills >= 10),
    A("slayer", "Истребитель", "Убить 30 монстров", s.kills >= 30),
    A("crit", "Критический удар", "Поставить первый личный рекорд", s.prCount >= 1),
    A("crit10", "Мастер критов", "10 личных рекордов", s.prCount >= 10),
    A("revenge", "Реванш", "Добить сбежавшего монстра, когда он вернётся", s.revenges >= 1),
    A("revenge5", "Кровник", "Взять реванш 5 раз", s.revenges >= 5),
    A("overkill", "Перебор", "Перевыполнить тренировку на 20%", s.overkills >= 1),
    A("streak4", "Месяц без пропусков", "Серия 4 недели", s.streakBest >= 4),
    A("streak8", "Железная воля", "Серия 8 недель", s.streakBest >= 8),
    A("streak16", "Несгибаемый", "Серия 16 недель", s.streakBest >= 16),
    A("cardio10", "Гонец", "Пройти 10 патрулей", s.cardio >= 10),
    A("night", "Ночная смена", "Закончить бой после 22:00", s.nightOwl >= 1),
    A("d1", "Логово зачищено", "Убить 80% монстров блока 1", dungeonCleared(1, s.logs)),
    A("d2", "Склеп запечатан", "Пережить сессию: 80% боёв блока 2", dungeonCleared(2, s.logs)),
    A("d3", "Лагерь сожжён", "80% монстров блока 3", dungeonCleared(3, s.logs)),
    A("d4", "Повелитель гор", "80% монстров блока 4", dungeonCleared(4, s.logs)),
    A("boss1", "Цареубийца", "Победить Короля гоблинов (тест 20.11)", s.bossKills.includes("boss-goblin-king")),
    A("boss2", "Гроза орков", "Победить Вождя орков (тест 31.03)", s.bossKills.includes("boss-orc-warlord")),
    A("boss3", "Драконоборец", "Победить Древнего дракона (тест 03.04)", s.bossKills.includes("boss-ancient-dragon")),
    A("d6", "Руины очищены", "80% монстров блока 6", dungeonCleared(6, s.logs)),
    A("d7", "Вторая сессия", "Пережить летнюю сессию: 80% боёв блока 7", dungeonCleared(7, s.logs)),
    A("d9", "Пик года", "80% монстров блока 9", dungeonCleared(9, s.logs)),
    A("streak26", "Полгода в строю", "Серия 26 недель", s.streakBest >= 26),
    A("bossAll", "Год побед", "Победить всех пятерых боссов тестов", s.bossKills.length >= 5),
    A("lvl5", "Закалённый", "Достичь 5 уровня", s.level >= 5),
    A("lvl10", "Живая легенда", "Достичь 10 уровня", s.level >= 10),
  ];
}
