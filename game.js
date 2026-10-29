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
// Уровень монстра = уровень, который был бы у героя, идущего ровно по плану, ± место в стае (−1…+1).
// Отстал — монстры выше тебя и дают больше опыта; обогнал — меньше. Так кривая сама подтягивается к плану.
export const HP_PER_LVL = 0.2;      // каждый уровень монстра добавляет 20% к его здоровью и к цифрам урона по нему
export const BOSS_HP = 6;           // в тестах мало подходов, поэтому у боссов отдельный множитель
export const LVL_XP_STEP = 0.08, LVL_XP_MIN = 0.75, LVL_XP_MAX = 1.4;
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
function packIndex(day) {
  const pool = dungeon(day.blockN).pool;
  const t = day.title.trim();
  let k = t.startsWith("А") ? 0 : t.startsWith("Б") ? 1 : 2;
  if (pool[2] === pool[0] && k === 2) k = day.week % 2;   // в горах всего два дракона — чередуем
  return k;
}
function planMonster(day) { return MONSTERS[dungeon(day.blockN).pool[packIndex(day)]]; }
// Ожидаемый уровень героя на каждый день плана: всё сделано ровно по плану, без перков и бонусов.
let EXP_LVL = null;
function expectedLevel(day) {
  if (!EXP_LVL) {
    EXP_LVL = {}; let xp = 0;
    const buff = new Set();
    // Рост повторов по плану сам рождает рекорды — их тоже учитываем, иначе герой всегда будет впереди монстров.
    const ideal = Object.fromEntries(DAYS.filter(d => !isCardio(d)).map(d => [d.date, { items: d.items.map(it => it.type === "ex" ? { reps: Array(parsePlan(it).sets).fill(parsePlan(it).target || 1), weight: it.weight || "" } : {}) }]));
    const { prs } = computePRs(ideal);
    for (const d of DAYS) {
      const lvl = EXP_LVL[d.date] = levelFromXp(xp).level;
      if (isCardio(d)) { xp += XP_CARDIO; continue; }
      const hp = d.items.filter(i => i.type === "ex").reduce((a, i) => a + DMG * Math.min(parsePlan(i).sets, MAX_SETS_HP), 0);
      const off = BOSS_BY_DATE[d.date] ? 3 : MINIBOSS_BY_DATE[d.date] ? 2 : isTavern(d) ? 0 : packIndex(d) - 1;
      xp += (hp * XP_PER_HP + XP_KILL * (BOSS_BY_DATE[d.date] ? 3 : 1)) * levelXpMod(Math.max(1, lvl + off), lvl, { nodes: [] }) + Object.keys(prs[d.date] || {}).length * XP_PR;
      if (TAVERN_WEEKS.has(d.week - 1) && !buff.has(d.week)) { buff.add(d.week); xp += XP_TAVERN_BUFF; }
    }
  }
  return EXP_LVL[day.date] || 1;
}

