'use strict';

const MAX = 4;
let DATA = [];
let selected = [];          // array of ids (max 4)
let collapsed = {};         // section title -> bool

// priority + sections definition
const PRIORITY = [
  { key: 'flow',         label: 'Расход воздуха, м³/ч' },
  { key: 'noise',        label: 'Уровень шума, дБ(А)' },
  { key: 'filter_class', label: 'Класс фильтрации' },
];
const SECTIONS = [
  { title: '💰 Цена', rows: [['price', 'Цена, руб']] },
  { title: '📏 Габариты', rows: [['dims', 'Размеры Ш×В×Г, мм'], ['__thick', 'Толщина (мин. сторона), мм'], ['dims_ports', 'С учётом патрубков, мм']] },
  { title: '🔌 Питание и защита', rows: [['power', 'Питание, ф/В/Гц'], ['ip', 'Степень защиты IP'], ['shock', 'Класс электрозащиты']] },
  { title: '🌬️ Воздушный клапан', rows: [['valve', 'Наличие клапана'], ['valve_drive', 'Привод клапана'], ['drive_type', 'Тип привода']] },
  { title: '🔁 Рекуперация', rows: [['recup', 'Наличие рекуперации'], ['recup_type', 'Тип рекуператора'], ['recup_maker', 'Производитель'], ['recup_eff', 'КПД']] },
  { title: '🔥 Нагреватель', rows: [['heater', 'Наличие нагревателя'], ['heater_type', 'Тип (вода/электр.)'], ['heater_elem', 'Элемент (ТЭН/PTC)']] },
  { title: '❄️ Охладитель', rows: [['cooler', 'Наличие охладителя'], ['cooler_type', 'Тип охладителя']] },
  { title: '🌀 Вентилятор', rows: [['fan_type', 'Тип вентилятора'], ['motor', 'Тип двигателя'], ['two_fans', 'Два вентилятора']] },
  { title: '🎛️ Управление', rows: [['auto', 'Автоматика'], ['controller', 'Контроллер'], ['remote', 'Пульт'], ['remote_type', 'Тип пульта'], ['wifi', 'Wi-Fi'], ['vav', 'VAV'], ['humidity', 'Влажность'], ['co2', 'Датчик CO₂']] },
  { title: 'ℹ️ Дополнительно', rows: [['pressure', 'Свободный напор, Па'], ['model_code', 'Модель'], ['url', 'Источник']] },
];

const $ = (s) => document.querySelector(s);
const grid = $('#grid'), tray = $('#tray'), traySlots = $('#traySlots'),
      compare = $('#compare'), ctable = $('#ctable');

// ---------- init ----------
fetch('data.json')
  .then(r => r.json())
  .then(d => { DATA = d; init(); })
  .catch(() => { grid.innerHTML = '<div class="empty-grid">Не удалось загрузить данные.</div>'; });

function init() {
  // restore from URL
  const p = new URLSearchParams(location.search).get('c');
  if (p) selected = p.split(',').map(Number).filter(n => DATA[n]).slice(0, MAX);
  // brand options
  const brands = [...new Set(DATA.map(x => x.brand))].sort();
  const fb = $('#fBrand');
  brands.forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; fb.appendChild(o); });
  // listeners
  ['search', 'fBrand', 'fFlow', 'fPrice', 'fValve', 'fFilter'].forEach(id =>
    $('#' + id).addEventListener('input', renderGrid));
  $('#resetBtn').addEventListener('click', reset);
  $('#compareBtn').addEventListener('click', () => compare.scrollIntoView({ behavior: 'smooth' }));
  $('#diffToggle').addEventListener('change', applyDiff);
  renderGrid(); renderTray(); renderCompare();
}

// ---------- grid ----------
function inRange(v, spec) { if (v == null) return false; const [a, b] = spec.split('-').map(Number); return v >= a && v <= b; }

function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const b = $('#fBrand').value, fl = $('#fFlow').value, pr = $('#fPrice').value;
  const needValve = $('#fValve').checked, needFilter = $('#fFilter').checked;
  return DATA.filter(x => {
    if (q && !(x.name + ' ' + x.brand).toLowerCase().includes(q)) return false;
    if (b && x.brand !== b) return false;
    if (fl && !inRange(x.flow_max, fl)) return false;
    if (pr && !inRange(x.price_num, pr)) return false;
    if (needValve && x.valve !== 'да') return false;
    if (needFilter && x.filter !== 'да') return false;
    return true;
  });
}

