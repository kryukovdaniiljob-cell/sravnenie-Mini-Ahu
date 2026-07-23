'use strict';

const MAX = 4;
let DATA = [];
let activeType = 'supply';                 // 'supply' | 'pvu'
let selByType = { supply: [], pvu: [] };   // selected ids per type (max 4 each)
let collapsed = {};                        // section title -> bool

const sel = () => selByType[activeType];

// priority rows (shown big at top of compare)
const PRIORITY = [
  { key: 'flow',         label: 'Расход воздуха, м³/ч' },
  { key: 'noise',        label: 'Уровень шума, дБ(А)' },
  { key: 'filter_class', label: 'Класс фильтрации' },
];
// detail sections (pvuOnly hidden for supply units)
const SECTIONS = [
  { title: '💰 Цена', rows: [['price', 'Цена, руб']] },
  { title: '📏 Габариты', rows: [['dims', 'Размеры Ш×В×Г, мм'], ['__thick', 'Толщина (мин. сторона), мм'], ['weight', 'Масса, кг']] },
  { title: '🔌 Питание и мощность', rows: [['power', 'Питание, ф/В/Гц'], ['fan_kw', 'Мощность вентиляторов, кВт'], ['heat_kw', 'Мощность нагревателя, кВт'], ['ip', 'Степень защиты IP']] },
  { title: '🌬️ Воздушный клапан', rows: [['valve', 'Воздушный клапан'], ['valve_drive', 'Привод клапана']] },
  { title: '🔁 Рекуперация', pvuOnly: true, rows: [['recup', 'Наличие рекуперации'], ['recup_type', 'Тип рекуператора'], ['recup_eff', 'КПД рекуперации, %']] },
  { title: '🔥 Нагреватель', rows: [['heater_type', 'Нагреватель (вода/электр.)'], ['heater_elem', 'Элемент (ТЭН/PTC)']] },
  { title: '❄️ Охладитель', rows: [['cooler', 'Охладитель']] },
  { title: '🌀 Вентилятор', rows: [['fan_type', 'Тип вентилятора'], ['motor', 'Двигатель (AC/EC)']] },
  { title: '🎛️ Управление', rows: [['auto', 'Автоматика'], ['controller', 'Контроллер'], ['remote', 'Пульт'], ['wifi', 'Wi-Fi'], ['vav', 'VAV'], ['humidity', 'Влажность'], ['co2', 'Датчик CO₂']] },
  { title: 'ℹ️ Дополнительно', rows: [['pressure', 'Свободный напор, Па'], ['series', 'Серия'], ['extra', 'Примечание'], ['url', 'Карточка товара'], ['passport', 'Паспорт (источник)']] },
];

const $ = (s) => document.querySelector(s);
const grid = $('#grid'), tray = $('#tray'), traySlots = $('#traySlots'),
      compare = $('#compare'), ctable = $('#ctable'), analogModal = $('#analogModal');

let analogState = { origId: null, ignoreHeater: false };   // analog-finder modal state

// ---------- init ----------
fetch('data.json')
  .then(r => r.json())
  .then(d => { DATA = d; RATING.applyToAll(DATA); init(); })
  .catch(() => { grid.innerHTML = '<div class="empty-grid">Не удалось загрузить данные.</div>'; });

function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('type') === 'pvu') activeType = 'pvu';
  const c = params.get('c');
  if (c) selByType[activeType] = c.split(',').map(Number).filter(n => DATA[n] && DATA[n].type === activeType).slice(0, MAX);

  fillBrandOptions(); fillSegOptions();

  ['search', 'fBrand', 'fSeg', 'fHeater', 'fPrice', 'fValve', 'fFilter', 'fLeaders'].forEach(id =>
    $('#' + id).addEventListener('input', renderGrid));
  $('#resetBtn').addEventListener('click', reset);
  $('#compareBtn').addEventListener('click', () => compare.scrollIntoView({ behavior: 'smooth' }));
  $('#diffToggle').addEventListener('change', applyDiff);
  document.querySelectorAll('.typeswitch__btn').forEach(b =>
    b.addEventListener('click', () => switchType(b.dataset.type)));

  // analog modal: close on ×, backdrop, Esc
  $('#analogClose').addEventListener('click', closeAnalogModal);
  analogModal.addEventListener('click', e => {
    if (e.target === analogModal || e.target.classList.contains('modal__backdrop')) closeAnalogModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !analogModal.hidden) closeAnalogModal();
  });

  applyTypeUI();
  updateNavH();
  window.addEventListener('resize', updateNavH);
  renderGrid(); renderTray(); renderCompare();
}