// Уровень монстра дня. Вернувшийся на реванш монстр озлоблен: на уровень выше, чем был.
export function monsterLevel(day) {
  if (isCardio(day)) return 0;
  const base = expectedLevel(day);
  if (BOSS_BY_DATE[day.date]) return base + 3;
  if (MINIBOSS_BY_DATE[day.date]) return base + 2;
  if (isTavern(day)) return base;
  if (REVENGE[day.date]) return monsterLevel(DAY_BY_DATE[REVENGE[day.date].from]) + REVENGE[day.date].n;
  return Math.max(1, base - 1 + packIndex(day));
}
export function hpMult(day) {
  if (isCardio(day)) return 1;
  return (1 + HP_PER_LVL * (monsterLevel(day) - 1)) * (BOSS_BY_DATE[day.date] ? BOSS_HP : 1);
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
export function computeRevenge(logs, today, meta = {}) {
  REVENGE = {};
  const days = DAYS.filter(d => !isCardio(d) && !isOptional(d)).sort((a, b) => a.on < b.on ? -1 : a.on > b.on ? 1 : 0);
  days.forEach((d, k) => {
    if (BOSS_BY_DATE[d.date] || isTavern(d) || !fledOn(d, logs[d.date], today)) return;
    const bd = buildAt(meta, whenOf(d, logs[d.date]));
    const prev = REVENGE[d.date];
    if (prev && prev.n >= (hasPerk(bd, "headhunter") ? 2 : 1)) return;   // вернувшийся монстр сбежал снова — больше не придёт
    const next = days.slice(k + 1).find(x => x.on > d.on);
    if (!next || !regular(next) || daysBetween(d.on, next.on) > REVENGE_WINDOW + bd.stats.wil || logs[next.date]?.skipped) return;
    REVENGE[next.date] = { id: monsterFor(d).id, from: prev ? prev.from : d.date, n: prev ? prev.n + 1 : 1 };
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
  const mult = hpMult(day), replaced = !!log?.replaced;
  day.items.forEach((it, i) => {
    if (it.type !== "ex") return;
    const pp = parsePlan(it);
    const reps = replaced ? [] : (log?.items?.[i]?.reps || []);
    const exHp = DMG * Math.min(pp.sets, MAX_SETS_HP) * mult, per = exHp / pp.sets;
    // Заменённое упражнение (li.sub): повторы сравниваются с плановыми, вес не пересчитывается, урон — до SUB_CAP.
    const sub = !!String(log?.items?.[i]?.sub || "").trim();
    const lf = sub ? 1 : loadFactor(it, log?.items?.[i]);
    let d = 0, o = 0;
    reps.forEach((r, k) => {
      if (r == null || r === "") return;
      r = +r; if (!(r > 0)) return;
      setsDone++;
      const frac = pp.target ? r * lf / pp.target : lf;
      if (k < pp.sets) { d += per * Math.min(frac, 1); o += per * Math.max(frac - 1, 0); }
      else o += per * frac;
    });
    if (sub) d = Math.min(d, exHp * SUB_CAP);
    hp += exHp; dealt += d; over += o;
    exs.push({ i, pp, per, lf, sub, dealt: d, over: o, hp: exHp, heavy: isHeavy(it, log?.items?.[i]) });
  });
  // Свои упражнения: каждый подход стоит одного обычного планового. При замене это урон, но не больше REPLACE_CAP
  // здоровья, — убить можно только планом. При дополнении это перебор, у которого общий потолок +20%.
  const custom = customSets(log), cd = custom * DMG * mult;
  if (replaced) dealt = Math.min(cd, hp * REPLACE_CAP); else over += cd;
  setsDone += custom;
  hp = Math.round(hp); dealt = Math.round(dealt); over = Math.round(over);
  const killed = !replaced && hp > 0 && dealt >= hp - 0.5;
  const overXp = Math.round(Math.min(over, hp * OVERKILL_CAP));
  return { hp, dealt, left: Math.max(0, hp - dealt), over, overXp, killed, exs, setsDone, custom, replaced, pct: hp ? dealt / hp : 0, mult, lvl: monsterLevel(day) };
}

// ---------- своя тренировка ----------
// Три режима, когда вышло не по плану:
// • дополнить — свои упражнения в записи дня (log.extra), идут в перебор;
// • заменить — log.replaced = true: плановые подходы не считаются, свои бьют монстра дня до 70% здоровья,
//   он сбегает и приходит на реванш; неделя для серии засчитывается, потому что тренировка была;
// • вылазка — отдельная запись вне плана с ключом "x-<дата>[-n]": немного опыта за подходы (не больше патруля в день),
//   без золота, находок и серии. Рекорды из своих упражнений записываются, но крита (опыта) не дают.
// log.extra = [{ name, weight, reps: [...], note }]
export const REPLACE_CAP = 0.7;
// Замена одного упражнения: подход засчитывается полностью, если повторов не меньше плановых (решено 29.10: с заменой убить можно).
export const SUB_CAP = 1;
export const SORTIE_XP_SET = 2, SORTIE_XP_MAX = XP_CARDIO;
export const isSortieKey = k => typeof k === "string" && k.startsWith("x-");
export const sortieDate = L => L.performedOn || L.date.slice(2, 12);
export function customSets(L) { return (L?.extra || []).reduce((a, x) => a + (x.reps || []).filter(r => +r > 0).length, 0); }
export function sorties(logs) {
  return Object.entries(logs).filter(([k, L]) => isSortieKey(k) && L && !L.deleted).map(([k, L]) => L).sort((a, b) => (sortieDate(a) < sortieDate(b) ? -1 : sortieDate(a) > sortieDate(b) ? 1 : 0));
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
  // Вылазки встают в хронологию по своей дате; записи плана — по дате плана, как раньше.
  const ord = d => (DAY_BY_DATE[d] ? d : sortieDate(logs[d]));
  const dates = Object.keys(logs).filter(d => DAY_BY_DATE[d] || (isSortieKey(d) && logs[d] && !logs[d].deleted)).sort((a, b) => (ord(a) < ord(b) ? -1 : ord(a) > ord(b) ? 1 : a < b ? -1 : 1));
  for (const date of dates) {
    const day = DAY_BY_DATE[date], L = logs[date];
    const updates = [];
    // Плановые упражнения (кроме заменённого дня) и свои; ключ подхода — "i:k" для плана, "xj:k" для своих.
    const rows = [
      ...(day && !L.replaced ? day.items.map((it, i) => it.type === "ex" && (String(L.items?.[i]?.sub || "").trim() ? [String(i), { name: L.items[i].sub, weight: "" }, L.items[i], true] : [String(i), it, L.items?.[i]])) : []),
      ...(L.extra || []).map((x, j) => [`x${j}`, { name: x.name, weight: "" }, x, true]),
    ].filter(r => r && r[2] && String(r[1].name || "").trim());
    // custom: своё или заменённое упражнение — рекорд записывается, но крита не даёт.
    rows.forEach(([i, it, li, custom]) => {
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
          (prs[date] ||= {})[i + ":" + k] = { kind: newKg ? "kg" : "reps", ...(custom ? { custom: true } : {}) };
          dayBest = Math.max(dayBest, r);
        }
      });
      if (dayBest) list.push({ date: ord(date), key: date, name: it.name, kind: newKg ? "kg" : "reps", ...(custom ? { custom: true } : {}),
        text: newKg ? `${li.weight || it.weight}: новый вес, лучший подход ${dayBest}` : `${dayBest} повт. (было ${preReps})` });
      updates.push([key, name, Math.max(...reps), wk]);
    });
    for (const [key, name, r, wk] of updates) {
      bestReps[key] = Math.max(bestReps[key] ?? 0, r);
      bestKg[name] = Math.max(bestKg[name] ?? -Infinity, wk);
    }
  }
  return { prs, list, bestReps, bestKg };
}

// ---------- характеристики, древо навыков, снаряжение ----------
// За каждый уровень после первого: 1 очко характеристики и 1 очко навыка. За босса — ещё 1 очко характеристики.
// Ни один бонус не уменьшает объём, нужный для убийства: убить = выполнить план.
// meta.build = { log: [{ at: "<дата>", stats: {str,…}, nodes: [id] }], respecs: [блок] }
// meta.gear  = { log: [{ at: "<дата>", eq: { weapon: itemId, armor, amulet, ring } }] }
// Билд и снаряжение действуют на бои начиная с даты записи — прошлые бои не пересчитываются.
export const STATS = [
  { id: "str", name: "Сила", gen: "силы", per: "+9,5% опыта за урон в упражнениях с весом" },
  { id: "end", name: "Выносливость", gen: "выносливости", per: "+7% опыта за урон без веса, EMOM и круги, +11% за патрули" },
  { id: "agi", name: "Ловкость", gen: "ловкости", per: "+5% опыта за криты (личные рекорды)" },
  { id: "wil", name: "Воля", gen: "воли", per: "+5,5% опыта за убийство, +1 день к окну реванша, +5% за реванш" },
  { id: "lck", name: "Удача", gen: "удачи", per: "+6% шанс находки после боя (+80 опыта и вещь), +4% золота" },
];
export const STAT_BY_ID = Object.fromEntries(STATS.map(s => [s.id, s]));
export const FIND_XP = 80, FIND_CHANCE = 0.06, FIND_MAX = 0.6;
// Шанс сверх потолка не сгорает: половина излишка — шанс, что находка редкая (не больше 30%).
// Редкая находка: +2 к характеристикам, узел древа — только с шансом 12%. Легендарки с находок не падают.
export const RARE_FIND_K = 0.5, RARE_FIND_MAX = 0.3, RARE_FIND_NODE = 0.12;
export function rawFind(bd, luckBuff) {
  return FIND_CHANCE * bd.stats.lck * (hasPerk(bd, "seeker") ? 1.75 : 1) + (hasPerk(bd, "myth-find") ? 0.15 : hasPerk(bd, "leg-find") ? 0.1 : 0) + (luckBuff ? BUFFS.luck.val : 0) + (hasPerk(bd, "h-find") ? 0.03 : 0);
}
export function findChances(raw) { return { find: Math.min(FIND_MAX, raw), rare: Math.min(RARE_FIND_MAX, Math.max(0, raw - FIND_MAX) * RARE_FIND_K) }; }

