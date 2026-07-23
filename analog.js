'use strict';
/*
 * Analog finder v2 — подбор аналога SHUFT ⇄ конкуренты. Методика: LOGIC.md §10.
 * Надстройка над data.json: не меняет движок рейтинга (rating.js).
 *
 * Жёсткие условия кандидата: тот же тип, противоположный «лагерь» (SHUFT ⇄ не-SHUFT),
 * расход в асимметричном окне −25%…+40% (авторасширение до ±40%, если кандидатов < 3),
 * совместимое питание (220⇄380 — блокер), совместимое семейство рекуператора для ПВУ
 * (роторный ⇄ пластинчатый — блокер). «н/д» не блокирует, а помечается.
 *
 * Балл 0–100 — взвешенная сумма мер близости; отсутствующие данные исключают параметр
 * с перенормировкой весов. Цена в балл не входит: при разнице баллов ≤ 5 выше встаёт
 * кандидат выгоднее по цене (тай-брейкер), Δ цены показывается бейджем.
 */
const ANALOG = (function () {

  const WEIGHTS = {
    supply: { flow: 35, heater: 15, funcs: 15, noise: 10, thick: 10, filter: 10, motor: 5 },
    pvu:    { flow: 30, heater: 10, funcs: 10, noise: 8,  thick: 8,  filter: 9, eff: 12, recupSim: 8, motor: 5 },
  };
  const PARAM_LABELS = {
    flow: 'Расход', heater: 'Нагреватель', funcs: 'Функции', noise: 'Шум',
    thick: 'Толщина', filter: 'Фильтрация', eff: 'КПД', recupSim: 'Тип рекуператора', motor: 'Двигатель',
  };
  const FLOW_BELOW  = 0.25;   // окно вниз: кандидат слабее оригинала max на 25%
  const FLOW_ABOVE  = 0.40;   // окно вверх: запас по мощности допустим до +40%
  const MIN_POOL    = 3;      // меньше кандидатов в узком окне → расширяем вниз до 40%
  const TIE_DELTA   = 5;      // близкие баллы → выгоднее по цене выше
  const MIN_SCORE   = 50;     // ниже — не показываем
  const TOP_N       = 5;
  const FUNC_KEYS   = ['wifi', 'vav', 'humidity', 'co2'];

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isYes = v => String(v == null ? '' : v).trim().toLowerCase().startsWith('да');

  // ───────────────── классификаторы ─────────────────
  // тип нагревателя: 'water' | 'electric' | 'both' | 'none' | null (н/д)
  function heaterKind(m) {
    const v = String(m.heater_type == null ? '' : m.heater_type).trim().toLowerCase();
    if (!v || v === 'н/д') return null;
    const w = v.includes('вод'), e = v.includes('электр');
    if (w && e) return 'both';
    if (w) return 'water';
    if (e) return 'electric';
    if (v.includes('нет')) return 'none';
    return null;                       // «опция» и пр. — неизвестно
  }
  function heaterCompatible(a, b) {
    if (a == null || b == null) return null;
    if (a === b) return true;
    if (a === 'both' || b === 'both') return true;
    return false;
  }

  // питание: '1' (220/230В) | '3' (380/400В) | 'both' | null
  function powerKind(m) {
    const v = String(m.power == null ? '' : m.power);
    const has3 = /380|400/.test(v), has1 = /220|230/.test(v);
    if (has3 && has1) return 'both';
    if (has3) return '3';
    if (has1) return '1';
    return null;
  }
  function powerCompatible(a, b) {
    if (a == null || b == null) return null;
    if (a === b || a === 'both' || b === 'both') return true;
    return false;
  }

  // семейство рекуператора (ПВУ): 'rotary' | 'enthalpy' | 'plate' | null
  function recupFamily(m) {
    const v = String(m.recup_type == null ? '' : m.recup_type).toLowerCase();
    if (!v || v === 'н/д' || v === 'нет') return null;
    if (v.includes('ротор')) return 'rotary';
    if (v.includes('энтальп') || v.includes('мембран')) return 'enthalpy';
    if (v.includes('пластин') || v.includes('перекрест')) return 'plate';
    return null;
  }
  // true=совместимы, false=блокер (ротор ⇄ пластина), null=неизвестно
  function recupCompatible(a, b) {
    if (a == null || b == null) return null;
    if (a === b) return true;
    if (a === 'rotary' || b === 'rotary') return false;   // роторный ⇄ пластинчатый/энтальпийный
    return true;                                           // plate ⇄ enthalpy — допустимо (штраф в балле)
  }

  // двигатель: 'ec' | 'ac' | null  (DC-двигатели считаем классом EC — тоже с плавным управлением)
  function motorKind(m) {
    const v = String(m.motor == null ? '' : m.motor).toUpperCase().replace('Е', 'E').replace('А', 'A').replace('С', 'C');
    if (/\bEC\b|\bDC\b/.test(v)) return 'ec';
    if (/\bAC\b/.test(v)) return 'ac';
    return null;
  }

  // ───────────────── балл соответствия ─────────────────
  function similarity(orig, cand) {
    const W = WEIGHTS[orig.type];
    const parts = {};

    // расход: асимметрия — «слабее» карается круче (окно −25%), чем «мощнее» (+40%)
    const dr = (cand.flow_max - orig.flow_max) / orig.flow_max;
    parts.flow = dr >= 0
      ? clamp(100 * (1 - dr / FLOW_ABOVE), 0, 100)
      : clamp(100 * (1 + dr / FLOW_BELOW), 0, 100);

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

    // двигатель: AC вместо EC — минус; EC вместо AC — апгрейд без штрафа
    const mo = motorKind(orig), mc = motorKind(cand);
    parts.motor = (mo == null || mc == null) ? null
      : (mo === mc || mc === 'ec') ? 100 : 0;

    if (orig.type === 'pvu') {
      parts.eff = (orig.eff != null && cand.eff != null && orig.eff > 0)
        ? clamp(100 * (1 - (Math.abs(cand.eff - orig.eff) / orig.eff) / 0.3), 0, 100)
        : null;
      // семейство рекуператора: идентичное → 100, совместимое-но-разное (пластина⇄энтальпия) → 70
      const fo = recupFamily(orig), fc = recupFamily(cand);
      parts.recupSim = (fo == null || fc == null) ? null
        : (fo === fc ? 100 : (recupCompatible(fo, fc) ? 70 : 0));
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

  function explain(sim) {
    return Object.keys(sim.parts)
      .map(k => sim.parts[k] == null ? `${PARAM_LABELS[k]}: н/д` : `${PARAM_LABELS[k]}: ${Math.round(sim.parts[k])}`)
      .join(' · ');
  }

  // ───────────────── подбор ─────────────────
  // findAnalogs(orig, data, {showAll}) →
  //   { list:[{model, score, cat, used, total, explain, flags}], hiddenHard, widened, reason }
  // flags: {heaterOk, powerOk, recupOk, powerUnknown, recupUnknown, blocked}
  function findAnalogs(orig, data, opts) {
    const showAll = !!(opts && (opts.showAll || opts.ignoreHeater));   // back-compat
    if (orig.flow_max == null) return { list: [], hiddenHard: 0, widened: false, reason: 'no-flow' };

    const toShuft = orig.brand !== 'SHUFT';
    const inWindow = (m, below) =>
      m.flow_max >= orig.flow_max * (1 - below) &&
      m.flow_max <= orig.flow_max * (1 + FLOW_ABOVE);
    const base = data.filter(m =>
      m.type === orig.type && m.id !== orig.id &&
      (toShuft ? m.brand === 'SHUFT' : m.brand !== 'SHUFT') &&
      m.flow_max != null);

    let widened = false;
    let pool = base.filter(m => inWindow(m, FLOW_BELOW));
    if (pool.length < MIN_POOL) {                        // мало кандидатов → окно вниз до 40%
      const wide = base.filter(m => inWindow(m, FLOW_ABOVE));
      if (wide.length > pool.length) { pool = wide; widened = true; }
    }
    if (!pool.length) return { list: [], hiddenHard: 0, widened, reason: 'no-window' };

    const scored = pool.map(m => {
      const sim = similarity(orig, m);
      const pk = powerCompatible(powerKind(orig), powerKind(m));
      const rk = orig.type === 'pvu' ? recupCompatible(recupFamily(orig), recupFamily(m)) : true;
      const hk = heaterCompatible(heaterKind(orig), heaterKind(m));
      const flags = {
        heaterOk: hk !== false,
        powerOk:  pk !== false,
        recupOk:  rk !== false,
        powerUnknown: pk == null,
        recupUnknown: orig.type === 'pvu' && rk == null,
      };
      flags.blocked = !(flags.heaterOk && flags.powerOk && flags.recupOk);
      return { model: m, score: sim.score, cat: catOf(sim.score), used: sim.used,
               total: sim.total, explain: explain(sim), flags };
    }).filter(r => r.score >= MIN_SCORE);

    const strict = scored.filter(r => !r.flags.blocked);
    const chosen = showAll ? scored : strict;

    // балл ↓; при |Δ| ≤ TIE_DELTA — выгоднее по цене выше (без цены — вниз); затем рейтинг модели
    chosen.sort((a, b) => {
      if (Math.abs(a.score - b.score) <= TIE_DELTA) {
        const pa = a.model.price_num, pb = b.model.price_num;
        if (pa != null && pb == null) return -1;
        if (pa == null && pb != null) return 1;
        if (pa != null && pb != null && pa !== pb) return pa - pb;
      }
      return b.score - a.score ||
        ((b.model._rating ? b.model._rating.total : 0) - (a.model._rating ? a.model._rating.total : 0));
    });

    return {
      list: chosen.slice(0, TOP_N),
      hiddenHard: scored.length - strict.length,
      widened,
      reason: chosen.length ? null : 'no-score',
    };
  }

  return { WEIGHTS, FLOW_BELOW, FLOW_ABOVE, TIE_DELTA, MIN_SCORE, TOP_N, PARAM_LABELS,
           findAnalogs, similarity, heaterKind, powerKind, recupFamily, motorKind, catOf };
})();
