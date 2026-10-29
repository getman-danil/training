// Встроенный разбор прогресса: работает без Claude и без интернета.
// Ряды по упражнениям, выполнение плана по неделям и простые правила-подсказки.
import { DAYS, WEEKS, DAY_BY_DATE, parsePlan, normName, kg, isCardio, battle, weekGoal, isSortieKey, sortieDate, monsterFor, isOptional } from "./game.js";

// Ряд по каждому упражнению: лучшая попытка, сумма повторов, вес, доля плана.
// Свои упражнения (дополнение, замена, вылазка) идут в те же ряды по названию, но без доли плана.
export function exerciseSeries(logs) {
  const by = {};
  for (const key0 of Object.keys(logs)) {
    const day = DAY_BY_DATE[key0], L = logs[key0];
    if (!L || L.deleted || (!day && !isSortieKey(key0))) continue;
    const date = day ? key0 : sortieDate(L);
    const rows = [
      ...(day && !L.replaced ? day.items.map((it, i) => it.type === "ex" && (String(L.items?.[i]?.sub || "").trim()
        ? [{ name: L.items[i].sub, weight: "" }, L.items[i], { sets: 0, target: null, unit: parsePlan(it).unit }]
        : [it, L.items?.[i], parsePlan(it)])) : []),
      ...(L.extra || []).map(x => [{ name: x.name, weight: "" }, x, { sets: 0, target: null, unit: "повт" }]),
    ].filter(r => r && r[1] && String(r[0].name || "").trim());
    rows.forEach(([it, li, pp]) => {
      const reps = (li?.reps || []).map(Number).filter(r => r > 0);
      if (!reps.length) return;
      const key = normName(it.name);
      const planned = pp.target ? pp.sets * pp.target : null;
      const total = reps.reduce((a, b) => a + b, 0);
      const weight = li.weight ?? it.weight ?? "";
      const ser = by[key] ||= { key, name: it.name.replace(/\s*\(.*?\)\s*/g, " ").trim(), unit: pp.unit, points: [] };
      if (pp.sets) ser.unit = pp.unit;   // единицы (сек, мин) знает только план
      ser.points.push({
        date, best: Math.max(...reps), total, sets: reps.length, weight, kg: kg(weight), planPct: planned ? total / planned : null, note: li.note || "",
      });
    });
  }
  for (const s of Object.values(by)) s.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return Object.values(by).sort((a, b) => b.points.length - a.points.length);
}

// Выполнение плана по неделям: доля нанесённого урона от здоровья всех монстров недели.
export function weekly(logs, today) {
  return WEEKS.filter(w => w.onFrom <= today).map(w => {
    let hp = 0, dealt = 0, done = 0, reps = 0;
    for (const d of w.days) {
      if (isCardio(d)) continue;
      const b = battle(d, logs[d.date]);
      hp += b.hp; dealt += b.dealt;
      if (b.setsDone) done++;
      const L = logs[d.date];
      [...(L?.replaced ? [] : L?.items || []), ...(L?.extra || [])].forEach(x => (x.reps || []).forEach(r => { if (+r > 0) reps += +r; }));
    }
    return { n: w.n, from: w.onFrom, to: w.onTo, pct: hp ? dealt / hp : 0, done, goal: weekGoal(w), reps, current: today <= w.onTo };
  });
}

// Подсказки по правилам. Каждая — { level: "good"|"warn"|"info", text }.
export function hints(logs, today) {
  const out = [];
  const series = exerciseSeries(logs);
  for (const s of series) {
    const p = s.points; if (p.length < 2) continue;
    const last = p.slice(-3);
    // Застой: три последние сессии без роста лучшей попытки и веса
    if (last.length === 3 && last[2].best <= last[0].best && last[2].kg <= last[0].kg && p.length >= 4) {
      const prevBest = Math.max(...p.slice(0, -3).map(x => x.best));
      if (last[2].best <= prevBest) out.push({ level: "warn", text: `${s.name}: три тренировки без роста (лучшее ${last[2].best}). Попробуй сменить вариант, добавить подход полегче или отдохнуть лишний день.` });
    }
    const two = p.slice(-2).filter(x => x.planPct != null);
    if (two.length === 2 && two.every(x => x.planPct < 0.8)) out.push({ level: "warn", text: `${s.name}: два раза подряд меньше 80% плана. Возможно, вес или объём пока тяжеловат.` });
    if (two.length === 2 && two.every(x => x.planPct >= 1.15)) out.push({ level: "good", text: `${s.name}: два раза подряд перевыполнение больше 15%. Можно добавить вес или повторы.` });
    const lastNote = p[p.length - 1];
    if (/бол(ит|ь|ел)|травм|тянет|хруст/i.test(lastNote.note) && lastNote.date >= addDays(today, -14)) out.push({ level: "warn", text: `${s.name}: в заметке «${lastNote.note.slice(0, 60)}». Если боль не проходит — лучше показаться врачу и пока снизить нагрузку.` });
  }
  const wk = weekly(logs, today).filter(w => !w.current);
  if (wk.length >= 3) {
    const lastW = wk[wk.length - 1], prev = wk.slice(-4, -1);
    const avg = prev.reduce((a, w) => a + w.pct, 0) / prev.length;
    if (avg > 0.3 && lastW.pct < avg * 0.7) out.push({ level: "warn", text: `Неделя ${lastW.n}: выполнено ${pct(lastW.pct)} плана против ${pct(avg)} в среднем раньше. Если это усталость или учёба — можно взять заморозку.` });
    const missed = wk.slice(-2).every(w => w.done === 0);
    if (missed) out.push({ level: "warn", text: "Две недели без силовых. Начни с лёгкой тренировки: монстр подождёт, главное — вернуться." });
    if (wk.slice(-3).every(w => w.pct >= 0.95)) out.push({ level: "good", text: "Три недели подряд план выполнен почти полностью. Отличная стабильность." });
  }
  const sorted = Object.keys(logs).filter(d => logs[d]?.finished).sort();
  if (!sorted.length) out.push({ level: "info", text: "Подсказки появятся после первых тренировок: нужно хотя бы две записи по упражнению." });
  return out;
}

