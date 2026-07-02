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
  { title: '📏 Габариты', rows: [['dims', 'Размеры Ш×В×Г, мм'], ['__thick', 'Толщина (мин. сторона), мм'], ['dims_ports', 'С учётом патрубков, мм']] },
  { title: '🔌 Питание и защита', rows: [['power', 'Питание, ф/В/Гц'], ['ip', 'Степень защиты IP'], ['shock', 'Класс электрозащиты']] },
  { title: '🌬️ Воздушный клапан', rows: [['valve', 'Наличие клапана'], ['valve_drive', 'Привод клапана'], ['drive_type', 'Тип привода']] },
  { title: '🔁 Рекуперация', pvuOnly: true, rows: [['recup', 'Наличие рекуперации'], ['recup_type', 'Тип рекуператора'], ['recup_maker', 'Производитель'], ['recup_eff', 'КПД рекуператора']] },
  { title: '🔥 Нагреватель', rows: [['heater', 'Наличие нагревателя'], ['heater_type', 'Тип (вода/электр.)'], ['heater_elem', 'Элемент (ТЭН/PTC)']] },
  { title: '❄️ Охладитель', rows: [['cooler', 'Наличие охладителя'], ['cooler_type', 'Тип охладителя']] },
  { title: '🌀 Вентилятор', rows: [['fan_type', 'Тип вентилятора'], ['motor', 'Тип двигателя'], ['power_fan', 'Питание вентилятора'], ['two_fans', 'Два вентилятора']] },
  { title: '🎛️ Управление', rows: [['auto', 'Автоматика'], ['controller', 'Контроллер'], ['remote', 'Пульт'], ['remote_type', 'Тип пульта'], ['wifi', 'Wi-Fi'], ['vav', 'VAV'], ['humidity', 'Влажность'], ['co2', 'Датчик CO₂']] },
  { title: 'ℹ️ Дополнительно', rows: [['pressure', 'Свободный напор, Па'], ['model_code', 'Модель'], ['extra', 'Доп. требования'], ['url', 'Источник']] },
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