// keep the comparison header pinned exactly below the (only) sticky bar — the nav
function updateNavH() {
  const n = document.querySelector('.nav');
  if (n) document.documentElement.style.setProperty('--nav-h', n.offsetHeight + 'px');
}

// ---------- type switching ----------
function switchType(type) {
  if (type === activeType || !RATING.TYPES[type]) return;
  activeType = type;
  // reset type-specific filters & search to avoid stale options
  ['search', 'fBrand', 'fSeg'].forEach(id => $('#' + id).value = '');
  $('#fLeaders').checked = false;
  fillBrandOptions(); fillSegOptions();
  applyTypeUI();
  syncURL();
  renderGrid(); renderTray(); renderCompare();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyTypeUI() {
  const T = RATING.TYPES[activeType];
  document.querySelectorAll('.typeswitch__btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.type === activeType));
  $('#heroTitle').textContent = activeType === 'pvu'
    ? 'Сравнение приточно-вытяжных установок' : 'Сравнение приточных установок';
  $('#typeBadge').textContent = T.label.toLowerCase();
  RATING.renderReference($('#refContent'), activeType);
  RATING.renderCalculator($('#calcContent'), activeType);
}

function fillBrandOptions() {
  const fb = $('#fBrand'); fb.innerHTML = '<option value="">Все</option>';
  [...new Set(DATA.filter(m => m.type === activeType).map(x => x.brand))].sort()
    .forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; fb.appendChild(o); });
}
function fillSegOptions() {
  const fs = $('#fSeg'); fs.innerHTML = '<option value="">Любой</option>';
  RATING.TYPES[activeType].segments.forEach(([, name]) => {
    const o = document.createElement('option'); o.value = name;
    o.textContent = `${name} · ${RATING.segLabel(activeType, name)} м³/ч`;
    fs.appendChild(o);
  });
}

// ---------- grid ----------
function inRange(v, spec) { if (v == null) return false; const [a, b] = spec.split('-').map(Number); return v >= a && v <= b; }

function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const b = $('#fBrand').value, sg = $('#fSeg').value, pr = $('#fPrice').value, ht = $('#fHeater').value;
  const needValve = $('#fValve').checked, needFilter = $('#fFilter').checked, needLeaders = $('#fLeaders').checked;
  return DATA.filter(x => x.type === activeType)
    .filter(x => {
      if (q && !(x.name + ' ' + x.brand).toLowerCase().includes(q)) return false;
      if (b && x.brand !== b) return false;
      if (sg && x._rating.segment !== sg) return false;
      if (pr && !inRange(x.price_num, pr)) return false;
      if (ht) {
        const hv = String(x.heater_type || '').toLowerCase();
        if (ht === 'water' && !hv.includes('вод')) return false;
        if (ht === 'electric' && !hv.includes('электр')) return false;
      }
      if (needValve && x.valve !== 'да') return false;
      if (needFilter && x.filter !== 'да') return false;
      if (needLeaders && !x._rating.segLeader) return false;
      return true;
    })
    .sort((a, b) => b._rating.total - a._rating.total);
}

