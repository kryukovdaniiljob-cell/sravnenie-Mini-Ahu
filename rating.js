'use strict';
/*
 * Rating engine (0–100) — методика SHUFT для приточных и приточно-вытяжных установок.
 * Баллы считаются ВНУТРИ типа: сегментные параметры нормируются внутри сегмента
 * (меньше = лучше), абсолютные — глобально по типу (больше = лучше). Правила краёв:
 * нет данных → 0, нет разброса (max==min) → 50. Итог = среднее всех параметров
 * (ПВУ: 6 с КПД, приточные: 5 без КПД). Полное описание — LOGIC.md.
 *
 * Единый источник правды: и каталог, и калькулятор, и справочник используют CONFIG.
 */
const RATING = (function () {

  // ───────────────────────── CONFIG ─────────────────────────
  const TYPES = {
    pvu: {
      label: 'Приточно-вытяжные',
      short: 'ПВУ',
      params: ['price', 'thick', 'noise', 'filter', 'func', 'eff'],   // 6
      segments: [[250,'S1'],[400,'S2'],[550,'S3'],[900,'S4'],[1300,'S5'],[1700,'S6'],[2500,'S7'],[Infinity,'S8']],
    },
    supply: {
      label: 'Приточные',
      short: 'ПУ',
      params: ['price', 'thick', 'noise', 'filter', 'func'],          // 5
      segments: [[500,'S1'],[800,'S2'],[1400,'S3'],[2500,'S4'],[3500,'S5'],[5000,'S6'],[Infinity,'S7']],
    },
  };

  // лестница рангов класса фильтрации
  const LADDER = [['H14',18],['H13',17],['H11',15],['HEPA',15],['E12',14],['E11',13],
    ['EPA',12],['E10',12],['EU9',11],['F9',11],['F8',10],['EU7',9],['F7',9],['F6',8],
    ['EU5',7],['F5',7],['M6',6],['M5',6],['EU4',4],['G4',4],['EU3',3],['G3',3],['G2',2],
    ['ПЫЛЕВОЙ',2],['G1',1]];

  const PARAM = {
    price:  { label:'Цена',       icon:'💰', kind:'seg',  field:'price_num',   better:'low',
              desc:'Стоимость относительно моделей своего размерного класса (сегмента).' },
    thick:  { label:'Толщина',    icon:'📐', kind:'seg',  field:'thickness',   better:'low',
              desc:'Наименьший габарит (компактность монтажа) внутри сегмента.' },
    noise:  { label:'Шум',        icon:'🔇', kind:'seg',  field:'noise_max',   better:'low',
              desc:'Максимальный уровень шума, дБ(А). Метрика приблизительная.' },
    filter: { label:'Фильтрация', icon:'🧼', kind:'glob', field:'filter_rank', better:'high',
              desc:'Класс фильтра по лестнице рангов. Абсолютная шкала по всему типу.' },
    func:   { label:'Функции',    icon:'🧩', kind:'func', field:'func_count',  better:'high',
              desc:'Кол-во из 4: Wi-Fi, VAV, влажность, CO₂. Балл = n / 4 × 100.' },
    eff:    { label:'КПД',        icon:'🔁', kind:'glob', field:'eff',         better:'high',
              desc:'КПД рекуператора, %. Только для ПВУ. Абсолютная шкала по типу.' },
  };

  // ───────────────────────── helpers ─────────────────────────
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const intsOf = s => { const m = String(s == null ? '' : s).match(/\d+/g); return m ? m.map(Number) : []; };
  const isYes  = v => String(v == null ? '' : v).trim().toLowerCase().startsWith('да');  // «да (web)» и т.п.

  function priceNum(b)  { const d = String(b == null ? '' : b).replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : null; }
  function flowMax(e)   { const x = intsOf(e); return x.length ? Math.max(...x) : null; }
  function thicknessOf(g){ if (/запрос/i.test(g || '')) return null; const x = intsOf(g).filter(n => n >= 50); return x.length ? Math.min(...x) : null; }
  function noiseMax(l)  { const x = intsOf(l).filter(n => n >= 10 && n <= 90); return x.length ? Math.max(...x) : null; }
  function effPct(u)    { const m = String(u == null ? '' : u).match(/(\d+)\s*%/); return m ? parseInt(m[1], 10) : null; }
  function filterRank(q){
    const up = String(q == null ? '' : q).toUpperCase().replace(/\s/g, '');
    let best = null;
    for (const [key, rank] of LADDER) if (up.includes(key)) best = best == null ? rank : Math.max(best, rank);
    return best;
  }
  function funcCount(o) { return [o.wifi, o.vav, o.humidity, o.co2].filter(isYes).length; }

  function segment(flow, type) {
    if (flow == null) return null;
    for (const [hi, name] of TYPES[type].segments) if (flow <= hi) return name;
    return TYPES[type].segments[TYPES[type].segments.length - 1][1];
  }
  function segLabel(type, name) {
    const segs = TYPES[type].segments;
    for (let i = 0; i < segs.length; i++) if (segs[i][1] === name) {
      const hi = segs[i][0];
      if (hi === Infinity) return `> ${segs[i - 1][0].toLocaleString('ru-RU')}`;
      if (i === 0) return `≤ ${hi.toLocaleString('ru-RU')}`;
      return `${(segs[i - 1][0] + 1).toLocaleString('ru-RU')}–${hi.toLocaleString('ru-RU')}`;
    }
    return '';
  }

  // ───────────────────────── inputs ─────────────────────────
  function inputsOf(m) {
    return {
      type:   m.type,
      price:  m.price_num   != null ? m.price_num   : priceNum(m.price),
      flow:   m.flow_max    != null ? m.flow_max    : flowMax(m.flow),
      thick:  m.thickness   != null ? m.thickness   : thicknessOf(m.dims),
      noise:  m.noise_max   != null ? m.noise_max   : noiseMax(m.noise),
      filter: m.filter_rank != null ? m.filter_rank : filterRank(m.filter_class),
      func:   m.func_count  != null ? m.func_count  : funcCount(m),
      eff:    m.type === 'pvu' ? (m.eff != null ? m.eff : effPct(m.recup_eff)) : null,
    };
  }

  // ───────────────────────── bounds (per type) ─────────────────────────
  const _bounds = {};
  function computeBounds(list, type) {
    const seg = { price:{}, thick:{}, noise:{} };
    const glob = {};
    const globKeys = ['filter'].concat(type === 'pvu' ? ['eff'] : []);
    list.forEach(m => {
      const inp = inputsOf(m), sg = segment(inp.flow, type);
      ['price','thick','noise'].forEach(p => {
        const v = inp[p]; if (v == null || sg == null) return;
        const b = seg[p][sg] || (seg[p][sg] = { min:v, max:v });
        b.min = Math.min(b.min, v); b.max = Math.max(b.max, v);
      });
      globKeys.forEach(p => {
        const v = inp[p]; if (v == null) return;
        const g = glob[p] || (glob[p] = { min:v, max:v });
        g.min = Math.min(g.min, v); g.max = Math.max(g.max, v);
      });
    });
    return { seg, glob };
  }

  // ───────────────────────── core compute ─────────────────────────
  // inp (parsed) + bounds + type → { total, parts:{key:{score,active}}, segment }
  function scoreOne(inp, bounds, type) {
    const sg = segment(inp.flow, type);
    const segScore = p => {
      const v = inp[p];
      if (v == null || sg == null) return { score:0, active:false };
      const b = bounds.seg[p][sg];
      if (!b) return { score:0, active:false };
      if (b.max === b.min) return { score:50, active:true };
      return { score: clamp(100 * (b.max - v) / (b.max - b.min), 0, 100), active:true };   // less = better
    };
    const globScore = p => {
      const v = inp[p];
      if (v == null) return { score:0, active:false };
      const g = bounds.glob[p];
      if (!g) return { score:0, active:false };
      if (g.max === g.min) return { score:50, active:true };
      return { score: clamp(100 * (v - g.min) / (g.max - g.min), 0, 100), active:true };    // more = better
    };
    const parts = {
      price:  segScore('price'),
      thick:  segScore('thick'),
      noise:  segScore('noise'),
      filter: globScore('filter'),
      func:   { score: inp.func / 4 * 100, active:true },
    };
    if (type === 'pvu') parts.eff = globScore('eff');
    const keys = TYPES[type].params;
    let sum = 0; keys.forEach(k => sum += parts[k].score);
    return { total: Math.round(sum / keys.length), parts, segment: sg, type };
  }

  // ───────────────────────── public: apply to DB ─────────────────────────
  function applyToAll(models) {
    Object.keys(TYPES).forEach(type => {
      const list = models.filter(m => m.type === type);
      const bounds = computeBounds(list, type);
      _bounds[type] = bounds;
      list.forEach(m => { m._rating = scoreOne(inputsOf(m), bounds, type); });
      // эталон сегмента — макс. ИТОГ внутри сегмента
      const byseg = {};
      list.forEach(m => { const s = m._rating.segment; if (s == null) return; (byseg[s] || (byseg[s] = [])).push(m); });
      Object.values(byseg).forEach(arr => {
        let best = arr[0]; arr.forEach(m => { if (m._rating.total > best._rating.total) best = m; });
        arr.forEach(m => { m._rating.segLeader = (m === best); });
      });
    });
    return models;
  }

  // hypothetical model (calculator) — score against the loaded sample of `type`
  function computeFor(type, raw) {
    const inp = {
      type, price: raw.price, flow: raw.flow, thick: raw.thick, noise: raw.noise,
      filter: raw.filterClass != null && raw.filterClass !== '' ? filterRank(raw.filterClass) : null,
      func:   ['wifi','vav','humidity','co2'].filter(k => raw.funcs && raw.funcs[k]).length,
      eff:    type === 'pvu' ? (raw.eff != null && raw.eff !== '' ? parseInt(raw.eff, 10) : null) : null,
    };
    const b = _bounds[type] || computeBounds([], type);
    const r = scoreOne(inp, b, type);
    r.filterRank = inp.filter;
    return r;
  }

  // ───────────────────────── star HTML ─────────────────────────
  function stars(total) {
    const p = clamp(total / 100, 0, 1) * 100;
    return `<span class="stars" title="${total}/100"><span class="stars__bg">★★★★★</span><span class="stars__on" style="width:${p}%">★★★★★</span></span>`;
  }

  return {
    TYPES, PARAM, LADDER,
    applyToAll, computeFor, inputsOf, segment, segLabel, stars,
    filterRank, flowMax, priceNum, thicknessOf, noiseMax, effPct,
    renderReference, renderCalculator,
  };

  // ───────────────────────── Reference UI (type-aware) ─────────────────────────
  function renderReference(el, type) {
    const T = TYPES[type];
    const N = T.params.length;
    const paramCards = T.params.map(k => {
      const m = PARAM[k];
      const kindBadge = m.kind === 'seg'
        ? '<span class="ref-tag ref-tag--seg">сегментный · меньше лучше</span>'
        : (m.kind === 'func'
          ? '<span class="ref-tag ref-tag--abs">абсолютный</span>'
          : '<span class="ref-tag ref-tag--abs">абсолютный · больше лучше</span>');
      const formula = m.kind === 'seg'
        ? '100 × (Макс_сег − знач.) / (Макс_сег − Мин_сег)'
        : (m.kind === 'func' ? 'кол-во «да» / 4 × 100' : '100 × (знач. − Мин_глоб) / (Макс_глоб − Мин_глоб)');
      return `<div class="ref-ind">
        <div class="ref-ind__head"><span>${m.icon} ${m.label}</span>${kindBadge}</div>
        <div class="ref-ind__desc">${m.desc}</div>
        <div class="ref-formula">${formula}</div></div>`;
    }).join('');

    const filterRows = LADDER.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const segRows = T.segments.map(([, name]) =>
      `<tr><td>${name}</td><td>${segLabel(type, name)} м³/ч</td></tr>`).join('');

    el.innerHTML = `
      <p class="ref-lead">Итоговый балл (0–100) — <b>среднее ${N} равновесных параметров</b>
        ${type === 'pvu' ? '(включая КПД рекуператора)' : '(без КПД — у приточных нет рекуперации)'}.
        Пропущенные параметры засчитываются как <b>0</b>, поэтому неполные позиции не завышаются.</p>
      <div class="ref-formula-big">ИТОГ = (${T.params.map(k => PARAM[k].label).join(' + ')}) / ${N}</div>
      <div class="ref-grid">${paramCards}</div>
      <div class="ref-rules">
        <b>Правила краёв (для всех параметров):</b>
        <ul><li>нет данных (н/д) → балл <b>0</b> (штраф за неполноту);</li>
        <li>нет разброса в выборке (Макс = Мин) → балл <b>50</b> (нейтрально).</li></ul>
        <p class="ref-small">Сегментные параметры нормируются внутри своего размерного класса (сегмента),
        абсолютные — глобально по всему типу «${T.label}». Шум измеряется производителями по-разному —
        балл приблизительный.</p>
      </div>
      <div class="ref-tables">
        <div class="ref-tbl"><h4>Сегменты по расходу (${T.label.toLowerCase()})</h4>
          <table><tr><th>Сегм.</th><th>Расход</th></tr>${segRows}</table></div>
        <div class="ref-tbl"><h4>Ранги класса фильтрации</h4>
          <table><tr><th>Класс</th><th>Ранг</th></tr>${filterRows}</table>
          <p class="ref-small">Несколько классов → берём максимальный ранг. Нет совпадения → нет данных (0).</p></div>
      </div>`;
  }

  // ───────────────────────── Calculator UI (type-aware) ─────────────────────────
  function renderCalculator(el, type) {
    const isPvu = type === 'pvu';
    el.innerHTML = `
      <div class="calc-grid">
        <label>Цена, ₽<input type="number" id="calcPrice" placeholder="275000" min="0"></label>
        <label>Расход воздуха, м³/ч<input type="text" id="calcFlow" placeholder="450-1000 или 1000"></label>
        <label>Толщина (мин. габарит), мм<input type="number" id="calcThick" placeholder="280" min="0"></label>
        <label>Уровень шума, дБ(А)<input type="text" id="calcNoise" placeholder="50-58 или 35"></label>
        <label>Класс фильтра<input type="text" id="calcFilter" placeholder="G4 / EU9 / HEPA"></label>
        ${isPvu ? '<label>КПД рекуператора, %<input type="number" id="calcEff" placeholder="85" min="0" max="100"></label>' : ''}
      </div>
      <div class="calc-funcs">Функции:
        ${[['wifi','Wi-Fi'],['vav','VAV'],['humidity','Влажность'],['co2','CO₂']]
          .map(([k, l]) => `<label class="calc-fchk"><input type="checkbox" data-func="${k}">${l}</label>`).join('')}
      </div>
      <div class="calc-result" id="calcResult"></div>`;

    const get = id => el.querySelector('#' + id);
    function readInputs() {
      const funcs = {};
      el.querySelectorAll('[data-func]').forEach(c => funcs[c.dataset.func] = c.checked);
      return {
        price: get('calcPrice').value ? parseFloat(get('calcPrice').value) : null,
        flow:  flowMax(get('calcFlow').value),
        thick: get('calcThick').value ? parseFloat(get('calcThick').value) : null,
        noise: noiseMax(get('calcNoise').value),
        filterClass: get('calcFilter').value.trim(),
        eff:   isPvu && get('calcEff') && get('calcEff').value ? get('calcEff').value : null,
        funcs,
      };
    }
    function update() {
      const r = computeFor(type, readInputs());
      const sgTxt = r.segment ? `${r.segment} · ${segLabel(type, r.segment)} м³/ч` : 'сегмент не определён (нет расхода)';
      const rows = TYPES[type].params.map(k => {
        const b = r.parts[k], m = PARAM[k];
        return `<div class="calc-row ${b.active ? '' : 'is-off'}">
          <span class="calc-row__name">${m.icon} ${m.label}</span>
          <span class="calc-row__bar"><span style="width:${b.active ? b.score : 0}%"></span></span>
          <span class="calc-row__val">${b.active ? Math.round(b.score) : 'нет данных'}</span></div>`;
      }).join('');
      get('calcResult').innerHTML = `
        <div class="calc-total"><div class="calc-total__num">${r.total}</div>
          <div class="calc-total__sub">${stars(r.total)}<span class="calc-scale">${sgTxt}</span></div></div>
        <div class="calc-rows">${rows}</div>`;
    }
    el.addEventListener('input', update);
    update();
  }
})();