// Древо: у каждой характеристики своя ветка из 7 узлов.
//        [малый 1]
//   [малый 2]   [большой А]
//   [малый 3]   [большой Б]
//   [вершина 1 | вершина 2]  — можно взять только одну
// Малый узел = +1 к характеристике ветки (столько же, сколько очко). Большой — особый эффект.
const SMALL_NAMES = {
  str: ["Хват", "Закалка", "Мощь"], end: ["Дыхание", "Выдержка", "Стальные лёгкие"], agi: ["Реакция", "Чутьё", "Глазомер"],
  wil: ["Упорство", "Дисциплина", "Железный дух"], lck: ["Примета", "Чуйка", "Везение"],
};
const MAJORS = {
  str: [{ id: "crusher", name: "Сокрушитель", desc: "Опыт за убийство +12%" }, { id: "executioner", name: "Палач", desc: "Опыт за убийство босса ×2" },
        { id: "titan", name: "Титан", desc: "Рекорд с новым весом: опыт крита ×1,6" }, { id: "breaker", name: "Раскол брони", desc: "Ещё +30% опыта за урон в упражнениях с весом" }],
  end: [{ id: "marathon", name: "Марафонец", desc: "Опыт за патрули ×1,75" }, { id: "secondwind", name: "Второе дыхание", desc: "Бодрость после таверны ×5" },
        { id: "rhythm", name: "Железный ритм", desc: "+50 опыта за неделю, где все обязательные монстры убиты" }, { id: "veteran", name: "Ветеран походов", desc: "+250 опыта за каждое зачищенное подземелье (80% монстров блока)" }],
  agi: [{ id: "combo", name: "Серия ударов", desc: "Каждый следующий крит в бою даёт +12% опыта" }, { id: "precise", name: "Точный удар", desc: "Убийство с критом: +30 опыта" },
        { id: "giant", name: "Убийца гигантов", desc: "Монстры ниже тебя режут опыт не больше чем на 4%, выше — дают до +60%" }, { id: "blademaster", name: "Мастер клинка", desc: "Весь опыт за криты +18%" }],
  wil: [{ id: "stoic", name: "Стойкость", desc: "+1 заморозка серии и +10% опыта за убийство" }, { id: "grudge", name: "Злопамятный", desc: "Опыт за реванш ×2 и +10% опыта за убийство" },
        { id: "unbroken", name: "Несломленный", desc: "+1 заморозка серии и +20% опыта за убийство" }, { id: "headhunter", name: "Охотник за головами", desc: "Сбежавший монстр может вернуться дважды, реванш +100 опыта, +18% опыта за убийство" }],
  lck: [{ id: "seeker", name: "Кладоискатель", desc: "Шанс находки ×1,75" }, { id: "goldvein", name: "Золотая жила", desc: "+25% золота за убийства" },
        { id: "merchant", name: "Друг торговца", desc: "Скидка 30% у торговца и в кузнице" }, { id: "trophy", name: "Трофейщик", desc: "Босс всегда оставляет легендарную вещь" }],
};
export const TREE = Object.fromEntries(STATS.map(({ id: st }) => {
  const sm = SMALL_NAMES[st].map((name, k) => ({ id: `${st}${k + 1}`, kind: "small", stat: st, name, desc: `+1 ${STAT_BY_ID[st].name}` }));
  const [m1, m2, u1, u2] = MAJORS[st].map(m => ({ ...m, stat: st }));
  const nodes = [
    { ...sm[0], row: 0, col: "c", req: [] },
    { ...sm[1], row: 1, col: "l", req: [sm[0].id] }, { ...m1, kind: "major", row: 1, col: "r", req: [sm[0].id] },
    { ...sm[2], row: 2, col: "l", req: [sm[1].id] }, { ...m2, kind: "major", row: 2, col: "r", req: [sm[1].id] },
    { ...u1, kind: "ultimate", row: 3, col: "l", req: [sm[2].id], excl: u2.id }, { ...u2, kind: "ultimate", row: 3, col: "r", req: [sm[2].id], excl: u1.id },
  ];
  return [st, nodes];
}));
export const NODE_BY_ID = Object.fromEntries(Object.values(TREE).flat().map(n => [n.id, n]));
// Узел можно взять, если взяты все его предки и не взята парная вершина.
export function canTakeNode(nodes, id) {
  const n = NODE_BY_ID[id];
  return !!n && !nodes.includes(id) && n.req.every(r => nodes.includes(r)) && !(n.excl && nodes.includes(n.excl));
}

