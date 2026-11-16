// Launch Radar's page: renders window.RADAR (written by main.ts beside this page) as a sortable,
// filterable board with a detail drawer per protocol and an Already trading view. No network,
// no framework: the dataset is a script tag, the rest is this file.
//
// Views are addressable: ?tab=live, ?class=watchlist, ?category=Lending, ?chain=Solana,
// ?q=curve, ?detail=<slug> — a link can point at exactly the board a reader should see.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);

const state = {
  tab: 'board',
  q: '',
  category: '',
  chain: '',
  minTvl: 0,
  rowClass: 'all',
  sortKey: 'rank',
  sortDir: 1,
  detail: null,
};

/** Escape a string for HTML text. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Whole dollars, compact: $1.24B, $812M, $45.2K. */
function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

/** A signed 7-day change, coloured by direction. */
function fmtChange(v) {
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}

/** A tokenless age in days as years + months, or days when young. */
function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30.4)} mo`;
  return `${(days / 365.25).toFixed(1)} yrs`;
}

/** The class badge a row carries, if any. */
function badge(row) {
  if (row.row_class === 'watchlist') return '<span class="badge watchlist">WATCHLIST</span>';
  if (row.row_class === 'derivative') return '<span class="badge derivative">DERIVATIVE</span>';
  return '';
}

/** Up to three chain chips, with a +n for the rest. */
function chainChips(chains) {
  const shown = chains.slice(0, 3).map((c) => `<span class="chain-chip">${esc(c)}</span>`).join('');
  return shown + (chains.length > 3 ? `<span class="chain-chip">+${chains.length - 3}</span>` : '');
}

function renderHeader() {
  $('snapshot-note').textContent =
    `snapshot as of ${D.as_of}\n${D.source}\nwatchlist floor ${fmtUsd(D.floor_usd)} TVL`;
  const totalImplied = D.rows.reduce((a, r) => a + r.implied_value_usd, 0);
  const stats = [
    [`${D.counts.protocols}`, 'protocols in the snapshot'],
    [`${D.counts.live_token}`, 'already trade a token'],
    [`${D.counts.pre_token}`, 'record no token'],
    [`<em>${D.counts.board}</em>`, `rows ranked · ${D.counts.watchlist} watchlist`],
    [fmtUsd(totalImplied), 'total implied value'],
  ];
  $('stats').innerHTML = stats.map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
  $('model-version').textContent = D.model_version;
  const w = D.weights;
  $('model-formula').textContent =
    `implied = TVL × category multiple × growth × maturity × breadth × class · growth = 1 + clamp(7d, ${w.growth_floor}, +${w.growth_cap}) × ${w.growth_weight} · class = ${w.derivative_class} for derivatives · global median multiple ${D.global_multiple}×`;
  $('peer-table').innerHTML =
    '<tr><th>Category</th><th class="num">Tokenized peers</th><th class="num">Median MCap/TVL</th><th class="num">Multiple used</th></tr>' +
    D.peer_table.slice(0, 7).map((p) => `<tr><td>${esc(p.category)}</td><td class="num">${p.peers}</td><td class="num">${p.median_ratio}×</td><td class="num">${p.multiple}×</td></tr>`).join('') +
    (D.peer_table.length > 7 ? `<tr><td colspan="4" class="flat">+ ${D.peer_table.length - 7} more categories measured the same way</td></tr>` : '');
  $('footer-line').textContent =
    `Data: ${D.source}. Board computed by model ${D.model_version} from that snapshot alone; it does not move and is not updated.`;
}

function fillSelects() {
  const cats = [...new Set(D.rows.map((r) => r.category ?? '(uncategorised)'))].sort();
  $('category').innerHTML = '<option value="">all categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chainCount = new Map();
  for (const r of D.rows) for (const c of r.chains) chainCount.set(c, (chainCount.get(c) ?? 0) + 1);
  const chains = [...chainCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  $('chain').innerHTML = '<option value="">all chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

/** The rows the current controls select, in the current sort order. */
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = D.rows.filter((r) => {
    if (state.rowClass !== 'all' && r.row_class !== state.rowClass) return false;
    if (state.category && (r.category ?? '(uncategorised)') !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (r.tvl_usd < state.minTvl) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  const val = (r) =>
    key === 'rank' ? r.rank :
    key === 'name' ? r.name :
    key === 'category' ? (r.category ?? '') :
    key === 'tvl' ? r.tvl_usd :
    key === 'change' ? (r.change_7d ?? -Infinity) :
    key === 'age' ? (r.age_days ?? -1) :
    key === 'ratio' ? r.implied_value_usd / Math.max(1, r.tvl_usd) :
    r.implied_value_usd;
  rows = [...rows].sort((a, b) => {
    const va = val(a); const vb = val(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return cmp * dir || a.rank - b.rank;
  });
  return rows;
}

function renderBoard() {
  const rows = visibleRows();
  $('row-count').textContent = `${rows.length} of ${D.rows.length} rows`;
  $('board-body').innerHTML = rows.map((r) => {
    const ratio = r.implied_value_usd / Math.max(1, r.tvl_usd);
    const barW = Math.min(100, Math.round(ratio * 60));
    return `<tr data-slug="${esc(r.slug)}">
      <td class="rank">#${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${badge(r)}<br><span class="pslug">${esc(r.slug)}</span></td>
      <td>${esc(r.category ?? '—')}</td>
      <td>${chainChips(r.chains)}</td>
      <td class="num">${fmtUsd(r.tvl_usd)}</td>
      <td class="num">${fmtChange(r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num"><b>${fmtUsd(r.implied_value_usd)}</b></td>
      <td class="num"><span class="ratio-bar"><i style="width:${barW}%"></i></span>${ratio.toFixed(2)}×</td>
    </tr>`;
  }).join('');
  for (const tr of document.querySelectorAll('#board-body tr')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  }
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    const arrow = th.dataset.sort === state.sortKey ? ` <span class="arrow">${state.sortDir === 1 ? '↑' : '↓'}</span>` : '';
    th.innerHTML = th.dataset.label + arrow;
  });
}

function renderLive() {
  $('live-body').innerHTML = D.live.map((r) => `<tr>
    <td><span class="pname">${esc(r.name)}</span><br><span class="pslug">${esc(r.slug)}</span></td>
    <td>${esc(r.symbol ?? '—')}</td>
    <td>${esc(r.category ?? '—')}</td>
    <td class="num">${fmtUsd(r.tvl_usd)}</td>
    <td class="num">${fmtChange(r.change_7d)}</td>
    <td class="num"><b>${fmtUsd(r.mcap_usd)}</b></td>
    <td class="num">${r.mcap_tvl === null ? '—' : `${r.mcap_tvl.toFixed(2)}×`}</td>
  </tr>`).join('');
}

/** The detail drawer for one protocol: its record, the model arithmetic, and its farm plan. */
function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.detail = slug;
  const m = r.model;
  const classLine =
    r.row_class === 'watchlist' ? 'On the house watchlist: at or above the $50M floor, records no token, and not a wrapped, staked or bridged product.' :
    r.row_class === 'derivative' ? 'A derivative product: a wrapped, staked or bridged product of a token that already trades. The model prices it at 0.15× — its value sits with the parent token.' :
    'An early find: records no token and sits below the watchlist floor — exactly what a radar exists to catch before it is obvious.';
  const mrow = (label, value) => `<div class="mrow"><span>${label}</span><span>${value}</span></div>`;
  $('drawer-content').innerHTML = `
    <h2>${esc(r.name)} ${badge(r)}</h2>
    <div class="d-sub">${esc(r.slug)} · ${esc(r.category ?? 'uncategorised')} · tracked since ${r.listed_at ?? 'an unrecorded date'}</div>
    <div class="d-implied-label">Implied token value — rank #${r.rank} of ${D.rows.length}</div>
    <div class="d-implied">${fmtUsd(r.implied_value_usd)}</div>
    <p>${classLine}</p>
    <div class="d-grid">
      <div><b>${fmtUsd(r.tvl_usd)}</b><span>Total value locked</span></div>
      <div><b>${r.change_7d === null ? '—' : `${r.change_7d > 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b><span>TVL change, 7 days</span></div>
      <div><b>${fmtAge(r.age_days)}</b><span>Tokenless age</span></div>
      <div><b>${r.chains.length}</b><span>Chains</span></div>
    </div>
    <div>${r.chains.map((c) => `<span class="chain-chip">${esc(c)}</span>`).join('')}</div>
    <h3>How the model got there</h3>
    <div class="model-rows">
      ${mrow('TVL (snapshot)', fmtUsd(r.tvl_usd))}
      ${mrow(`× category multiple (${esc(r.category ?? 'uncategorised')}, ${m.category_peers} tokenized peer${m.category_peers === 1 ? '' : 's'})`, `${m.category_multiple}×`)}
      ${mrow('× growth (7d change)', `${m.growth_multiplier}×`)}
      ${mrow('× maturity (tokenless age)', `${m.maturity_multiplier}×`)}
      ${mrow('× breadth (chains)', `${m.breadth_multiplier}×`)}
      ${mrow('× class', `${m.class_multiplier}×`)}
      <div class="mrow total"><span>Implied value</span><span>${fmtUsd(r.implied_value_usd)}</span></div>
    </div>
    <h3>The farm plan</h3>
    <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('drawer').hidden = false;
  $('scrim').hidden = false;
}

function closeDetail() {
  state.detail = null;
  $('drawer').hidden = true;
  $('scrim').hidden = true;
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('view-board').hidden = tab !== 'board';
  $('view-live').hidden = tab !== 'live';
}

function init() {
  renderHeader();
  fillSelects();
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    th.dataset.label = th.textContent;
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
    });
  });
  $('q').addEventListener('input', () => { state.q = $('q').value; renderBoard(); });
  $('category').addEventListener('change', () => { state.category = $('category').value; renderBoard(); });
  $('chain').addEventListener('change', () => { state.chain = $('chain').value; renderBoard(); });
  $('min-tvl').addEventListener('change', () => { state.minTvl = Number($('min-tvl').value); renderBoard(); });
  document.querySelectorAll('#class-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.rowClass = chip.dataset.class;
      document.querySelectorAll('#class-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderBoard();
    });
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('drawer-close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  const params = new URLSearchParams(location.search);
  if (params.get('tab') === 'live') setTab('live');
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (params.get('category')) { state.category = params.get('category'); $('category').value = state.category; }
  if (params.get('chain')) { state.chain = params.get('chain'); $('chain').value = state.chain; }
  if (params.get('min-tvl')) { state.minTvl = Number(params.get('min-tvl')); $('min-tvl').value = params.get('min-tvl'); }
  if (params.get('class')) {
    state.rowClass = params.get('class');
    document.querySelectorAll('#class-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.class === state.rowClass));
  }
  if (params.get('sort')) {
    state.sortKey = params.get('sort');
    state.sortDir = params.get('dir') === 'asc' ? 1 : -1;
  }
  renderBoard();
  renderLive();
  if (params.get('detail')) openDetail(params.get('detail'));
}

init();