function renderGrid() {
  const list = filtered();
  $('#count').textContent = list.length;
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<div class="empty-grid">Ничего не найдено. Измените фильтры.</div>'; return; }
  const frag = document.createDocumentFragment();
  list.forEach(x => {
    const isSel = sel().includes(x.id);
    const rt = x._rating || { total: 0 };
    const seg = rt.segment ? `${rt.segment} · ${RATING.segLabel(x.type, rt.segment)} м³/ч` : 'сегмент н/д';
    const own = x.brand === 'SHUFT';
    const card = document.createElement('article');
    card.className = 'card' + (isSel ? ' is-selected' : '') + (own ? ' is-own' : '');
    card.innerHTML = `
      <div class="card__top">
        <span class="card__brand">${esc(x.brand)}${own ? '<span class="card__own">наш бренд</span>' : ''}</span>
        <span class="card__rate" title="Оценка ${rt.total}/100"><b>${rt.total}</b>${RATING.stars(rt.total)}</span>
      </div>
      <div class="card__seg">${esc(seg)}${rt.segLeader ? '<span class="card__leader">★ эталон сегмента</span>' : ''}</div>
      <div class="card__name">${esc(x.name)}</div>
      <div class="card__specs">
        <span>Расход: <b>${esc(x.flow)}</b> м³/ч</span>
        <span>Шум: <b>${esc(x.noise)}</b> дБ(А)</span>
        <span>Фильтр: <b>${esc(x.filter_class)}</b></span>
        ${x.type === 'pvu' ? `<span>КПД: <b>${esc(x.recup_eff)}</b></span>` : ''}
      </div>
      <div class="card__price">${x.price_num ? x.price_num.toLocaleString('ru-RU') + ' ₽' : '<span class="card__nd">цена н/д</span>'}</div>
      <div class="card__add"></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (isSel ? 'btn--ghost' : 'btn--primary');
    btn.textContent = isSel ? '✓ Выбрано' : 'Добавить к сравнению';
    btn.disabled = !isSel && sel().length >= MAX;
    btn.addEventListener('click', () => toggle(x.id));
    card.querySelector('.card__add').appendChild(btn);
    const ab = document.createElement('button');
    ab.className = 'btn btn--analog';
    ab.textContent = own ? '⇄ Аналоги конкурентов' : '⇄ Аналог от SHUFT';
    ab.addEventListener('click', () => openAnalogModal(x.id));
    card.querySelector('.card__add').appendChild(ab);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function toggle(id) {
  const s = sel();
  const i = s.indexOf(id);
  if (i >= 0) s.splice(i, 1);
  else if (s.length < MAX) s.push(id);
  syncURL(); renderGrid(); renderTray(); renderCompare();
}

function reset() {
  selByType[activeType] = [];
  ['search', 'fBrand', 'fSeg', 'fHeater', 'fPrice'].forEach(id => $('#' + id).value = '');
  $('#fValve').checked = $('#fFilter').checked = $('#fLeaders').checked = false;
  syncURL(); renderGrid(); renderTray(); renderCompare();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- tray ----------
function renderTray() {
  const s = sel();
  tray.hidden = s.length === 0;
  traySlots.innerHTML = '';
  for (let i = 0; i < MAX; i++) {
    const id = s[i];
    const div = document.createElement('div');
    if (id == null) { div.className = 'slot empty'; div.textContent = '+'; }
    else {
      const x = DATA[id];
      div.className = 'slot';
      div.innerHTML = `<b>${esc(x.brand)}</b>${esc(x.name)}<button class="slot__x" title="Удалить">×</button>`;
      div.querySelector('.slot__x').addEventListener('click', () => toggle(id));
    }
    traySlots.appendChild(div);
  }
  $('#compareBtn').disabled = s.length < 2;
}

// ---------- compare ----------
function renderCompare() {
  const s = sel();
  compare.hidden = s.length === 0;
  if (s.length === 0) return;
  const models = s.map(id => DATA[id]);
  const T = RATING.TYPES[activeType];
  renderSaleArgs(models);

  let html = '<thead><tr><th class="rowlabel"></th>';
  models.forEach(x => {
    const own = x.brand === 'SHUFT';
    html += `<th><div class="chead${own ? ' chead--own' : ''}"><span class="chead__brand">${esc(x.brand)}${own ? ' · наш' : ''}</span>
      <span class="chead__name" title="${esc(x.name)}">${esc(x.name)}</span>
      <button class="chead__x" data-id="${x.id}">Убрать</button></div></th>`;
  });
  html += '</tr></thead><tbody>';

  // overall rating
  html += '<tr class="prio rate-row"><td class="rowlabel">Оценка (0–100)</td>';
  models.forEach(x => {
    const rt = x._rating || { total: 0 };
    html += `<td><div class="crate"><b>${rt.total}</b>${RATING.stars(rt.total)}</div></td>`;
  });
  html += '</tr>';

  // segment
  html += '<tr class="seg-row"><td class="rowlabel">Сегмент (размерный класс)</td>';
  models.forEach(x => {
    const sgn = x._rating.segment;
    html += `<td>${sgn ? esc(sgn + ' · ' + RATING.segLabel(x.type, sgn) + ' м³/ч') : '—'}${x._rating.segLeader ? '<span class="leader-tag">★ эталон</span>' : ''}</td>`;
  });
  html += '</tr>';

  // breakdown (collapsible)
  const brkTitle = '🧪 Разбор оценки';
  const brkC = !!collapsed[brkTitle];
  html += `<tr class="sec ${brkC ? 'collapsed' : ''}" data-sec="${esc(brkTitle)}"><td colspan="${models.length + 1}"><span class="arrow">▾</span>${esc(brkTitle)} · среднее ${T.params.length} параметров</td></tr>`;
  T.params.forEach(key => {
    const m = RATING.PARAM[key];
    html += `<tr class="srow ${brkC ? 'row-hidden' : ''}" data-sec="${esc(brkTitle)}"><td class="rowlabel">${m.icon} ${m.label}</td>`;
    models.forEach(x => html += `<td>${partCell(x, key)}</td>`);
    html += '</tr>';
  });

  // priority
  PRIORITY.forEach(p => {
    html += `<tr class="prio diff" data-key="${p.key}"><td class="rowlabel">${p.label}</td>`;
    models.forEach(x => html += `<td>${fmt(p.key, x)}</td>`);
    html += '</tr>';
  });

  // sections (skip pvu-only for supply)
  SECTIONS.filter(secVisible).forEach(sec => {
    const isC = !!collapsed[sec.title];
    html += `<tr class="sec ${isC ? 'collapsed' : ''}" data-sec="${esc(sec.title)}"><td colspan="${models.length + 1}"><span class="arrow">▾</span>${esc(sec.title)}</td></tr>`;
    sec.rows.forEach(([key, label]) => {
      html += `<tr class="srow diff ${isC ? 'row-hidden' : ''}" data-sec="${esc(sec.title)}" data-key="${key}"><td class="rowlabel">${label}</td>`;
      models.forEach(x => html += `<td>${fmt(key, x)}</td>`);
      html += '</tr>';
    });
  });
  html += '</tbody>';
  ctable.innerHTML = html;
  // equal, fixed-width columns so a long name in one column never squeezes another
  ctable.style.minWidth = (220 + models.length * 260) + 'px';

  ctable.querySelectorAll('.chead__x').forEach(b =>
    b.addEventListener('click', () => toggle(Number(b.dataset.id))));
  ctable.querySelectorAll('.sec').forEach(tr =>
    tr.addEventListener('click', () => {
      const t = tr.dataset.sec; collapsed[t] = !collapsed[t];
      tr.classList.toggle('collapsed');
      ctable.querySelectorAll(`.srow[data-sec="${cssesc(t)}"]`).forEach(r => r.classList.toggle('row-hidden'));
    }));
  applyDiff();
}

function secVisible(sec) { return !(sec.pvuOnly && activeType !== 'pvu'); }

function partCell(x, key) {
  const p = x._rating && x._rating.parts ? x._rating.parts[key] : null;
  if (!p) return ndp();
  if (!p.active) return `<div class="pbar is-off"><span class="pbar__track"></span><i>нет данных</i></div>`;
  const v = Math.round(p.score);
  return `<div class="pbar"><span class="pbar__track"><span class="pbar__fill" style="width:${v}%"></span></span><i>${v}</i></div>`;
}

function applyDiff() {
  const on = $('#diffToggle').checked;
  ctable.querySelectorAll('tr.diff').forEach(tr => {
    const key = tr.dataset.key;
    const vals = sel().map(id => (DATA[id][key] || '').toString().trim());
    const diff = new Set(vals).size > 1;
    tr.classList.toggle('is-on', on && diff);
  });
}

// ---------- sale arguments (LOGIC.md §11) ----------
const FUNC_LABELS = { wifi: 'Wi-Fi', vav: 'VAV', humidity: 'управление влажностью', co2: 'датчик CO₂' };
let _saleCopies = [];   // plain-text versions for the copy buttons

// SHUFT (s) против конкурента (c) → { pros:[], cons:[] }; только при данных с обеих сторон
function saleArgsFor(s, c) {
  const pros = [], cons = [];
  const num = n => n.toLocaleString('ru-RU');
  const yes = v => String(v ?? '').trim().toLowerCase().startsWith('да');   // «да», «да (web)», «да, сенсорный…»

  if (s.flow_max != null && c.flow_max != null) {              // контекст производительности — всегда первым
    const d = s.flow_max - c.flow_max;
    if (Math.abs(d) / c.flow_max <= 0.15) pros.push(`сопоставимая производительность (${num(s.flow_max)} против ${num(c.flow_max)} м³/ч)`);
    else if (d > 0) pros.push(`производительность выше на ${num(d)} м³/ч`);
    else cons.push(`производительность ниже (${num(s.flow_max)} против ${num(c.flow_max)} м³/ч)`);
  }
  if (s.price_num != null && c.price_num != null) {
    const d = c.price_num - s.price_num;                       // >0 → SHUFT дешевле
    const pct = Math.round(Math.abs(d) / c.price_num * 100);
    if (d > 0 && (d >= 10000 || d / c.price_num >= 0.03)) pros.push(`дешевле на ${num(d)} ₽ (−${pct}%)`);
    else if (d < 0 && (-d >= 10000 || -d / c.price_num >= 0.03)) cons.push(`дороже на ${num(-d)} ₽ (+${pct}%)`);
  }
  if (s.noise_max != null && c.noise_max != null) {
    const d = c.noise_max - s.noise_max;                       // >0 → SHUFT тише
    if (d >= 3) pros.push(`тише на ${d} дБ`);
    else if (d <= -3) cons.push(`шумнее на ${-d} дБ`);
  }
  if (s.thickness != null && c.thickness != null) {
    const d = c.thickness - s.thickness;                       // >0 → SHUFT тоньше
    if (d > 0 && (d >= 30 || d / c.thickness >= 0.10)) pros.push(`компактнее по толщине на ${num(d)} мм`);
    else if (d < 0 && (-d >= 30 || -d / c.thickness >= 0.10)) cons.push(`толще на ${num(-d)} мм`);
  }
  if (s.filter_rank != null && c.filter_rank != null) {
    if (s.filter_rank > c.filter_rank) pros.push(`класс фильтрации выше (${s.filter_class} против ${c.filter_class})`);
    else if (s.filter_rank === c.filter_rank) pros.push(`фильтрация не хуже (${s.filter_class})`);
    else cons.push(`класс фильтрации ниже (${s.filter_class} против ${c.filter_class})`);
  }
  const plus = Object.keys(FUNC_LABELS).filter(k => yes(s[k]) && !yes(c[k])).map(k => FUNC_LABELS[k]);
  const minus = Object.keys(FUNC_LABELS).filter(k => yes(c[k]) && !yes(s[k])).map(k => FUNC_LABELS[k]);
  if (plus.length) pros.push(`есть ${plus.join(', ')} — у конкурента нет`);
  if (minus.length) cons.push(`у конкурента есть ${minus.join(', ')}`);
  if (s.type === 'pvu' && s.eff != null && c.eff != null) {
    const d = s.eff - c.eff;
    if (d >= 3) pros.push(`КПД рекуперации выше на ${d} п.п.`);
    else if (d <= -3) cons.push(`КПД рекуперации ниже на ${-d} п.п.`);
  }
  return { pros, cons };
}

function renderSaleArgs(models) {
  const box = $('#saleArgs');
  const shuft = models.find(m => m.brand === 'SHUFT');          // референс — первый выбранный SHUFT
  const comps = models.filter(m => m.brand !== 'SHUFT');
  _saleCopies = [];
  if (!shuft || !comps.length) { box.innerHTML = ''; return; }

  let html = '';
  comps.forEach(c => {
    const { pros, cons } = saleArgsFor(shuft, c);
    const ci = _saleCopies.push(
      `${shuft.brand} ${shuft.name} против ${c.brand} ${c.name}:\n` + pros.map(p => `— ${p}`).join('\n')) - 1;
    html += `<div class="sargs">
      <div class="sargs__head">
        <span class="sargs__title">💬 Аргументы: <b>SHUFT</b> против <b>${esc(c.brand)}</b> ${esc(c.name)}</span>
        ${pros.length ? `<button class="btn sargs__copy" data-ci="${ci}">Скопировать</button>` : ''}
      </div>
      ${pros.length
        ? `<div class="sargs__pros">${pros.map(p => `<span class="sargs__chip">✓ ${esc(p)}</span>`).join('')}</div>`
        : '<div class="sargs__none">Прямых преимуществ по опубликованным данным не найдено.</div>'}
      ${cons.length ? `<div class="sargs__cons">⚠ Обратите внимание: ${cons.map(esc).join(' · ')}</div>` : ''}
    </div>`;
  });
  html += '<p class="sargs__note">Аргументы построены на опубликованных данных (шум производители измеряют по-разному). Пороги значимости: цена ≥ 10 тыс ₽ или 3%, шум ≥ 3 дБ, толщина ≥ 30 мм или 10%, КПД ≥ 3 п.п.</p>';
  box.innerHTML = html;

  box.querySelectorAll('.sargs__copy').forEach(b => b.addEventListener('click', () => {
    copyPlainText(_saleCopies[Number(b.dataset.ci)], () => {
      b.textContent = '✓ Скопировано';
      setTimeout(() => { b.textContent = 'Скопировать'; }, 1500);
    });
  }));
}

function copyPlainText(t, done) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove(); done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

// ---------- analog finder (modal) ----------
function openAnalogModal(id) {
  analogState = { origId: id, ignoreHeater: false };
  renderAnalogModal();
  analogModal.hidden = false;
  document.body.style.overflow = 'hidden';           // scroll lock under the modal
}
function closeAnalogModal() {
  analogModal.hidden = true;
  document.body.style.overflow = '';
}

function analogParamsLine(m) {
  const p = [];
  if (m.flow_max != null) p.push(`<b>${m.flow_max.toLocaleString('ru-RU')}</b> м³/ч`);
  const hk = ANALOG.heaterKind(m);
  if (hk) p.push({ water: 'водяной нагр.', electric: 'электрич. нагр.', both: 'вода+электро', none: 'без нагревателя' }[hk]);
  if (m.noise_max != null) p.push(`${m.noise_max} дБ`);
  if (m.thickness != null) p.push(`мин. ${m.thickness} мм`);
  if (m.filter_class && m.filter_class.toLowerCase() !== 'н/д') p.push(esc(m.filter_class));
  if (m.type === 'pvu' && m.eff != null) p.push(`КПД ${m.eff}%`);
  return p.join(' · ');
}
function priceDeltaHtml(orig, cand) {
  if (orig.price_num == null || cand.price_num == null) return '';
  const d = cand.price_num - orig.price_num;
  if (d === 0) return '<span class="pdelta pdelta--same">та же цена</span>';
  const s = Math.abs(d).toLocaleString('ru-RU') + ' ₽';
  return d < 0 ? `<span class="pdelta pdelta--cheap">дешевле на ${s}</span>`
               : `<span class="pdelta pdelta--exp">дороже на ${s}</span>`;
}

function renderAnalogModal() {
  const orig = DATA[analogState.origId];
  const toShuft = orig.brand !== 'SHUFT';
  const res = ANALOG.findAnalogs(orig, DATA, { ignoreHeater: analogState.ignoreHeater });
  $('#analogTitle').textContent = toShuft ? 'Аналоги от SHUFT' : 'Аналоги у конкурентов';

  let html = `
    <div class="amodal-orig">
      <div class="amodal-orig__label">Исходная модель</div>
      <div class="amodal-orig__brand">${esc(orig.brand)}</div>
      <div class="amodal-orig__name">${esc(orig.name)}</div>
      <div class="amodal-orig__params">${analogParamsLine(orig)}${orig.price_num ? ` · <b>${orig.price_num.toLocaleString('ru-RU')} ₽</b>` : ''}</div>
    </div>`;

  if (res.hiddenByHeater > 0 || analogState.ignoreHeater) {
    html += `<label class="amodal-toggle"><input type="checkbox" id="analogHeaterToggle" ${analogState.ignoreHeater ? 'checked' : ''}>
      <span>показать и с другим типом нагревателя${res.hiddenByHeater > 0 && !analogState.ignoreHeater ? ` (ещё ${res.hiddenByHeater})` : ''}</span></label>`;
  }

  if (!res.list.length) {
    const reasons = {
      'no-flow': 'У этой модели не указан расход воздуха — подбор по методике невозможен.',
      'no-window': `Нет моделей ${toShuft ? 'SHUFT' : 'конкурентов'} с расходом в диапазоне ±40% от ${orig.flow_max != null ? orig.flow_max.toLocaleString('ru-RU') : '—'} м³/ч.`,
      'no-score': 'Достаточно близких аналогов не найдено (совпадение ниже 50 из 100).',
    };
    html += `<div class="amodal-empty">${reasons[res.reason] || 'Аналогов не найдено.'}</div>`;
  } else {
    if (res.list.length >= 2) {
      const n = Math.min(3, res.list.length);
      html += `<div class="amodal-actions"><button class="btn btn--primary" id="analogTopBtn">Сравнить топ-${n} с оригиналом</button></div>`;
    }
    html += '<div class="amodal-list">';
    res.list.forEach(r => {
      const m = r.model;
      html += `
        <div class="amatch">
          <div class="amatch__head">
            <span class="amatch__score amatch__score--${r.score >= 85 ? 'hi' : r.score >= 70 ? 'mid' : 'low'}" title="${esc(r.explain)}">${r.score}% · ${r.cat}</span>
            <span class="amatch__depth">по ${r.used} из ${r.total} параметров</span>
          </div>
          <div class="amatch__brand">${esc(m.brand)}</div>
          <div class="amatch__name">${esc(m.name)}</div>
          <div class="amatch__params">${analogParamsLine(m)}</div>
          <div class="amatch__foot">
            <span class="amatch__price">${m.price_num ? m.price_num.toLocaleString('ru-RU') + ' ₽' : 'цена н/д'}${priceDeltaHtml(orig, m)}</span>
            <button class="btn btn--primary amatch__cmp" data-id="${m.id}">Сравнить</button>
          </div>
        </div>`;
    });
    html += '</div>';
  }
  html += `<p class="amodal-note">Балл соответствия: расход (якорь ±40%), нагреватель, функции, шум, толщина, фильтрация${orig.type === 'pvu' ? ', КПД рекуператора' : ''}. Нет данных — параметр выпадает из балла. Цена в балл не входит — показана разница с оригиналом.</p>`;

  $('#analogBody').innerHTML = html;

  const tg = $('#analogHeaterToggle');
  if (tg) tg.addEventListener('change', () => { analogState.ignoreHeater = tg.checked; renderAnalogModal(); });
  const topBtn = $('#analogTopBtn');
  if (topBtn) topBtn.addEventListener('click', () => compareWithAnalogs(res.list.slice(0, 3).map(r => r.model.id)));
  $('#analogBody').querySelectorAll('.amatch__cmp').forEach(b =>
    b.addEventListener('click', () => compareWithAnalogs([Number(b.dataset.id)])));
}

// заменяет текущий выбор на [оригинал, аналог(и)] и ведёт к таблице сравнения
function compareWithAnalogs(ids) {
  const orig = DATA[analogState.origId];
  selByType[activeType] = [orig.id, ...ids].slice(0, MAX);
  closeAnalogModal();
  syncURL(); renderGrid(); renderTray(); renderCompare();
  compare.scrollIntoView({ behavior: 'smooth' });
}

// ---------- value formatting ----------
function fmt(key, x) {
  if (key === '__thick') {
    return x.thickness ? `<span class="val val--big">${x.thickness}</span>` : ndp();
  }
  let v = (x[key] ?? '').toString().trim();
  if (key === 'price') return x.price_num ? `<span class="val val--big">${x.price_num.toLocaleString('ru-RU')} ₽</span>` : ndp();
  if (key === 'url') return v ? `<a class="linkout" href="${esc(v)}" target="_blank" rel="noopener">открыть ↗</a>` : ndp();
  if (key === 'passport') {
    if (!v || v.toLowerCase() === 'н/д') return ndp();
    return v.startsWith('http')
      ? `<a class="linkout" href="${esc(v)}" target="_blank" rel="noopener">паспорт ↗</a>`
      : `<span class="val">${esc(v)}</span>`;
  }
  if (v === '' || v.toLowerCase() === 'н/д' || v.toLowerCase() === 'none' || v.toLowerCase() === 'нет данных') return ndp();
  if (v === 'да') return '<span class="pill pill--ok">да</span>';
  if (v === 'нет') return '<span class="pill pill--no">нет</span>';
  const big = ['flow', 'noise', 'filter_class'].includes(key);
  return `<span class="val${big ? ' val--big' : ''}">${esc(v)}</span>`;
}
function ndp() { return '<span class="pill pill--nd">н/д</span>'; }

// ---------- utils ----------
function syncURL() {
  const u = new URL(location);
  u.searchParams.set('type', activeType);
  const s = sel();
  if (s.length) u.searchParams.set('c', s.join(',')); else u.searchParams.delete('c');
  history.replaceState(null, '', u);
}
function esc(s) { return (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cssesc(s) { return s.replace(/["\\]/g, '\\$&'); }