// ---------- снаряжение ----------
export const SLOTS = [{ id: "weapon", name: "Оружие" }, { id: "armor", name: "Броня" }, { id: "amulet", name: "Амулет" }, { id: "ring", name: "Кольцо" }];
const ITEM_NAMES = {
  common: { weapon: ["Ржавый тесак", "Гоблинский нож", "Дубина стража", "Короткий меч"], armor: ["Кожаный доспех", "Стёганка", "Кольчуга дозорного"], amulet: ["Костяной оберег", "Медный амулет", "Клык на шнурке"], ring: ["Железное кольцо", "Кольцо дозорного", "Медный перстень"] },
  rare: { weapon: ["Клинок пепла", "Секира вожака"], armor: ["Латы стража склепа", "Панцирь берсерка"], amulet: ["Око шамана", "Череп-талисман"], ring: ["Печать вожака", "Кольцо призрака"] },
};
export const LEGENDARY = {
  weapon: { name: "Драконья погибель", fx: "leg-boss", desc: "Опыт за боссов ×1,5" },
  armor: { name: "Чешуя древнего", fx: "leg-freeze", desc: "+1 заморозка серии" },
  amulet: { name: "Сердце пламени", fx: "leg-xp", desc: "+5% всего опыта за бои" },
  ring: { name: "Перстень судьбы", fx: "leg-find", desc: "+10% к шансу находки" },
};
export const LEGENDARY_CHANCE = 0.25;
// Мифическая — пробуждённая в кузнице легендарка. С боссов не падает, купить или сковать с нуля нельзя.
export const MYTHIC = {
  weapon: { name: "Пепельная погибель", fx: "myth-boss", desc: "Опыт за боссов ×2" },
  armor: { name: "Чешуя первородного", fx: "myth-freeze", desc: "+2 заморозки серии" },
  amulet: { name: "Сердце вулкана", fx: "myth-xp", desc: "+8% всего опыта за бои" },
  ring: { name: "Перстень рока", fx: "myth-find", desc: "+15% к шансу находки" },
};

// Уникальные вещи — награды за самые трудные достижения и титул «Легенда». Не падают, не покупаются, не куются
// и не пробуждаются. +1 к характеристике и два особых эффекта: заметно лучше обычной, но слабее легендарки.
export const UNIQUE = {
  unbent: { slot: "ring", name: "Кольцо несгибаемого", stat: "wil", fx: ["u-kill", "u-patrol"] },
  exam: { slot: "armor", name: "Мантия экзаменатора", stat: "end", fx: ["u-tavern", "u-week"] },
  fang: { slot: "weapon", name: "Клык Древнего", stat: "str", fx: ["u-boss", "u-heavypr"] },
  halfyear: { slot: "amulet", name: "Знак полугодия", stat: "lck", fx: ["u-gold", "u-inspire"] },
  legend: { slot: "ring", name: "Перстень легенды", stat: "agi", fx: ["u-crit", "u-week"] },
};
export const UNIQUE_FX = {
  "u-kill": "+8% опыта за убийство", "u-week": "первый бой недели +6% опыта", "u-tavern": "бодрость после таверны ×2",
  "u-patrol": "+20% опыта за патрули", "u-boss": "+10% опыта за боссов", "u-heavypr": "рекорд с новым весом +8 опыта",
  "u-gold": "+10% золота", "u-inspire": "Вдохновение +25% вместо +15%", "u-crit": "+8% опыта за криты",
};

// ---------- золото, торговец, кузница ----------
// Золото дают только убийства, то есть только выполненный план. Перебор, рекорды и патрули золота не дают.
// meta.shop = { log: [{ at, act: "buy" | "forge" | "mythic", id: новая вещь, use: [id израсходованных], cost }] }
export const GOLD_KILL = 10, GOLD_BOSS = 60;
export const PRICE_COMMON = 50, FORGE_FEE = 30, MYTHIC_COST = 800;
export const priceOf = (base, b) => Math.round(base * (hasPerk(b, "merchant") ? 0.7 : 1));
const pick = (arr, key) => arr[Math.floor(hash01(key) * arr.length) % arr.length];
// Вещь целиком выводится из своего id, поэтому одинакова на всех устройствах и ничего не хранится, кроме id.
// id: "c:<дата>" — находка в обычном бою, "b:<дата>" — добыча с босса, "L:<дата>" — гарантированная легенда («Трофейщик»),
// "s:<слот>:<хар>:<n>" — куплена у торговца, "f:<слот>:<хар>:<хар>:<n>" — скована из двух обычных, "M:<id легендарки>" — мифическая.
const FORGED = { weapon: "Кованый клинок", armor: "Кованая кираса", amulet: "Кованый оберег", ring: "Кованый перстень" };
export function itemOf(id) {
  const [src, ...p] = id.split(":");
  if (src === "M") {
    const base = itemOf(id.slice(2)), My = MYTHIC[base.slot], stat = Object.keys(base.stats)[0];
    return { id, slot: base.slot, rarity: "mythic", name: My.name, stats: { [stat]: 5 }, nodes: [My.fx], desc: My.desc, from: base.id };
  }
  if (src === "U") {
    const u = UNIQUE[p[0]];
    return { id, slot: u.slot, rarity: "unique", name: u.name, stats: { [u.stat]: 1 }, nodes: u.fx, desc: u.fx.map(f => UNIQUE_FX[f]).join(", ") };
  }
  if (src === "f") {
    const stats = {}; for (const s of [p[1], p[2]]) stats[s] = (stats[s] || 0) + 1;
    return { id, slot: p[0], rarity: "rare", forged: true, name: `${FORGED[p[0]]} ${STAT_BY_ID[p[1]].gen}`, stats, nodes: [] };
  }
  const slot = src === "s" ? p[0] : pick(SLOTS, id + "#slot").id;
  const stat = src === "s" ? p[1] : pick(STATS, id + "#stat").id;
  if (src === "c" || src === "s") return { id, slot, rarity: "common", name: `${pick(ITEM_NAMES.common[slot], id + "#name")} ${STAT_BY_ID[stat].gen}`, stats: { [stat]: 1 }, nodes: [] };
  if (src === "L" || (src === "b" && hash01(id + "#leg") < LEGENDARY_CHANCE)) {
    const L = LEGENDARY[slot];
    return { id, slot, rarity: "legendary", name: L.name, stats: { [stat]: 3 }, nodes: [L.fx], desc: L.desc };
  }
  const stat2 = pick(STATS.filter(s => s.id !== stat), id + "#stat2").id;
  const majors = Object.values(TREE).flat().filter(n => n.kind === "major");
  const node = pick(majors, id + "#node").id;
  // Редкая находка ("r:"): узел только с шансом, без узла — помечена как без узла.
  const hasNode = src !== "r" || hash01(id + "#hasnode") < RARE_FIND_NODE;
  return { id, slot, rarity: "rare", noNode: !hasNode, name: pick(ITEM_NAMES.rare[slot], id + "#name"), stats: { [stat]: 1, [stat2]: 1 }, nodes: hasNode ? [node] : [] };
}
export function itemText(it) {
  const parts = Object.entries(it.stats).map(([s, v]) => `+${v} ${STAT_BY_ID[s].name}`);
  for (const n of it.nodes) parts.push(NODE_BY_ID[n] ? `узел «${NODE_BY_ID[n].name}»` : UNIQUE_FX[n] || it.desc);
  if (it.forged || it.noNode) parts.push("без узла");
  return parts.join(", ");
}

