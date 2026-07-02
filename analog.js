'use strict';
/*
 * Analog finder — подбор аналога SHUFT ⇄ конкуренты. Методика: LOGIC.md, раздел 10.
 * Надстройка над data.json: не меняет движок рейтинга (rating.js) и логику сравнения.
 *
 * Жёсткие условия кандидата: тот же тип, противоположный «лагерь» брендов
 * (SHUFT ⇄ не-SHUFT), расход обеих сторон известен и в окне ±40%.
 * Балл соответствия 0–100 — взвешенная сумма мер близости; отсутствующие данные
 * исключают параметр с перенормировкой весов. Цена в балл не входит (Δ цены — результат).
 */
const ANALOG = (function () {

  const WEIGHTS = {
    supply: { flow: 40, heater: 15, funcs: 15, noise: 10, thick: 10, filter: 10 },
    pvu:    { flow: 35, heater: 10, funcs: 10, noise: 10, thick: 10, filter: 10, eff: 15 },
  };
  const PARAM_LABELS = {
    flow: 'Расход', heater: 'Нагреватель', funcs: 'Функции',
    noise: 'Шум', thick: 'Толщина', filter: 'Фильтрация', eff: 'КПД',
  };
  const FLOW_WINDOW = 0.40;   // окно кандидатов по расходу (±40%)
  const MIN_SCORE   = 50;     // ниже — не показываем
  const TOP_N       = 5;
  const FUNC_KEYS   = ['wifi', 'vav', 'humidity', 'co2'];

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isYes = v => String(v == null ? '' : v).trim().toLowerCase() === 'да';

  // тип нагревателя: 'water' | 'electric' | 'both' | 'none' | null (н/д)
  function heaterKind(m) {
    const v = String(m.heater_type == null ? '' : m.heater_type).trim().toLowerCase();
    if (!v || v === 'н/д') return null;
    const w = v.includes('вод'), e = v.includes('электр');
    if (w && e) return 'both';
    if (w) return 'water';
    if (e) return 'electric';
    if (v.includes('нет')) return 'none';
    return null;
  }
  // true/false — совместимы ли типы; null — неизвестно (параметр выпадает)
  function heaterCompatible(a, b) {
    if (a == null || b == null) return null;
    if (a === b) return true;
    if (a === 'both' || b === 'both') return true;   // «вода+электро» покрывает оба
    return false;
  }

  // ───────────────── балл соответствия ─────────────────
  function similarity(orig, cand) {
    const W = WEIGHTS[orig.type];
    const parts = {};

    const df = Math.abs(cand.flow_max - orig.flow_max) / orig.flow_max;
    parts.flow = clamp(100 * (1 - df / FLOW_WINDOW), 0, 100);

    const hc = heaterCompatible(heaterKind(orig), heaterKind(cand));
    parts.heater = hc == null ? null : (hc ? 100 : 0);

    const need = FUNC_KEYS.filter(k => isYes(orig[k]));                 // набор функций оригинала
    parts.funcs = need.length === 0 ? 100
      : need.filter(k => isYes(cand[k])).length / need.length * 100;    // покрытие набора

    if (orig.noise_max != null && cand.noise_max != null) {
      const d = Math.abs(cand.noise_max - orig.noise_max);
      parts.noise = d <= 2 ? 100 : clamp(100 - (d - 2) * (100 / 13), 0, 100);  // 2 дБ → 100, 15 дБ → 0
    } else parts.noise = null;

    if (orig.thickness != null && cand.thickness != null && orig.thickness > 0) {
      const dt = Math.abs(cand.thickness - orig.thickness) / orig.thickness;
      parts.thick = clamp(100 * (1 - dt / 0.5), 0, 100);
    } else parts.thick = null;

    if (orig.filter_rank != null && cand.filter_rank != null) {
      parts.filter = cand.filter_rank >= orig.filter_rank
        ? 100
        : clamp(100 - 20 * (orig.filter_rank - cand.filter_rank), 0, 100);     // хуже → −20/ступень
    } else parts.filter = null;

    if (orig.type === 'pvu') {
      parts.eff = (orig.eff != null && cand.eff != null && orig.eff > 0)
        ? clamp(100 * (1 - (Math.abs(cand.eff - orig.eff) / orig.eff) / 0.3), 0, 100)
        : null;
    }

    let wsum = 0, acc = 0, used = 0;
    Object.keys(W).forEach(k => {
      if (parts[k] != null) { wsum += W[k]; acc += parts[k] * W[k]; used++; }
    });
    return {
      score: wsum ? Math.round(acc / wsum) : 0,
      parts, used, total: Object.keys(W).length,
    };
  }

  function catOf(score) {
    if (score >= 85) return 'точный аналог';
    if (score >= 70) return 'близкий аналог';
    return 'частичный аналог';
  }

  // человекочитаемый разбор (для title-подсказки)
  function explain(sim) {
    return Object.keys(sim.parts)
      .map(k => sim.parts[k] == null ? `${PARAM_LABELS[k]}: н/д` : `${PARAM_LABELS[k]}: ${Math.round(sim.parts[k])}`)
      .join(' · ');
  }

  // ───────────────── подбор ─────────────────
  // findAnalogs(orig, data, {ignoreHeater}) →
  //   { list:[{model, score, cat, used, total, explain}], hiddenByHeater, reason }
  function findAnalogs(orig, data, opts) {
    const ignoreHeater = !!(opts && opts.ignoreHeater);
    if (orig.flow_max == null) return { list: [], hiddenByHeater: 0, reason: 'no-flow' };

    const toShuft = orig.brand !== 'SHUFT';
    const pool = data.filter(m =>
      m.type === orig.type && m.id !== orig.id &&
      (toShuft ? m.brand === 'SHUFT' : m.brand !== 'SHUFT') &&
      m.flow_max != null &&
      Math.abs(m.flow_max - orig.flow_max) / orig.flow_max <= FLOW_WINDOW);
    if (!pool.length) return { list: [], hiddenByHeater: 0, reason: 'no-window' };

    const ok = orig.brand, scored = pool.map(m => {
      const sim = similarity(orig, m);
      return { model: m, score: sim.score, cat: catOf(sim.score), used: sim.used,
               total: sim.total, explain: explain(sim),
               heaterOk: heaterCompatible(heaterKind(orig), heaterKind(m)) !== false };
    }).filter(r => r.score >= MIN_SCORE);

    const strict = scored.filter(r => r.heaterOk);
    const chosen = ignoreHeater ? scored : strict;
    chosen.sort((a, b) => b.score - a.score ||
      ((b.model._rating ? b.model._rating.total : 0) - (a.model._rating ? a.model._rating.total : 0)));

    return {
      list: chosen.slice(0, TOP_N),
      hiddenByHeater: scored.length - strict.length,
      reason: chosen.length ? null : 'no-score',
    };
  }

  return { WEIGHTS, FLOW_WINDOW, MIN_SCORE, TOP_N, PARAM_LABELS,
           findAnalogs, similarity, heaterKind, catOf };
})();
