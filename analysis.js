// Встроенный разбор прогресса: работает без Claude и без интернета.
// Ряды по упражнениям, выполнение плана по неделям и простые правила-подсказки.
import { DAYS, WEEKS, DAY_BY_DATE, parsePlan, normName, kg, isCardio, battle, weekGoal, isSortieKey, sortieDate } from "./game.js";

// Ряд по каждому упражнению: лучшая попытка, сумма повторов, вес, доля плана.
// Свои упражнения (дополнение, замена, вылазка) идут в те же ряды по названию, но без доли плана.
export function exerciseSeries(logs) {
  const by = {};
  for (const key0 of Object.keys(logs)) {
    const day = DAY_BY_DATE[key0], L = logs[key0];
    if (!L || L.deleted || (!day && !isSortieKey(key0))) continue;
    const date = day ? key0 : sortieDate(L);
    const rows = [
      ...(day && !L.replaced ? day.items.map((it, i) => it.type === "ex" && [it, L.items?.[i], parsePlan(it)]) : []),
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