const ZERO = () => ({ str: 0, end: 0, agi: 0, wil: 0, lck: 0 });
function entryAt(log, iso) { let b = null; for (const e of log || []) if (e.at <= iso) b = e; return b; }
// Вложенное вручную: очки характеристик и взятые узлы.
export function allocAt(meta, iso) {
  const e = entryAt(meta?.build?.log, iso);
  return { stats: { ...ZERO(), ...(e?.stats || {}) }, nodes: (e?.nodes || []).filter(n => NODE_BY_ID[n]) };
}
export function honorAt(meta, iso) { const id = entryAt(meta?.honor?.log, iso)?.id; return HONOR[id] ? id : ""; }
export function gearAt(meta, iso) { return { ...(entryAt(meta?.gear?.log, iso)?.eq || {}) }; }
// Итоговый билд на дату: вложенные очки + малые узлы + снаряжение. nodes включает узлы и эффекты легендарных вещей.
export function buildAt(meta, iso) {
  const a = allocAt(meta, iso), eq = gearAt(meta, iso);
  const stats = { ...a.stats }, nodes = new Set(a.nodes);
  for (const id of Object.values(eq)) { if (!id) continue; const it = itemOf(id); for (const [s, v] of Object.entries(it.stats)) stats[s] += v; it.nodes.forEach(n => nodes.add(n)); }
  for (const n of nodes) if (NODE_BY_ID[n]?.kind === "small") stats[NODE_BY_ID[n].stat]++;
  const h = honorAt(meta, iso); if (h) nodes.add(HONOR[h].fx);
  return { stats, nodes: [...nodes], alloc: a, eq };
}
export function currentBuild(meta) { return buildAt(meta, "9999-12-31"); }
export function hasPerk(b, id) { return b.nodes.includes(id); }
export function freezeLimit(meta) { const b = currentBuild(meta); return FREEZES + hasPerk(b, "stoic") + hasPerk(b, "unbroken") + hasPerk(b, "leg-freeze") + 2 * hasPerk(b, "myth-freeze"); }
export function canRespec(meta, today) { return !(meta?.build?.respecs || []).includes(weekOf(today).block); }
// Дата, когда бой был на самом деле: от неё зависит, какой билд действовал.
export function whenOf(day, L) { return L?.performedOn || day.on; }
// Упражнение «с весом»: указан вес в кг (гиря, пояс), но не махи/круги/скакалка — это работа на выносливость.
export function isHeavy(it, li) {
  if (parsePlan(it).emom || /круг|скакалк|мах/i.test(it.name)) return false;
  return kg(li?.weight ?? it.weight) > 0;
}
function hash01(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function levelXpMod(mLvl, hLvl, b) {
  const diff = mLvl - hLvl;
  if (hasPerk(b, "giant")) return Math.min(1.6, Math.max(0.96, 1 + 0.1 * diff));
  return Math.min(LVL_XP_MAX, Math.max(LVL_XP_MIN, 1 + LVL_XP_STEP * diff));
}

// ---------- опыт и уровни ----------
export const TITLES = ["Странник", "Оруженосец", "Наёмник", "Страж", "Рыцарь", "Ветеран", "Чемпион", "Паладин", "Герой", "Легенда"];
// Цена уровня растёт: за год ровно по плану выходит примерно 22-й уровень.
export function xpForLevel(l) { return 600 + 150 * (l - 1); }
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
function dayFinished(L, past) { return !!(L && !L.skipped && (L.finished || past) && (customSets(L) > 0 || (!L.replaced && L.items?.some(x => (x.reps || []).some(r => +r > 0) || x.done)))); }

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
  computeRevenge(logs, today, meta);
  let revenges = 0, finds = 0, gold = 0;
  const loot = [];
  let xp = 0, kills = 0, fled = 0, cardio = 0, overkills = 0, nightOwl = 0;
  const killed = {}, bossKills = [], perDay = {};
  const tavernBuffWeeks = new Set(), weekFirst = new Set();
  // Награды: заряды Вдохновения расходуются по одному на бой, изученные виды дают бонус с даты, когда их забрали.
  const claims = claimsOf(meta);
  const buffs = buffWindows(claims), on = (k, iso) => buffs[k].some(w => iso >= w.from && iso < w.to);
  const studiedAt = (id, iso) => claims.some(e => e.id === "m:" + id && e.at <= iso);
  for (const d of DAYS) {
    const L = logs[d.date]; if (!L) continue;
    const bd = buildAt(meta, whenOf(d, L)), st = bd.stats;
    if (isCardio(d)) {
      if (L.items?.some(x => x.done) || L.finished) {
        const cx = Math.round(XP_CARDIO * (1 + 0.11 * st.end + (hasPerk(bd, "u-patrol") ? 0.2 : 0) + (hasPerk(bd, "h-patrol") ? 0.3 : 0)) * (hasPerk(bd, "marathon") ? 1.75 : 1));
        xp += cx; cardio++; perDay[d.date] = { xp: cx };
      }
      continue;
    }
    const b = battle(d, L), m = monsterFor(d);
    const hLvl = levelFromXp(xp).level, mod = levelXpMod(b.lvl, hLvl, bd);
    // Опыт за урон считается от плана, а не от раздутых цифр здоровья: уровень монстра влияет только через mod.
    const heavyHp = b.exs.reduce((a, e) => a + (e.heavy ? e.dealt + e.over : 0), 0), allHp = b.exs.reduce((a, e) => a + e.dealt + e.over, 0);
    const heavyShare = allHp ? heavyHp / allHp : 0;
    const statMul = 1 + heavyShare * (0.095 * st.str + (hasPerk(bd, "breaker") ? 0.3 : 0)) + (1 - heavyShare) * 0.07 * st.end;
    let dx = Math.round((b.dealt + b.overXp) / b.mult * XP_PER_HP * statMul * mod);
    const bossMul = m?.boss ? (hasPerk(bd, "executioner") ? 2 : 1) * (hasPerk(bd, "myth-boss") ? 2 : hasPerk(bd, "leg-boss") ? 1.5 : 1) * (hasPerk(bd, "u-boss") ? 1.1 : 1) * (hasPerk(bd, "h-boss") ? 1.25 : 1) : 1;
    const dayPRs = Object.entries(prs[d.date] || {}).filter(([, pr]) => !pr.custom);
    const nPR = dayPRs.length;
    dayPRs.forEach(([, pr], k) => {
      let x = XP_PR * (1 + 0.05 * st.agi);
      if (pr.kind === "kg" && hasPerk(bd, "titan")) x *= 1.6;
      if (k > 0 && hasPerk(bd, "combo")) x *= 1.12;
      if (hasPerk(bd, "blademaster")) x *= 1.18;
      if (hasPerk(bd, "u-crit")) x *= 1.08;
      if (hasPerk(bd, "h-crit")) x *= 1.04;
      if (pr.kind === "kg" && hasPerk(bd, "u-heavypr")) x += 8;
      dx += Math.round(x);
    });
    let find = 0, dg = 0;
    const when = whenOf(d, L);
    if (b.killed) {
      // Дробные монеты копятся: иначе +4% к 10 золотым терялись бы при округлении.
      const g = (m?.boss ? GOLD_BOSS : GOLD_KILL) * (1 + 0.04 * st.lck + (hasPerk(bd, "goldvein") ? 0.25 : 0) + (hasPerk(bd, "u-gold") ? 0.1 : 0) + (on("gold", when) ? BUFFS.gold.val : 0));
      dg = Math.floor(gold + g) - Math.floor(gold); gold += g;
      let kx = XP_KILL * (m?.boss ? 3 : 1) * bossMul * (1 + (hasPerk(bd, "crusher") ? 0.12 : 0) + (hasPerk(bd, "unbroken") ? 0.2 : 0) + (hasPerk(bd, "stoic") ? 0.1 : 0) + (hasPerk(bd, "grudge") ? 0.1 : 0) + (hasPerk(bd, "headhunter") ? 0.18 : 0) + (hasPerk(bd, "u-kill") ? 0.08 : 0) + (hasPerk(bd, "h-slayer") ? 0.04 : 0)) * (1 + 0.055 * st.wil);
      if (nPR && hasPerk(bd, "precise")) kx += 30;
      dx += Math.round(kx * mod);
      kills++; killed[m.id] = (killed[m.id] || 0) + 1; if (m.boss) bossKills.push(m.id); if (b.over >= b.hp * OVERKILL_CAP) overkills++;
      if (REVENGE[d.date]) { dx += Math.round(XP_REVENGE * (1 + 0.05 * st.wil) * (hasPerk(bd, "grudge") ? 2 : 1)) + (hasPerk(bd, "headhunter") ? 100 : 0) + (hasPerk(bd, "h-revenge") ? 40 : 0); revenges++; }
      // Босс всегда оставляет вещь: редкую или (с шансом) легендарную; «Трофейщик» — всегда легендарную.
      if (m?.boss) loot.push({ id: (hasPerk(bd, "trophy") ? "L:" : "b:") + d.date, date: d.date });
    }
    else if (L.finished && b.dealt > 0) fled++;
    // Находка: удача проверяется детерминированно по дате, поэтому на всех устройствах одинаково.
    const fc = findChances(rawFind(bd, on("luck", when)));
    if (b.dealt > 0 && hash01(d.date) < fc.find) find = 1;
    if (find) { finds++; dx += FIND_XP; loot.push({ id: (hash01(d.date + "#rare") < fc.rare ? "r:" : "c:") + d.date, date: d.date }); }
    // Бодрость после таверны: первый бой недели после разгрузки даёт бонус.
    if (b.dealt > 0 && TAVERN_WEEKS.has(d.week - 1) && !tavernBuffWeeks.has(d.week)) { tavernBuffWeeks.add(d.week); dx += XP_TAVERN_BUFF * (hasPerk(bd, "secondwind") ? 5 : 1) * (hasPerk(bd, "u-tavern") ? 2 : 1); }
    let mul = hasPerk(bd, "myth-xp") ? 1.08 : hasPerk(bd, "leg-xp") ? 1.05 : 1;
    if (b.dealt > 0 && !weekFirst.has(d.week)) { weekFirst.add(d.week); if (hasPerk(bd, "u-week")) mul += 0.06; }
    const late = L.finishedAt && L.performedOn === L.finishedAt.slice(0, 10) && new Date(L.finishedAt).getHours() >= 22;
    if (late && hasPerk(bd, "h-night")) mul += 0.2;
    if (hasPerk(bd, "h-year")) mul += 0.02;
    if (m && studiedAt(m.id, when)) mul += STUDY;
    const inspired = b.dealt > 0 && on("ins", when);
    if (inspired) mul += hasPerk(bd, "u-inspire") ? INSPIRE_U : BUFFS.ins.val;
    dx = Math.round(dx * mul);
    if (late) nightOwl++;
    xp += dx; perDay[d.date] = { xp: dx, gold: dg, battle: b, prs: nPR, find, mod, heroLvl: hLvl, inspired, loot: loot.filter(x => x.date === d.date).map(x => x.id) };
  }
  // Вылазки вне плана: опыт за подходы, не больше патруля за день. Рекорды записываются без крита. Без золота, находок и серии.
  const sortieDay = {};
  let sortieCount = 0;
  for (const L of sorties(logs)) {
    const sets = customSets(L); if (!sets) continue;
    const on = sortieDate(L), had = sortieDay[on] || 0;
    let sx = Math.min(SORTIE_XP_MAX - had, sets * SORTIE_XP_SET);
    sortieDay[on] = had + sx;
    const nPR = Object.keys(prs[L.date] || {}).length;
    xp += sx; sortieCount++; perDay[L.date] = { xp: sx, prs: nPR };
  }
  // Перки выносливости 10: награды за неделю и за подземелье начисляются по билду на конец недели / блока.
  for (const w of WEEKS) {
    const ds = w.days.filter(regular);
    if (!ds.length || !hasPerk(buildAt(meta, w.onTo), "rhythm")) continue;
    if (ds.every(d => battle(d, logs[d.date]).killed)) { xp += 50; (perDay[ds[ds.length - 1].date] ||= { xp: 0 }).xp += 50; }
  }
  const blocks = [...new Set(DAYS.map(d => d.blockN))];
  for (const n of blocks) {
    const last = DAYS.filter(d => d.blockN === n).pop();
    if (hasPerk(buildAt(meta, last.on), "veteran") && dungeonCleared(n, logs)) xp += 250;
  }
  // Золото и опыт из наград начисляются целиком; уникальные вещи попадают в сумку с даты, когда их забрали.
  for (const e of claims) { const r = rewardOf(e.id); xp += r.xp; gold += r.gold; if (r.item) loot.push({ id: "U:" + r.item, date: e.at }); }
  const lv = levelFromXp(xp);
  const sk = streak(logs, meta, today);
  const points = lv.level - 1 + bossKills.length, skillPoints = lv.level - 1;
  const build = currentBuild(meta);
  const spent = Object.values(build.alloc.stats).reduce((a, b) => a + b, 0), skillSpent = build.alloc.nodes.length;
  // Покупки и ковка: добавляют вещи и тратят золото; израсходованные в кузнице вещи уходят из сумки.
  const shop = meta?.shop?.log || [], used = new Set(shop.flatMap(e => e.use || []));
  const spentGold = shop.reduce((a, e) => a + (e.cost || 0), 0);
  for (const e of shop) loot.push({ id: e.id, date: e.at });
  const inventory = loot.filter(x => !used.has(x.id)).map(x => ({ ...itemOf(x.id), date: x.date }));
  const forged = shop.filter(e => e.act === "forge").length, mythics = shop.filter(e => e.act === "mythic").length;
  const findNow = findChances(rawFind(build, on("luck", today)));
  const ach = achievements({ forged, mythics, bought: shop.filter(e => e.act === "buy").length, revenges, kills, fled, cardio, prCount: prList.filter(p => !p.custom).length, streakBest: sk.best, bossKills, killed, overkills, nightOwl, logs, level: lv.level, weeks: sk.weeks, finds, build, inventory });
  const res = { xp, ...lv, sorties: sortieCount, revenges, kills, fled, cardio, finds, killed, bossKills, prList, prs, perDay, streak: sk, achievements: ach, points, spent, free: points - spent, skillPoints, skillSpent, skillFree: skillPoints - skillSpent, build, inventory, goldEarned: Math.floor(gold), goldSpent: spentGold, gold: Math.floor(gold) - spentGold, findNow };
  res.rewards = rewardList(res, meta);
  res.honors = claims.map(e => rewardOf(e.id).honor).filter(Boolean);
  res.honor = honorAt(meta, "9999-12-31");
  res.shownTitle = res.honor ? HONOR[res.honor].name : res.title;
  res.unclaimed = res.rewards.filter(r => r.open && !r.at).length;
  // Активные бафы на сегодня: сколько дней осталось (включая сегодня).
  res.buffs = Object.keys(BUFFS).map(k => { const w = buffs[k].find(x => today >= x.from && today < x.to) || buffs[k].find(x => x.from > today); return w && { id: k, ...BUFFS[k], left: daysBetween(today, w.to), from: w.from }; }).filter(Boolean);
  return res;
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
    A("perk1", "Свой путь", "Открыть первый большой узел древа", s.build.alloc.nodes.some(n => NODE_BY_ID[n]?.kind !== "small")),
    A("legend", "Легендарная добыча", "Получить легендарную вещь", s.inventory.some(i => i.rarity === "legendary")),
    A("find5", "Мародёр", "Сделать 5 находок", s.finds >= 5),
    A("buy1", "Покупатель", "Купить вещь у торговца", s.bought >= 1),
    A("forge1", "Кузнец", "Сковать редкую вещь", s.forged >= 1),
    A("mythic", "Миф", "Пробудить легендарную вещь до мифической", s.mythics >= 1),
    A("beasts", "Знаток тварей", "Убить хотя бы по разу всех 12 обычных монстров", Object.values(MONSTERS).filter(m => !m.boss && !m.tavern && m.id in s.killed).length >= 12),
  ];
}