function renderGrid() {
  const list = filtered();
  $('#count').textContent = list.length;
  grid.innerHTML = '';
  if (!list.length) { grid.innerHTML = '<div class="empty-grid">Ничего не найдено. Измените фильтры.</div>'; return; }
  const frag = document.createDocumentFragment();
  list.forEach(x => {
    const sel = selected.includes(x.id);
    const card = document.createElement('article');
    card.className = 'card' + (sel ? ' is-selected' : '');
    card.innerHTML = `
      <div class="card__brand">${esc(x.brand)}</div>
      <div class="card__name">${esc(x.name)}</div>
      <div class="card__specs">
        <span>Расход: <b>${esc(x.flow)}</b> м³/ч</span>
        <span>Шум: <b>${esc(x.noise)}</b> дБ(А)</span>
        <span>Фильтр: <b>${esc(x.filter_class)}</b></span>
      </div>
      <div class="card__price">${x.price_num ? x.price_num.toLocaleString('ru-RU') + ' ₽' : '<span style="color:#b0b0b5;font-size:14px">цена н/д</span>'}</div>
      <div class="card__add"></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (sel ? 'btn--ghost' : 'btn--primary');
    btn.textContent = sel ? '✓ Выбрано' : 'Добавить к сравнению';
    btn.disabled = !sel && selected.length >= MAX;
    btn.addEventListener('click', () => toggle(x.id));
    card.querySelector('.card__add').appendChild(btn);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function toggle(id) {
  const i = selected.indexOf(id);
  if (i >= 0) selected.splice(i, 1);
  else if (selected.length < MAX) selected.push(id);
  syncURL(); renderGrid(); renderTray(); renderCompare();
}

function reset() {
  selected = [];
  ['search', 'fBrand', 'fFlow', 'fPrice'].forEach(id => $('#' + id).value = '');
  $('#fValve').checked = $('#fFilter').checked = false;
  syncURL(); renderGrid(); renderTray(); renderCompare();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- tray ----------
function renderTray() {
  tray.hidden = selected.length === 0;
  traySlots.innerHTML = '';
  for (let i = 0; i < MAX; i++) {
    const id = selected[i];
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
  $('#compareBtn').disabled = selected.length < 2;
}

// ---------- compare ----------
function renderCompare() {
  compare.hidden = selected.length === 0;
  if (selected.length === 0) return;
  const models = selected.map(id => DATA[id]);
  let html = '<thead><tr><th class="rowlabel"></th>';
  models.forEach((x, i) => {
    html += `<th><div class="chead"><span class="chead__brand">${esc(x.brand)}</span>
      <span class="chead__name">${esc(x.name)}</span>
      <button class="chead__x" data-id="${x.id}">Убрать</button></div></th>`;
  });
  html += '</tr></thead><tbody>';

  // priority
  PRIORITY.forEach(p => {
    html += `<tr class="prio diff" data-key="${p.key}"><td class="rowlabel">${p.label}</td>`;
    models.forEach(x => html += `<td>${fmt(p.key, x)}</td>`);
    html += '</tr>';
  });

  // sections
  SECTIONS.forEach(sec => {
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

function applyDiff() {
  const on = $('#diffToggle').checked;
  ctable.querySelectorAll('tr.diff').forEach(tr => {
    const key = tr.dataset.key;
    const vals = selected.map(id => (DATA[id][key] || '').trim());
    const diff = new Set(vals).size > 1;
    tr.classList.toggle('is-on', on && diff);
  });
}

// ---------- value formatting ----------
function fmt(key, x) {
  if (key === '__thick') {
    return x.thickness ? `<span class="val val--big">${x.thickness}</span>` : ndp();
  }
  let v = (x[key] ?? '').toString().trim();
  if (key === 'price') return x.price_num ? `<span class="val val--big">${x.price_num.toLocaleString('ru-RU')} ₽</span>` : ndp();
  if (key === 'url') return v ? `<a class="linkout" href="${esc(v)}" target="_blank" rel="noopener">открыть ↗</a>` : ndp();
  if (v === '' || v.toLowerCase() === 'н/д' || v.toLowerCase() === 'none') return ndp();
  if (v === 'да') return '<span class="pill pill--ok">да</span>';
  if (v === 'нет') return '<span class="pill pill--no">нет</span>';
  if (key === 'dims') {
    const t = x.thickness;
    return `<span class="val">${esc(v)}</span>${t ? `<span class="thick">Г ${t}</span>` : ''}`;
  }
  const big = ['flow', 'noise', 'filter_class'].includes(key);
  return `<span class="val${big ? ' val--big' : ''}">${esc(v)}</span>`;
}
function ndp() { return '<span class="pill pill--nd">н/д</span>'; }

// ---------- utils ----------
function syncURL() {
  const u = new URL(location);
  if (selected.length) u.searchParams.set('c', selected.join(','));
  else u.searchParams.delete('c');
  history.replaceState(null, '', u);
}
function esc(s) { return (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cssesc(s) { return s.replace(/["\\]/g, '\\$&'); }