const pct = x => Math.round(x * 100) + "%";
export function addDays(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// ---------- итоги года ----------
// Всё считается из журнала и сводки героя: сколько сделано, рекорды «было → стало», лучшие бои, календарь.
const FAMILY = [["goblin", "Гоблины"], ["undead", "Нежить"], ["orc", "Орки"], ["dragon", "Драконы"], ["lizard", "Ящеролюди"], ["demon", "Демоны"], ["treant", "Энты"], ["minotaur", "Минотавры"], ["boss", "Боссы"]];
export function yearStats(logs, sum, today) {
  let fights = 0, reps = 0, tonnage = 0, sets = 0;
  const cal = {};   // дата (фактическая) → kill | fled | cardio | skip | plan
  for (const d of DAYS) {
    const L = logs[d.date];
    if (isCardio(d)) {
      if (L && (L.finished || L.items?.some(x => x.done))) cal[d.on] = "cardio";
      else if (!isOptional(d)) cal[d.on] ||= "plan";
      continue;
    }
    if (L?.skipped) { cal[d.on] = "skip"; continue; }
    const b = battle(d, L);
    if (b.setsDone && (L.finished || d.on < today)) { fights++; cal[L.performedOn || d.on] = b.killed ? "kill" : "fled"; }
    else if (!isOptional(d)) cal[d.on] ||= "plan";
  }
  // Объём: все подходы, включая свои упражнения и вылазки. Тоннаж — только подходы с весом в кг.
  for (const [key, L] of Object.entries(logs)) {
    if (!L || L.deleted || L.skipped || (!DAY_BY_DATE[key] && !isSortieKey(key))) continue;
    const day = DAY_BY_DATE[key];
    const rows = [...(L.replaced ? [] : (L.items || []).map((li, i) => [li, day?.items[i]])), ...(L.extra || []).map(x => [x, null])];
    for (const [li, it] of rows) {
      const w = kg(li?.weight ?? it?.weight ?? "");
      for (const r of li?.reps || []) { if (!(+r > 0)) continue; reps += +r; sets++; if (w > 0) tonnage += +r * w; }
    }
    if (!day) cal[sortieDate(L)] ||= "cardio";
  }
  const series = exerciseSeries(logs).filter(s => s.points.length >= 1);
  const records = series.map(s => {
    const p = s.points, first = p[0], best = p.reduce((a, x) => (x.kg > a.kg || (x.kg === a.kg && x.best > a.best) ? x : a), p[0]);
    return { name: s.name, unit: s.unit, n: p.length, from: first, to: best, grew: best.kg > first.kg || best.best > first.best };
  }).sort((a, b) => b.n - a.n);
  const days = Object.entries(sum.perDay).filter(([d]) => DAY_BY_DATE[d] && sum.perDay[d].battle);
  const top = (f) => days.reduce((a, x) => (f(x[1]) > (a ? f(a[1]) : -1) ? x : a), null);
  const bestXp = top(p => p.xp), bestOver = top(p => p.battle.hp ? p.battle.over / p.battle.hp : 0), bestCrit = top(p => p.prs || 0);
  // Хронология больших побед: боссы, вожаки, боссы событий.
  const big = days.filter(([d, p]) => { const m = monsterFor(DAY_BY_DATE[d]); return p.battle.killed && m && (m.boss || m.chief || m.event); })
    .map(([d, p]) => ({ date: DAY_BY_DATE[d].on, name: monsterFor(DAY_BY_DATE[d]).name, xp: p.xp })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const families = FAMILY.map(([k, name]) => ({ name, n: Object.entries(sum.killed).filter(([id]) => id.startsWith(k)).reduce((a, [, v]) => a + v, 0) })).filter(f => f.n);
  const wk = weekly(logs, today).filter(w => !w.current);
  const planPct = wk.length ? wk.reduce((a, w) => a + Math.min(w.pct, 1), 0) / wk.length : null;
  const pick = x => x && { date: DAY_BY_DATE[x[0]].on, name: monsterFor(DAY_BY_DATE[x[0]])?.name || "", ...x[1] };
  return { fights, reps, sets, tonnage: Math.round(tonnage), planPct, records, bestXp: pick(bestXp), bestOver: pick(bestOver), bestCrit: bestCrit && bestCrit[1].prs ? pick(bestCrit) : null, big, families, cal };
}