// ---------- награды за достижения, титулы и бестиарий ----------
// Открыл достижение, новый титул или нового монстра — в Летописи появляется награда, её надо забрать.
// meta.rewards = { log: [{ at: "<дата>", id: "a:<достижение>" | "t:<номер титула>" | "m:<монстр>" }] }
// Всё, что даёт награда, действует с даты, когда её забрали, поэтому старые достижения тоже не пропадают.
// Бафы на дни: действуют N дней с даты, когда награду забрали; тот же баф ещё раз — продлевает срок, а не складывает проценты.
// Бестиарий: изученный вид (забрана награда за первое убийство) даёт +2% опыта за каждый бой с ним.
// Цена в общей валюте: день Вдохновения ≈ 13 опыта, 10 золота ≈ 1/5 обычной вещи. Награды за идеальный год ≈ +4% опыта и ≈ +16% золота; почётный титул ≈ 300–500 опыта в год.
export const BUFFS = {
  ins: { name: "Вдохновение", val: 0.15, desc: "+15% опыта за бои" },
  gold: { name: "Золотая лихорадка", val: 0.3, desc: "+30% золота за убийства" },
  luck: { name: "Счастливый след", val: 0.08, desc: "+8% к шансу находки" },
};
export const INSPIRE_U = 0.25, STUDY = 0.02;
// gold, xp — сразу; ins/gb/lk — дни бафа; item — уникальная вещь.
const R = (o = {}) => ({ gold: 0, xp: 0, ins: 0, gb: 0, lk: 0, item: null, honor: null, ...o });
export const ACH_REWARDS = {
  "first-blood": R({ gold: 10, ins: 3 }), hunter: R({ gb: 7 }), slayer: R({ gold: 20, lk: 7 }),
  crit: R({ xp: 30, ins: 3 }), crit10: R({ xp: 50, ins: 5 }),
  revenge: R({ gold: 10 }), revenge5: R({ gold: 20, ins: 5 }), overkill: R({ ins: 3 }), night: R({ lk: 5 }),
  streak4: R({ gold: 15, ins: 5 }), streak8: R({ ins: 7, gb: 7 }), streak16: R({ item: "unbent" }), streak26: R({ item: "halfyear" }),
  cardio10: R({ gold: 10, lk: 5 }),
  d1: R({ gold: 20, gb: 5 }), d2: R({ item: "exam" }), d3: R({ gold: 20, ins: 5 }), d4: R({ ins: 7, lk: 7 }), d6: R({ gold: 20, ins: 7 }), d7: R({ ins: 7, gb: 7 }), d9: R({ gold: 20, ins: 10 }),
  boss1: R({ ins: 7 }), boss2: R({ ins: 7, gb: 5 }), boss3: R({ item: "fang" }), bossAll: R({ gold: 50, ins: 14 }),
  lvl5: R({ gold: 10, ins: 3 }), lvl10: R({ ins: 7 }), perk1: R({ ins: 3 }), legend: R({ gold: 20 }), find5: R({ gb: 7 }),
  buy1: R({ gold: 10 }), forge1: R({ gold: 10 }), mythic: R({ ins: 14 }), beasts: R({ gold: 20, lk: 7 }),
};
// Награда за титул: индекс в TITLES (0 — «Странник», его не дают).
export const TITLE_REWARDS = [null, R({ gold: 10, ins: 3 }), R({ ins: 5 }), R({ gold: 15, lk: 5 }), R({ ins: 5, gb: 5 }), R({ xp: 100, ins: 5 }),
  R({ gold: 20, ins: 7 }), R({ xp: 120, gb: 7 }), R({ gold: 25, ins: 10 }), R({ ins: 7, item: "legend" })];
