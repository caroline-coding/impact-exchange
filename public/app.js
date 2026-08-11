let orgs = [];
let currentPage = 'home';
let currentOrg = null; // org id when currentPage === 'market'

const $ = (id) => document.getElementById(id);
const fmt = (cents) =>
  '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Whole dollars with commas — for totals where cents are noise.
const fmtWhole = (cents) => '$' + Math.round(cents / 100).toLocaleString();
// Compact money: $17.2m above a million, whole dollars below.
const fmtCompact = (cents) => {
  const dollars = cents / 100;
  if (dollars >= 1e6) return '$' + (dollars / 1e6).toFixed(1) + 'm';
  return '$' + Math.round(dollars).toLocaleString();
};
// Trade totals: three significant figures with a magnitude suffix
// ($1.25m, $12.5m, $125m; $1.25k, $12.5k, $125k), whole dollars below $1k.
const fmtTotal = (cents) => {
  const dollars = cents / 100;
  const scaled = (v, suffix) => {
    const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return '$' + v.toFixed(decimals) + suffix;
  };
  // 999,500+ rounds into millions territory; showing it as "$1000k" reads
  // worse than "$1.00m".
  if (dollars >= 999500) return scaled(dollars / 1e6, 'm');
  if (dollars >= 1e3) return scaled(dollars / 1e3, 'k');
  return '$' + Math.round(dollars).toLocaleString();
};
// Timestamps are stored as UTC "YYYY-MM-DD HH:MM[:SS]".
const parseTs = (ts) => new Date(ts.replace(' ', 'T') + 'Z');
// Today's trades show a time; older ones a date (year only when it differs).
const fmtWhen = (ts) => {
  const d = parseTs(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

$('site-title').addEventListener('click', () => showPage('home'));

// --- Navigation ---
const VIEWS = {
  home: 'home-view',
  market: 'org-view',
  about: 'about-view',
  users: 'users-view',
  user: 'user-view',
  tag: 'user-view', // tag pages reuse the user profile view
};
let marketsExpanded = false;
let currentProfileId = null; // user id when currentPage === 'user'
let currentProfileTag = null; // tag code when currentPage === 'tag'

function renderTabs() {
  const nav = $('sidebar');
  nav.innerHTML = '';
  const tab = (label, active, onClick, cls = '') => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = `${cls}${active ? ' active' : ''}`;
    btn.addEventListener('click', onClick);
    nav.appendChild(btn);
  };
  tab('Home', currentPage === 'home', () => showPage('home'));
  tab('About', currentPage === 'about', () => showPage('about'));
  // "Markets" lines up with the other items; the +/− toggle sign hangs in
  // the gutter to its left.
  const group = document.createElement('button');
  group.className = 'group';
  const sign = document.createElement('span');
  sign.className = 'sign';
  sign.textContent = marketsExpanded ? '−' : '+';
  group.append(sign, 'Markets');
  group.addEventListener('click', () => {
    marketsExpanded = !marketsExpanded;
    renderTabs();
  });
  nav.appendChild(group);
  if (marketsExpanded) {
    for (const org of orgs) {
      tab(org.ticker, currentPage === 'market' && currentOrg === org.id, () =>
        showPage('market', org.id), 'sub');
    }
  }
  tab('Users', ['users', 'user', 'tag'].includes(currentPage), () => showPage('users'));
}

// `arg` is the org id for market pages, the user id for user pages, the
// tag code for tag pages.
async function showPage(page, arg = null) {
  currentPage = page;
  currentOrg = page === 'market' ? arg : null;
  currentProfileId = page === 'user' ? arg : null;
  currentProfileTag = page === 'tag' ? arg : null;
  // Keep the active ticker visible in the sidebar.
  if (page === 'market') marketsExpanded = true;
  const activeView = VIEWS[page];
  for (const viewId of new Set(Object.values(VIEWS))) {
    $(viewId).classList.toggle('hidden', viewId !== activeView);
  }
  renderTabs();
  if (page === 'home') {
    await refreshHome();
  } else if (page === 'market') {
    const org = orgs.find((o) => o.id === arg);
    $('org-name').innerHTML =
      `<img class="org-logo org-logo-lg" src="${org.logo}" alt="">` +
      `${escapeHtml(org.name)} (${org.ticker})`;
    $('org-blurb').textContent = org.blurb;
    $('org-link').textContent = org.url;
    $('org-link').href = org.url;
    await refreshMarket();
  } else if (page === 'users') {
    await refreshUserSearch();
  } else if (page === 'user' || page === 'tag') {
    await refreshProfile();
  }
}

// --- User and tag pages ---
const userLink = (id, name) => `<a class="user-link" data-uid="${id}">${escapeHtml(name)}</a>`;
// Tags render in italics wherever they appear.
const tagLink = (tag, name) => `<a class="user-link tag-link" data-tag="${tag}">${escapeHtml(name)}</a>`;
const entityLink = (row) => (row.isTag ? tagLink(row.tag, row.name) : userLink(row.id, row.name));

// Any rendered user or tag name navigates to its page.
document.addEventListener('click', (e) => {
  const link = e.target.closest('.user-link');
  if (!link) return;
  if (link.dataset.tag) showPage('tag', link.dataset.tag);
  else showPage('user', Number(link.dataset.uid));
});

async function refreshUserSearch() {
  const q = $('user-search').value.trim();
  const results = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  $('user-results').innerHTML = results
    .map((u) => `<tr><td>${entityLink(u)}</td><td>${fmtCompact(u.value)}</td></tr>`)
    .join('');
}
$('user-search').addEventListener('input', refreshUserSearch);

async function refreshProfile() {
  const base = currentPage === 'tag' ? `/api/tags/${currentProfileTag}` : `/api/users/${currentProfileId}`;
  const [p, history] = await Promise.all([api(`${base}/profile`), api(`${base}/history`)]);
  $('value-panel').classList.toggle('hidden', history.length < 2);
  if (history.length >= 2) renderValueChart(history);
  $('profile-name').textContent = p.name;
  $('profile-name').classList.toggle('tag-name', Boolean(p.isTag));
  let holdingsValue = 0;
  $('profile-holdings').innerHTML = p.holdings
    .map((h) => {
      holdingsValue += h.value;
      const org = orgs.find((o) => o.id === h.org);
      return (
        `<tr><td>${org ? org.ticker : h.org}</td><td>${escapeHtml(org ? org.name : h.org)}</td>` +
        `<td>${h.shares.toLocaleString()}</td>` +
        `<td>${h.lastPrice ? fmt(h.lastPrice) : '—'}</td>` +
        `<td>${fmtTotal(h.value)}</td></tr>`
      );
    })
    .join('');
  if (p.holdings.length === 0) {
    $('profile-holdings').innerHTML = '<tr><td colspan="5">No holdings.</td></tr>';
  }
  $('profile-summary').textContent = `Portfolio value: ${fmtCompact(holdingsValue)}`;
  $('profile-trades').innerHTML = p.trades
    .map((t) => {
      const org = orgs.find((o) => o.id === t.org);
      return (
        `<tr><td>${fmtWhen(t.created_at)}</td><td>${org ? org.ticker : t.org}</td>` +
        `<td class="${t.side === 'buy' ? 'bid' : 'ask'}">${t.side}</td>` +
        `<td>${fmt(t.price)}</td><td>${t.qty.toLocaleString()}</td>` +
        `<td>${fmtTotal(t.price * t.qty)}</td>` +
        `<td>${userLink(t.counterpartyId, t.counterparty)}</td></tr>`
      );
    })
    .join('');
  if (p.trades.length === 0) {
    $('profile-trades').innerHTML = '<tr><td colspan="7">No trades.</td></tr>';
  }
}

// --- Home page ---
let leaderboardSort = 'value'; // 'value' | 'returns'

// e.g. 44x, 1.8x; dash when the holder never bought anything.
const fmtReturns = (r) => (r == null ? '—' : r >= 10 ? Math.round(r) + 'x' : r.toFixed(1) + 'x');

async function refreshHome() {
  const [freshOrgs, board] = await Promise.all([
    api('/api/orgs'),
    api(`/api/leaderboard?sort=${leaderboardSort}`),
  ]);
  orgs = freshOrgs;
  $('lb-sort-value').classList.toggle('active', leaderboardSort === 'value');
  $('lb-sort-returns').classList.toggle('active', leaderboardSort === 'returns');

  const list = $('home-orgs');
  list.innerHTML = '';
  const byValuation = [...orgs].sort(
    (a, b) => (b.lastPrice ?? 0) * b.totalShares - (a.lastPrice ?? 0) * a.totalShares
  );
  for (const org of byValuation) {
    const valuation = org.lastPrice ? fmtCompact(org.lastPrice * org.totalShares) : '—';
    const card = document.createElement('div');
    card.className = 'org-card';
    card.innerHTML =
      `<div class="org-card-head">` +
      `<img class="org-logo" src="${org.logo}" alt="">` +
      `<span class="ticker-big">${org.ticker}</span>` +
      `<span class="valuation">${valuation}</span></div>` +
      `<div class="org-card-name">${escapeHtml(org.name)}</div>` +
      sparkline(org.spark);
    card.addEventListener('click', () => showPage('market', org.id));
    list.appendChild(card);
  }

  $('leaderboard').innerHTML = board
    .map(
      (row, i) =>
        `<tr><td>${i + 1}</td><td>${entityLink(row)}</td>` +
        `<td>${fmtCompact(row.value)}</td><td>${fmtReturns(row.returns)}</td></tr>`
    )
    .join('');
}

for (const [id, sort] of [['lb-sort-value', 'value'], ['lb-sort-returns', 'returns']]) {
  $(id).addEventListener('click', () => {
    if (leaderboardSort === sort) return;
    leaderboardSort = sort;
    refreshHome();
  });
}

// Tiny inline price graph for home-page cards.
function sparkline(prices, w = 260, h = 40) {
  if (!prices || prices.length < 2) return `<div class="spark spark-empty"></div>`;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - 3 - ((p - min) / range) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polyline points="${pts}" fill="none" stroke="#1D4E74" stroke-width="1.5" ` +
    `stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`
  );
}

// --- Market data ---
async function refreshMarket() {
  if (!currentOrg) return;
  const [trades, holders, comments] = await Promise.all([
    api(`/api/orgs/${currentOrg}/trades`),
    api(`/api/orgs/${currentOrg}/holders`),
    api(`/api/orgs/${currentOrg}/comments`),
  ]);
  renderTrades(trades);
  renderChart(trades);
  renderOwnership(holders);
  renderComments(comments);
}

// --- Comments ---
function renderComments(comments) {
  const wrap = $('comments');
  wrap.innerHTML = '';
  if (comments.length === 0) {
    wrap.innerHTML = '<p class="no-comments">No comments yet.</p>';
    return;
  }
  for (const c of comments) {
    const div = document.createElement('div');
    div.className = 'comment';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const author = document.createElement('strong');
    author.className = 'user-link';
    author.dataset.uid = c.author_id;
    author.textContent = c.author;
    const when = document.createElement('span');
    when.textContent = fmtWhen(c.created_at);
    meta.append(author, when);
    const body = document.createElement('p');
    body.textContent = c.body;
    div.append(meta, body);
    wrap.appendChild(div);
  }
}

// --- Portfolio value chart ---
// Two step lines: mark-to-market portfolio value, and cumulative net
// deposits. Both jump together when the user buys, so the gap between the
// lines reads as actual P&L rather than a deposit spike.
let lastHistory = null;

function renderValueChart(series) {
  lastHistory = series;
  const svg = $('value-chart');
  const w = svg.parentNode.clientWidth || 640;
  const h = 220;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const m = { top: 14, right: 16, bottom: 26, left: 10 };
  const points = series.map((p) => ({ ...p, time: parseTs(p.t).getTime() }));
  const values = points.flatMap((p) => [p.value, p.deposits]);
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 100;
  const lo = min;
  const hi = max + pad;
  const t0 = points[0].time;
  const span = Math.max(points[points.length - 1].time - t0, 1);
  const x = (t) => m.left + ((t - t0) / span) * (w - m.left - m.right);
  const y = (v) => m.top + (1 - (v - lo) / (hi - lo)) * (h - m.top - m.bottom);

  // Step path: hold each level until the next event, then jump.
  const stepPath = (key) =>
    points
      .map((p, i) => (i === 0 ? `M ${x(p.time)} ${y(p[key])}` : `H ${x(p.time)} V ${y(p[key])}`))
      .join(' ');

  const step = niceStep((hi - lo) / 4);
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const gy = y(v);
    grid +=
      `<line x1="${m.left}" y1="${gy}" x2="${w - m.right}" y2="${gy}" stroke="#E3E2D9"/>` +
      `<text x="${m.left + 2}" y="${gy - 5}" fill="#586374" font-size="11">${fmtCompact(v)}</text>`;
  }

  const fmtTick = (t) => {
    const d = new Date(t);
    if (span > 300 * 864e5) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  let axis = '';
  const seen = new Set();
  for (const f of [0, 1 / 3, 2 / 3, 1]) {
    const label = fmtTick(t0 + span * f);
    if (seen.has(label)) continue;
    seen.add(label);
    const tx = x(t0 + span * f);
    const anchor = tx < m.left + 40 ? 'start' : tx > w - m.right - 40 ? 'end' : 'middle';
    axis += `<text x="${tx}" y="${h - 8}" text-anchor="${anchor}" fill="#586374" font-size="11">${label}</text>`;
  }

  svg.innerHTML =
    grid +
    axis +
    `<path d="${stepPath('deposits')}" fill="none" stroke="#DFA02A" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="${stepPath('value')}" fill="none" stroke="#1D4E74" stroke-width="2" stroke-linejoin="round"/>` +
    `<line class="ch-line" y1="${m.top}" y2="${h - m.bottom}" stroke="#B9BFC9" visibility="hidden"/>`;

  // Hover: nearest event, with value, deposits, and the P&L gap.
  const chLine = svg.querySelector('.ch-line');
  const tooltip = $('own-tooltip');
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * w;
    // The prevailing point is the last one at or before the cursor.
    let best = points[0];
    for (const p of points) if (x(p.time) <= mx) best = p;
    const bx = Math.max(x(best.time), m.left);
    chLine.setAttribute('x1', bx);
    chLine.setAttribute('x2', bx);
    chLine.setAttribute('visibility', 'visible');
    const when = new Date(best.time).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const pnl = best.value - best.deposits;
    tooltip.textContent =
      `${when} — value ${fmtCompact(best.value)}, deposits ${fmtCompact(best.deposits)}, ` +
      `P&L ${pnl < 0 ? '−' : '+'}${fmtCompact(Math.abs(pnl))}`;
    tooltip.classList.remove('hidden');
    tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8) + 'px';
    tooltip.style.top = e.clientY + 14 + 'px';
  };
  svg.onmouseleave = () => {
    chLine.setAttribute('visibility', 'hidden');
    tooltip.classList.add('hidden');
  };
}

// Chart series: light Prussian, marigold, terracotta, verdigris, deep
// Prussian; "Other" wears ivory. Treasury always wears slot 1.
const SERIES_COLORS = ['#4C7EA8', '#DFA02A', '#B0562F', '#4E9B8F', '#16324F'];
const OTHER_COLOR = '#D9CFB6';
const PAPER = '#F6F5F1';

function renderOwnership(holders) {
  const svg = $('ownership-pie');
  const legend = $('ownership-legend');
  const tooltip = $('own-tooltip');
  const total = holders.reduce((sum, h) => sum + h.shares, 0);
  if (total === 0) {
    svg.innerHTML = '';
    legend.textContent = 'No shares issued yet.';
    return;
  }

  // The org's own account (unissued shares) first, then the top holders;
  // everyone under 1% or beyond the 4 named slots folds into "Other" so the
  // ring never needs more than the 5 solved series hues.
  const orgName = orgs.find((o) => o.id === currentOrg).name;
  const treasury = holders.find((h) => h.name === orgName);
  const rest = holders.filter((h) => h !== treasury);
  const named = rest.filter((h, i) => i < 4 && h.shares / total >= 0.01);
  const otherShares = rest.filter((h) => !named.includes(h)).reduce((s, h) => s + h.shares, 0);

  const segments = [];
  if (treasury) segments.push({ ...treasury, color: SERIES_COLORS[0] });
  named.forEach((h, i) => segments.push({ ...h, color: SERIES_COLORS[i + 1] }));
  if (otherShares > 0) segments.push({ name: 'Other', shares: otherShares, color: OTHER_COLOR });

  svg.innerHTML = '';
  legend.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const cx = 120, cy = 120, r = 110, r0 = 62;
  let angle = -Math.PI / 2;

  for (const seg of segments) {
    const pct = (seg.shares / total) * 100;
    let el;
    if (segments.length === 1) {
      // A full ring; arc paths degenerate at 360°, so stroke a circle instead.
      el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', cx);
      el.setAttribute('cy', cy);
      el.setAttribute('r', (r + r0) / 2);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', seg.color);
      el.setAttribute('stroke-width', r - r0);
    } else {
      const a0 = angle;
      const a1 = angle + (seg.shares / total) * 2 * Math.PI;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const xo0 = cx + r * Math.cos(a0), yo0 = cy + r * Math.sin(a0);
      const xo1 = cx + r * Math.cos(a1), yo1 = cy + r * Math.sin(a1);
      const xi0 = cx + r0 * Math.cos(a0), yi0 = cy + r0 * Math.sin(a0);
      const xi1 = cx + r0 * Math.cos(a1), yi1 = cy + r0 * Math.sin(a1);
      el = document.createElementNS(NS, 'path');
      el.setAttribute(
        'd',
        `M ${xo0} ${yo0} A ${r} ${r} 0 ${large} 1 ${xo1} ${yo1} ` +
          `L ${xi1} ${yi1} A ${r0} ${r0} 0 ${large} 0 ${xi0} ${yi0} Z`
      );
      el.setAttribute('fill', seg.color);
      // Paper-color separator between segments.
      el.setAttribute('stroke', PAPER);
      el.setAttribute('stroke-width', '2');
      el.setAttribute('stroke-linejoin', 'round');
    }
    el.addEventListener('mousemove', (e) => {
      tooltip.textContent = `${seg.name} — ${seg.shares.toLocaleString()} shares (${pct.toFixed(1)}%)`;
      tooltip.classList.remove('hidden');
      tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8) + 'px';
      tooltip.style.top = e.clientY + 14 + 'px';
    });
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
    svg.appendChild(el);

    const item = document.createElement('div');
    item.className = 'item';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = seg.color;
    const name = document.createElement(seg.id ? 'a' : 'span');
    if (seg.id) {
      name.className = 'user-link';
      name.dataset.uid = seg.id;
    }
    name.textContent = seg.name;
    const qty = document.createElement('span');
    qty.className = 'qty';
    qty.textContent = `${Math.round(pct)}%`;
    item.append(swatch, name, qty);
    legend.appendChild(item);
  }
}

function renderBook(book) {
  $('bids').innerHTML = book.bids
    .map((l) => `<tr><td>${l.qty}</td><td class="bid">${fmt(l.price)}</td></tr>`)
    .join('');
  $('asks').innerHTML = book.asks
    .map((l) => `<tr><td class="ask">${fmt(l.price)}</td><td>${l.qty}</td></tr>`)
    .join('');
}

// Small trades clutter the table (the chart still shows every trade), so
// totals of $1,000 and under are hidden unless the checkbox opts in.
let lastTradesForTable = [];

function renderTrades(trades) {
  lastTradesForTable = trades;
  const shown = $('show-all-trades').checked
    ? trades
    : trades.filter((t) => t.price * t.qty > 1000_00);
  $('trades').innerHTML = shown
    .map(
      (t) =>
        `<tr><td>${fmtWhen(t.created_at)}</td><td>${fmt(t.price)}</td><td>${t.qty.toLocaleString()}</td>` +
        `<td>${fmtTotal(t.price * t.qty)}</td>` +
        `<td>${userLink(t.buyer_id, t.buyer)}</td><td>${userLink(t.seller_id, t.seller)}</td></tr>`
    )
    .join('');
}

$('show-all-trades').addEventListener('change', () => renderTrades(lastTradesForTable));

// Smallest "nice" step (1/2/2.5/5 × power of ten) at least `raw`.
function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const mult of [1, 2, 2.5, 5]) if (raw <= mult * mag) return mult * mag;
  return 10 * mag;
}

let lastTrades = null;

function renderChart(trades) {
  lastTrades = trades;
  const svg = $('price-chart');
  // The viewBox matches the container's real pixel size so text renders
  // undistorted (the old fixed viewBox + preserveAspectRatio="none"
  // stretched the labels with the chart).
  const w = svg.parentNode.clientWidth || 640;
  const h = 220;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const data = trades
    .slice()
    .reverse()
    .map((t) => ({ time: parseTs(t.created_at).getTime(), price: t.price }));
  if (data.length < 2) {
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#586374" font-size="14">Not enough trades yet</text>`;
    svg.onmousemove = svg.onmouseleave = null;
    return;
  }

  const m = { top: 14, right: 16, bottom: 26, left: 10 };
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.1 || min * 0.1 || 100;
  const lo = min - pad;
  const hi = max + pad;
  const t0 = data[0].time;
  const span = Math.max(data[data.length - 1].time - t0, 1);
  const x = (t) => m.left + ((t - t0) / span) * (w - m.left - m.right);
  const y = (p) => m.top + (1 - (p - lo) / (hi - lo)) * (h - m.top - m.bottom);

  // Horizontal gridlines at nice dollar values, labeled just above the line.
  const step = niceStep((hi - lo) / 4);
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const gy = y(v);
    const label = step % 100 === 0 ? fmtWhole(v) : fmt(v);
    grid +=
      `<line x1="${m.left}" y1="${gy}" x2="${w - m.right}" y2="${gy}" stroke="#E3E2D9"/>` +
      `<text x="${m.left + 2}" y="${gy - 5}" fill="#586374" font-size="11">${label}</text>`;
  }

  // Time axis: a few evenly spaced ticks, labeled to match the span.
  const fmtTick = (t) => {
    const d = new Date(t);
    if (span > 300 * 864e5) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    if (span > 2 * 864e5) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  let axis = '';
  const seen = new Set();
  for (const f of [0, 1 / 3, 2 / 3, 1]) {
    const label = fmtTick(t0 + span * f);
    if (seen.has(label)) continue;
    seen.add(label);
    const tx = x(t0 + span * f);
    const anchor = tx < m.left + 40 ? 'start' : tx > w - m.right - 40 ? 'end' : 'middle';
    axis += `<text x="${tx}" y="${h - 8}" text-anchor="${anchor}" fill="#586374" font-size="11">${label}</text>`;
  }

  const path = data.map((d) => `${x(d.time)},${y(d.price)}`).join(' ');
  svg.innerHTML =
    grid +
    axis +
    `<polyline points="${path}" fill="none" stroke="#1D4E74" stroke-width="2" stroke-linejoin="round"/>` +
    `<line class="ch-line" y1="${m.top}" y2="${h - m.bottom}" stroke="#B9BFC9" visibility="hidden"/>` +
    `<circle class="ch-dot" r="3.5" fill="#1D4E74" stroke="${PAPER}" stroke-width="1.5" visibility="hidden"/>`;

  // Hover: nearest trade gets a crosshair, dot, and tooltip.
  const chLine = svg.querySelector('.ch-line');
  const chDot = svg.querySelector('.ch-dot');
  const tooltip = $('own-tooltip');
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * w;
    let best = data[0];
    for (const d of data) if (Math.abs(x(d.time) - mx) < Math.abs(x(best.time) - mx)) best = d;
    const bx = x(best.time);
    chLine.setAttribute('x1', bx);
    chLine.setAttribute('x2', bx);
    chDot.setAttribute('cx', bx);
    chDot.setAttribute('cy', y(best.price));
    chLine.setAttribute('visibility', 'visible');
    chDot.setAttribute('visibility', 'visible');
    const when = new Date(best.time).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    tooltip.textContent = `${when} — ${fmt(best.price)}`;
    tooltip.classList.remove('hidden');
    tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8) + 'px';
    tooltip.style.top = e.clientY + 14 + 'px';
  };
  svg.onmouseleave = () => {
    chLine.setAttribute('visibility', 'hidden');
    chDot.setAttribute('visibility', 'hidden');
    tooltip.classList.add('hidden');
  };
}

window.addEventListener('resize', () => {
  if (currentOrg !== null && lastTrades) renderChart(lastTrades);
  if ((currentPage === 'user' || currentPage === 'tag') && lastHistory) renderValueChart(lastHistory);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// --- Init ---
async function loadOrgs() {
  orgs = await api('/api/orgs');
  renderTabs();
}

(async function init() {
  await loadOrgs();
  await showPage('home');
  setInterval(() => {
    if (currentPage === 'home') refreshHome();
    else if (currentPage === 'market') refreshMarket();
    loadOrgs();
  }, 3000);
})();
