'use strict';
/*
 * Rating engine (0–100) for Mini-AHU models.
 * Single source of truth: CONFIG. Both the catalogue and the calculator
 * call RATING.compute(...). Reference & calculator UIs are generated from CONFIG,
 * so they always stay in sync with the real formula.
 */
const RATING = (function () {

  // ───────────────────────── CONFIG (edit weights/thresholds here) ─────────────
  const CONFIG = {
    thresholdMode: 'static',            // 'static' | 'dynamic'
    weights: { air_value: 25, compactness: 20, filtration: 25, acoustics: 20, functionality: 10 },
    // hardcoded normalization bounds (5th / 90th percentile of the base)
    thresholds: {
      air_value:   { low: 1340, high: 4500 },   // расход / цена_млн
      compactness: { low: 1.0,  high: 5.6  },    // расход / толщина
      acoustics:   { low: 1.3,  high: 7.0  },    // 2^((65-шум)/10)
    },
    filterScores: {
      G1: 1, G2: 1.5, G3: 2, EU3: 2, G4: 4, EU4: 4, F5: 5, EU5: 5, F6: 6,
      F7: 7, EU7: 7, F8: 8, F9: 8.5, EU9: 8.5, E10: 9, E11: 9.5, E12: 9.8,
      EPA: 10, H10: 10, H11: 10, HEPA: 10, H12: 10, H13: 10, H14: 10,
    },
    functionScores: { cooler: 25, vav: 20, humidity: 15, co2: 15, wifi: 15, recup: 10 },
    dynamicMinSamples: 20,              // fewer data points → fall back to static
  };

  // descriptive metadata (used by reference & breakdown — kept next to CONFIG)
  const META = {
    air_value:     { label: 'Ценность воздуха', icon: '💨',
                     desc: 'Сколько воздуха даёт каждый рубль. Единственный показатель, где участвует цена.',
                     formula: 'Расход / Цена_млн' },
    compactness:   { label: 'Компактность', icon: '📐',
                     desc: 'Инженерная плотность потока — сколько м³/ч прокачивается через каждый мм толщины.',
                     formula: 'Расход / Толщина' },
    filtration:    { label: 'Фильтрация', icon: '🧼',
                     desc: 'Класс фильтра по таблице (0–10), затем ×10. Абсолютная шкала.',
                     formula: 'Баллы_класса × 10' },
    acoustics:     { label: 'Акустика', icon: '🔇',
                     desc: 'Тишина по логарифмической шкале (10 дБ = двукратная разница громкости).',
                     formula: '2 ^ ((65 − Шум) / 10)' },
    functionality: { label: 'Функциональность', icon: '🧩',
                     desc: 'Сумма баллов за наличие функций (макс. 100). Абсолютная шкала.',
                     formula: 'Σ баллов за «да», ≤ 100' },
  };
  const ORDER = ['air_value', 'compactness', 'filtration', 'acoustics', 'functionality'];
  const NORMALIZED = ['air_value', 'compactness', 'acoustics']; // affected by dynamic thresholds

  // ───────────────────────── helpers ─────────────────────────
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isYes = v => /^да/i.test((v ?? '').toString().trim());
  const isNd = v => { const s = (v ?? '').toString().trim().toLowerCase(); return s === '' || s === 'н/д' || s === 'none' || s === 'нд'; };

  function maxNum(s) {                   // "450-1000" | "1000" | 58 -> max number
    if (s == null || s === '') return null;
    if (typeof s === 'number') return isFinite(s) ? s : null;
    const m = String(s).replace(/ /g, ' ').match(/\d+(?:[.,]\d+)?/g);
    if (!m) return null;
    return Math.max(...m.map(x => parseFloat(x.replace(',', '.'))));
  }
  function thicknessOf(dim) {            // "660×706×280" -> 280 (smallest of ≥2)
    if (!dim || /запрос/i.test(dim)) return null;
    const parts = String(dim).split(/[x×х*]/);
    const v = [];
    parts.forEach(p => { const m = p.match(/\d+(?:[.,]\d+)?/); if (m) v.push(parseFloat(m[0].replace(',', '.'))); });
    return v.length >= 2 ? Math.min(...v) : null;
  }
  function filterPoints(filterClass, hasFilter) {
    const toks = String(filterClass || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const scores = toks.map(t => CONFIG.filterScores[t]).filter(s => s != null); // CARB & junk ignored
    if (scores.length) return Math.max(...scores);
    const h = (hasFilter ?? '').toString().toLowerCase();
    if (h.includes('да')) return CONFIG.filterScores.G4;   // filter present, class unknown -> G4
    if (h.includes('нет')) return 0;                       // no filter
    return null;                                            // nothing known -> no data
  }
  function norm(raw, t) { return raw == null ? null : clamp((raw - t.low) / (t.high - t.low), 0, 1) * 100; }
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = (p / 100) * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // ───────────────────────── inputs ─────────────────────────
  // turn a DB model (data.json) into the raw inputs the formula needs
  function deriveInputs(m) {
    return {
      priceNum:    m.price_num != null ? m.price_num : maxNum(m.price),
      flowMax:     m.flow_max  != null ? m.flow_max  : maxNum(m.flow),
      thickness:   m.thickness != null ? m.thickness : thicknessOf(m.dims),
      noiseMax:    m.noise_max != null ? m.noise_max : maxNum(m.noise),
      filterClass: m.filter_class || '',
      hasFilter:   m.filter || '',
      funcs: {
        cooler: isYes(m.cooler), vav: isYes(m.vav), humidity: isYes(m.humidity),
        co2: isYes(m.co2), wifi: isYes(m.wifi), recup: isYes(m.recup),
      },
    };
  }

  // raw (pre-normalization) value for a normalized indicator — used by dynamic thresholds
  function rawValue(key, inp) {
    if (key === 'air_value')   return (inp.priceNum > 0 && inp.flowMax != null) ? inp.flowMax / (inp.priceNum / 1e6) : null;
    if (key === 'compactness') return (inp.flowMax != null && inp.thickness > 0) ? inp.flowMax / inp.thickness : null;
    if (key === 'acoustics')   return (inp.noiseMax != null) ? Math.pow(2, (65 - inp.noiseMax) / 10) : null;
    return null;
  }

  // ───────────────────────── core compute ─────────────────────────
  // inputs -> { total, breakdown:[{key,label,icon,score,weight,effWeight,raw,active}] }
  function compute(inp, thresholds) {
    const T = thresholds || effectiveThresholds();
    const score = {
      air_value:   norm(rawValue('air_value', inp),   T.air_value),
      compactness: norm(rawValue('compactness', inp), T.compactness),
      acoustics:   norm(rawValue('acoustics', inp),   T.acoustics),
      filtration:  (() => { const p = filterPoints(inp.filterClass, inp.hasFilter); return p == null ? null : p * 10; })(),
      functionality: (() => {
        let s = 0; for (const k in CONFIG.functionScores) if (inp.funcs && inp.funcs[k]) s += CONFIG.functionScores[k];
        return Math.min(s, 100);                 // always active (absence of a function = 0, which is meaningful)
      })(),
    };
    const rows = ORDER.map(k => ({
      key: k, label: META[k].label, icon: META[k].icon,
      weight: CONFIG.weights[k], score: score[k], raw: rawValue(k, inp),
      active: score[k] != null,
    }));
    const active = rows.filter(r => r.active);
    const wsum = active.reduce((a, r) => a + r.weight, 0) || 1;
    let total = 0;
    rows.forEach(r => {
      r.effWeight = r.active ? r.weight / wsum * 100 : 0;
      if (r.active) total += r.score * r.effWeight / 100;
    });
    return { total: Math.round(total), breakdown: rows, missing: rows.filter(r => !r.active).map(r => r.key) };
  }

  // ───────────────────────── thresholds (static / dynamic + cache) ─────────────
  let _effCache = null, _cacheKey = '';
  function computeDynamic(models) {
    const out = {};
    NORMALIZED.forEach(key => {
      const vals = models.map(m => rawValue(key, deriveInputs(m)))
        .filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
      if (vals.length < CONFIG.dynamicMinSamples) { out[key] = CONFIG.thresholds[key]; return; }
      const low = percentile(vals, 5), high = percentile(vals, 90);
      out[key] = (high - low > 1e-9) ? { low, high } : CONFIG.thresholds[key];
    });
    return out;
  }
  let _models = [];
  function effectiveThresholds() {
    if (CONFIG.thresholdMode === 'static') return CONFIG.thresholds;
    const key = 'dyn:' + _models.length;
    if (_cacheKey !== key || !_effCache) { _effCache = computeDynamic(_models); _cacheKey = key; }
    return _effCache;
  }

  // ───────────────────────── public: apply to DB ─────────────────────────
  function applyToAll(models) {
    _models = models; _effCache = null; _cacheKey = '';   // invalidate cache on (re)load
    const T = effectiveThresholds();
    models.forEach(m => { m._rating = compute(deriveInputs(m), T); });
    return models;
  }
  function setMode(mode) {
    CONFIG.thresholdMode = (mode === 'dynamic') ? 'dynamic' : 'static';
    _effCache = null; _cacheKey = '';
    if (_models.length) applyToAll(_models);
  }
  function scaleNote() {
    return CONFIG.thresholdMode === 'dynamic'
      ? `шкала: рынок ${_models.length} моделей`
      : 'шкала: фикс.';
  }

  // ───────────────────────── star HTML ─────────────────────────
  function stars(total) {
    const p = clamp(total / 100, 0, 1) * 100;
    return `<span class="stars" title="${total}/100"><span class="stars__bg">★★★★★</span><span class="stars__on" style="width:${p}%">★★★★★</span></span>`;
  }

  return {
    CONFIG, META, ORDER,
    compute, deriveInputs, applyToAll, setMode, effectiveThresholds, scaleNote,
    stars, filterPoints, thicknessOf, maxNum,
    renderReference, renderCalculator,
  };

  // ───────────────────────── Reference UI ─────────────────────────
  function fmtT(t) { return `${(+t.low).toLocaleString('ru-RU')} … ${(+t.high).toLocaleString('ru-RU')}`; }
  function renderReference(el) {
    const T = effectiveThresholds();
    const w = CONFIG.weights;
    const filterRows = Object.entries(CONFIG.filterScores)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const funcRows = [['Охладитель', 'cooler'], ['VAV-регулирование', 'vav'], ['Управление влажностью', 'humidity'],
      ['Датчик CO₂', 'co2'], ['Wi-Fi / удалённо', 'wifi'], ['Рекуперация тепла', 'recup']]
      .map(([l, k]) => `<tr><td>${l}</td><td>${CONFIG.functionScores[k]}</td></tr>`).join('');
    const indCards = ORDER.map(k => {
      const m = META[k];
      const thr = T[k] ? `<div class="ref-thr">пороги (Низ … Верх): <b>${fmtT(T[k])}</b></div>` : '';
      return `<div class="ref-ind">
        <div class="ref-ind__head"><span>${m.icon} ${m.label}</span><span class="ref-w">вес ${w[k]}</span></div>
        <div class="ref-ind__desc">${m.desc}</div>
        <div class="ref-formula">Сырьё = ${m.formula}</div>${thr}</div>`;
    }).join('');
    el.innerHTML = `
      <p class="ref-lead">Итоговый балл (0–100) — взвешенная сумма пяти показателей. Каждый приводится к шкале
        0–100 и умножается на свой вес; веса дают в сумме 100.</p>
      <div class="ref-mode">Текущий режим шкалы: <b>${CONFIG.thresholdMode === 'dynamic'
        ? 'динамический (' + RATING.scaleNote() + ')' : 'статический (фикс. пороги)'}</b>.
        ${CONFIG.thresholdMode === 'dynamic'
          ? 'Оценка относительна — балл модели может меняться при добавлении других моделей.'
          : 'Пороги зафиксированы — балл модели не зависит от состава базы.'}</div>
      <div class="ref-weights">${ORDER.map(k => `<span class="ref-chip">${META[k].icon} ${META[k].label}: <b>${w[k]}</b></span>`).join('')}</div>
      <div class="ref-grid">${indCards}</div>
      <div class="ref-tables">
        <div class="ref-tbl"><h4>Баллы за класс фильтра (×10 = вклад)</h4>
          <table>${filterRows}</table>
          <p class="ref-small">Несколько классов через «/» → берём максимум. CARB игнорируется.
          Фильтр есть, класс н/д → G4 (4). Фильтра нет → 0.</p></div>
        <div class="ref-tbl"><h4>Баллы за функции (сумма, ≤100)</h4>
          <table>${funcRows}</table>
          <p class="ref-small">Нагреватель и автоматика есть почти у всех — не учитываются.</p></div>
      </div>
      <div class="ref-nodata"><b>Нет данных по показателю?</b> Мы не ставим 0 (иначе штраф за пустую графу).
        Вес показателя пропорционально перекладывается на остальные:
        <code>Новый_вес = Старый_вес / (100 − вес_пропущенного) · 100</code>.</div>`;
  }

  // ───────────────────────── Calculator UI ─────────────────────────
  function renderCalculator(el) {
    el.innerHTML = `
      <div class="calc-grid">
        <label>Цена, ₽<input type="number" id="calcPrice" placeholder="275000" min="0"></label>
        <label>Расход воздуха, м³/ч<input type="text" id="calcFlow" placeholder="450-1000 или 1000"></label>
        <label>Толщина (мин. габарит), мм<input type="number" id="calcThick" placeholder="280" min="0"></label>
        <label>Уровень шума, дБ(А)<input type="text" id="calcNoise" placeholder="50-58 или 35"></label>
        <label>Класс фильтра<input type="text" id="calcFilter" placeholder="G4/EU9/HEPA"></label>
        <label class="calc-chk2"><input type="checkbox" id="calcFilterUnknown"> фильтр есть, класс неизвестен (→ G4)</label>
      </div>
      <div class="calc-funcs">Функции:
        ${[['cooler', 'Охладитель'], ['vav', 'VAV'], ['humidity', 'Влажность'], ['co2', 'CO₂'], ['wifi', 'Wi-Fi/удал.'], ['recup', 'Рекуперация']]
          .map(([k, l]) => `<label class="calc-fchk"><input type="checkbox" data-func="${k}">${l}</label>`).join('')}
      </div>
      <div class="calc-result" id="calcResult"></div>`;

    const get = id => el.querySelector('#' + id);
    function readInputs() {
      const filterUnknown = get('calcFilterUnknown').checked;
      const fc = get('calcFilter').value.trim();
      const funcs = {};
      el.querySelectorAll('[data-func]').forEach(c => funcs[c.dataset.func] = c.checked);
      return {
        priceNum: get('calcPrice').value ? parseFloat(get('calcPrice').value) : null,
        flowMax: maxNum(get('calcFlow').value),
        thickness: get('calcThick').value ? parseFloat(get('calcThick').value) : null,
        noiseMax: maxNum(get('calcNoise').value),
        filterClass: fc,
        hasFilter: (fc || filterUnknown) ? 'да' : '',
        funcs,
      };
    }
    function update() {
      const r = compute(readInputs());
      const rows = r.breakdown.map(b => `
        <div class="calc-row ${b.active ? '' : 'is-off'}">
          <span class="calc-row__name">${b.icon} ${b.label}</span>
          <span class="calc-row__w">вес ${b.active ? Math.round(b.effWeight) : '—'}</span>
          <span class="calc-row__bar"><span style="width:${b.active ? b.score : 0}%"></span></span>
          <span class="calc-row__val">${b.active ? Math.round(b.score) : 'нет данных'}</span>
        </div>`).join('');
      get('calcResult').innerHTML = `
        <div class="calc-total"><div class="calc-total__num">${r.total}</div>
          <div class="calc-total__sub">${stars(r.total)}<span class="calc-scale">${RATING.scaleNote()}</span></div></div>
        <div class="calc-rows">${rows}</div>`;
    }
    el.addEventListener('input', update);
    update();
  }
})();