// Почётные титулы: у этих достижений наградой служит сам титул. Носится один; эффект действует, пока он надет.
// meta.honor = { log: [{ at: "<дата>", id: "<достижение>" | "" }] } — "" значит титул уровня.
export const HONOR = {
  slayer: { name: "Истребитель", fx: "h-slayer", desc: "+4% опыта за убийство" },
  crit10: { name: "Мастер критов", fx: "h-crit", desc: "+4% опыта за криты" },
  revenge5: { name: "Кровник", fx: "h-revenge", desc: "реванш +40 опыта" },
  cardio10: { name: "Гонец", fx: "h-patrol", desc: "+30% опыта за патрули" },
  night: { name: "Полуночник", fx: "h-night", desc: "бой, законченный после 22:00, +20% опыта" },
  boss1: { name: "Цареубийца", fx: "h-boss", desc: "+25% опыта за боссов" },
  find5: { name: "Мародёр", fx: "h-find", desc: "+3% к шансу находки" },
  bossAll: { name: "Победитель года", fx: "h-year", desc: "+2% всего опыта за бои" },
};
for (const id of Object.keys(HONOR)) ACH_REWARDS[id] = R({ honor: id });
const STUDY_REWARD = R();   // за вид — только знание (+2% в боях с ним)
// Отрезки действия бафов: каждая награда начинает свой отрезок с даты получения или с конца предыдущего, если он ещё идёт.
function buffWindows(claims) {
  const out = { ins: [], gold: [], luck: [] }, key = { ins: "ins", gold: "gb", luck: "lk" };
  for (const k of Object.keys(out)) {
    let end = "";
    for (const e of [...claims].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
      const n = rewardOf(e.id)[key[k]]; if (!n) continue;
      const from = e.at > end ? e.at : end; end = addDays(from, n);
      const last = out[k][out[k].length - 1];
      if (last && last.to === from) last.to = end; else out[k].push({ from, to: end });
    }
  }
  return out;
}

export function rewardOf(id) {
  const [k, key] = [id.slice(0, 1), id.slice(2)];
  if (k === "a" && ACH_REWARDS[key]) return ACH_REWARDS[key];
  if (k === "t" && TITLE_REWARDS[+key]) return TITLE_REWARDS[+key];
  if (k === "m" && MONSTERS[key] && !MONSTERS[key].tavern) return STUDY_REWARD;
  return null;
}
export function rewardText(r, id = "") {
  const parts = [];
  if (r.honor) parts.push(`титул «${HONOR[r.honor].name}» (${HONOR[r.honor].desc}, пока надет)`);
  if (r.item) { const u = UNIQUE[r.item]; parts.push(`уникальная вещь «${u.name}»`); }
  if (r.gold) parts.push(`${r.gold} з.`);
  const days = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней"}`;
  if (r.ins) parts.push(`Вдохновение на ${days(r.ins)}`);
  if (r.gb) parts.push(`Золотая лихорадка на ${days(r.gb)}`);
  if (r.lk) parts.push(`Счастливый след на ${days(r.lk)}`);
  if (r.xp) parts.push(`${r.xp} опыта`);
  if (id.startsWith("m:")) parts.push(`+${Math.round(STUDY * 100)}% опыта в боях с ним`);
  return parts.join(", ");
}
export function claimsOf(meta) { return (meta?.rewards?.log || []).filter(e => rewardOf(e.id)); }
// Что уже можно забрать: открытые достижения, достигнутые титулы, убитые виды. Забранное помечено датой.
function rewardList(s, meta) {
  const at = Object.fromEntries(claimsOf(meta).map(e => [e.id, e.at]));
  const row = (id, kind, name, open) => ({ id, kind, name, open: !!open, at: at[id] || null, reward: rewardOf(id), text: rewardText(rewardOf(id), id) });
  const tIdx = TITLES.indexOf(s.title);
  return [
    ...s.achievements.filter(a => ACH_REWARDS[a.id]).map(a => row("a:" + a.id, "ach", a.name, a.got)),
    ...TITLES.map((t, i) => i && row("t:" + i, "title", t, i <= tIdx)).filter(Boolean),
    ...Object.values(MONSTERS).filter(m => !m.tavern).map(m => row("m:" + m.id, "beast", m.name, s.killed[m.id])),
  ];
}
