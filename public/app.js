let orgs = [];
let currentPage = 'home'; // 'home' | 'market' | 'about' | 'portfolio'
let currentOrg = null; // org id when currentPage === 'market'
let currentUserId = Number(localStorage.getItem('userId')) || null;

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

// --- Accounts ---
async function loadUsers() {
  const users = await api('/api/users');
  for (const sel of [$('user-select'), $('admin-user')]) {
    sel.innerHTML = '';
    for (const u of users) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      sel.appendChild(opt);
    }
  }
  if (users.length === 0) {
    currentUserId = null;
  } else if (!users.some((u) => u.id === currentUserId)) {
    currentUserId = users[0].id;
  }
  if (currentUserId) $('user-select').value = currentUserId;
  await refreshWallet();
}

async function refreshWallet() {
  // The home page has no wallet strip; the markets list speaks for itself.
  if (!currentUserId || currentPage === 'home') {
    $('wallet').classList.add('hidden');
    return;
  }
  const user = await api(`/api/users/${currentUserId}`);
  $('wallet').classList.remove('hidden');
  $('wallet-cash').textContent = `Cash: ${fmt(user.balance)}`;
  $('wallet-holdings').textContent = orgs
    .map((o) => `${o.ticker}: ${user.holdings[o.id] ?? 0}`)
    .join('  ·  ');
  renderOpenOrders(user.openOrders.filter((o) => o.org === currentOrg));
}

$('user-select').addEventListener('change', (e) => {
  currentUserId = Number(e.target.value);
  localStorage.setItem('userId', currentUserId);
  refreshWallet();
});

$('create-user-btn').addEventListener('click', async () => {
  const name = $('new-user-name').value.trim();
  if (!name) return;
  try {
    const user = await api('/api/users', { name });
    $('new-user-name').value = '';
    currentUserId = user.id;
    localStorage.setItem('userId', currentUserId);
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

// --- Navigation ---
const VIEWS = { home: 'home-view', market: 'org-view', about: 'about-view', portfolio: 'portfolio-view' };
let marketsExpanded = false;

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
  tab(`${marketsExpanded ? '▾' : '▸'} Markets`, false, () => {
    marketsExpanded = !marketsExpanded;
    renderTabs();
  }, 'group');
  if (marketsExpanded) {
    for (const org of orgs) {
      tab(org.ticker, currentPage === 'market' && currentOrg === org.id, () =>
        showPage('market', org.id), 'sub');
    }
  }
  tab('Portfolio', currentPage === 'portfolio', () => showPage('portfolio'));
}

async function showPage(page, orgId = null) {
  currentPage = page;
  currentOrg = page === 'market' ? orgId : null;
  // Keep the active ticker visible in the sidebar.
  if (page === 'market') marketsExpanded = true;
  for (const [p, viewId] of Object.entries(VIEWS)) {
    $(viewId).classList.toggle('hidden', p !== page);
  }
  renderTabs();
  if (page === 'home') {
    await refreshHome();
  } else if (page === 'market') {
    const org = orgs.find((o) => o.id === orgId);
    $('org-name').innerHTML =
      `<img class="org-logo org-logo-lg" src="${org.logo}" alt="">` +
      `${escapeHtml(org.name)} (${org.ticker})`;
    $('org-blurb').textContent = org.blurb;
    $('org-link').textContent = org.url;
    $('org-link').href = org.url;
    await refreshMarket();
  } else if (page === 'portfolio') {
    await refreshPortfolio();
  }
}

// --- Home page ---
async function refreshHome() {
  const [freshOrgs, board] = await Promise.all([api('/api/orgs'), api('/api/leaderboard')]);
  orgs = freshOrgs;

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
        `<tr><td>${i + 1}</td><td>${escapeHtml(row.name)}</td>` +
        `<td>${fmtCompact(row.value)}</td></tr>`
    )
    .join('');
  await refreshWallet();
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
    `<polyline points="${pts}" fill="none" stroke="#2e5a7a" stroke-width="1.5" ` +
    `stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`
  );
}

// --- Portfolio page ---
async function refreshPortfolio() {
  const cashEl = $('portfolio-cash');
  const rowsEl = $('portfolio-holdings');
  const totalEl = $('portfolio-total');
  if (!currentUserId) {
    cashEl.textContent = 'Create or select an account first.';
    rowsEl.innerHTML = '';
    totalEl.textContent = '';
    return;
  }
  const user = await api(`/api/users/${currentUserId}`);
  const held = orgs.filter((o) => (user.holdings[o.id] ?? 0) > 0);
  let holdingsValue = 0;
  rowsEl.innerHTML = held
    .map((o) => {
      const shares = user.holdings[o.id];
      const value = o.lastPrice ? shares * o.lastPrice : 0;
      holdingsValue += value;
      return (
        `<tr><td>${o.ticker}</td><td>${escapeHtml(o.name)}</td>` +
        `<td>${shares.toLocaleString()}</td>` +
        `<td>${o.lastPrice ? fmt(o.lastPrice) : '—'}</td>` +
        `<td>${fmtWhole(value)}</td></tr>`
      );
    })
    .join('');
  if (held.length === 0) rowsEl.innerHTML = '<tr><td colspan="5">No holdings yet.</td></tr>';
  cashEl.textContent = `Cash: ${fmt(user.balance)}`;
  totalEl.textContent = `Total value: ${fmtWhole(user.balance + holdingsValue)}`;
  await refreshWallet();
}

// --- Market data ---
async function refreshMarket() {
  if (!currentOrg) return;
  const [book, trades, holders] = await Promise.all([
    api(`/api/orgs/${currentOrg}/book`),
    api(`/api/orgs/${currentOrg}/trades`),
    api(`/api/orgs/${currentOrg}/holders`),
  ]);
  renderBook(book);
  renderTrades(trades);
  renderChart(trades);
  renderOwnership(holders);
  await refreshWallet();
}

// Categorical palette (validated for CVD separation; sub-3:1 slots are
// covered by the legend listing every value). Treasury always wears slot 1.
const SERIES_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4'];
const OTHER_COLOR = '#c3c2b7';

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
  // everyone under 1% or beyond the 6 named slots folds into "Other" so
  // slices stay visible and hues stay fixed.
  const orgName = orgs.find((o) => o.id === currentOrg).name;
  const treasury = holders.find((h) => h.name === orgName);
  const rest = holders.filter((h) => h !== treasury);
  const named = rest.filter((h, i) => i < 6 && h.shares / total >= 0.01);
  const otherShares = rest.filter((h) => !named.includes(h)).reduce((s, h) => s + h.shares, 0);

  const segments = [];
  if (treasury) segments.push({ ...treasury, color: SERIES_COLORS[0] });
  named.forEach((h, i) => segments.push({ ...h, color: SERIES_COLORS[i + 1] }));
  if (otherShares > 0) segments.push({ name: 'Other', shares: otherShares, color: OTHER_COLOR });

  svg.innerHTML = '';
  legend.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const cx = 120, cy = 120, r = 110;
  let angle = -Math.PI / 2;

  for (const seg of segments) {
    const pct = (seg.shares / total) * 100;
    let el;
    if (segments.length === 1) {
      el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', cx);
      el.setAttribute('cy', cy);
      el.setAttribute('r', r);
    } else {
      const a0 = angle;
      const a1 = angle + (seg.shares / total) * 2 * Math.PI;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      el = document.createElementNS(NS, 'path');
      el.setAttribute('d', `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`);
    }
    el.setAttribute('fill', seg.color);
    // Surface-color separator between slices.
    el.setAttribute('stroke', '#fff');
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linejoin', 'round');
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
    const name = document.createElement('span');
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

function renderTrades(trades) {
  $('trades').innerHTML = trades
    .map(
      (t) =>
        `<tr><td>${fmtWhen(t.created_at)}</td><td>${fmt(t.price)}</td><td>${t.qty.toLocaleString()}</td>` +
        `<td>${fmtWhole(t.price * t.qty)}</td>` +
        `<td>${escapeHtml(t.buyer)}</td><td>${escapeHtml(t.seller)}</td></tr>`
    )
    .join('');
}

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
    svg.innerHTML = `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#8b877c" font-size="14">Not enough trades yet</text>`;
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
      `<line x1="${m.left}" y1="${gy}" x2="${w - m.right}" y2="${gy}" stroke="#ecebe4"/>` +
      `<text x="${m.left + 2}" y="${gy - 5}" fill="#8b877c" font-size="11">${label}</text>`;
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
    axis += `<text x="${tx}" y="${h - 8}" text-anchor="${anchor}" fill="#8b877c" font-size="11">${label}</text>`;
  }

  const path = data.map((d) => `${x(d.time)},${y(d.price)}`).join(' ');
  svg.innerHTML =
    grid +
    axis +
    `<polyline points="${path}" fill="none" stroke="#2e5a7a" stroke-width="2" stroke-linejoin="round"/>` +
    `<line class="ch-line" y1="${m.top}" y2="${h - m.bottom}" stroke="#d8d5cb" visibility="hidden"/>` +
    `<circle class="ch-dot" r="3.5" fill="#2e5a7a" stroke="#fff" stroke-width="1.5" visibility="hidden"/>`;

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
});

function renderOpenOrders(openOrders) {
  $('open-orders').innerHTML = openOrders
    .map(
      (o) =>
        `<tr><td class="${o.side === 'buy' ? 'bid' : 'ask'}">${o.side}</td>` +
        `<td>${fmt(o.price)}</td><td>${o.remaining}</td>` +
        `<td><button class="cancel-btn" data-id="${o.id}">Cancel</button></td></tr>`
    )
    .join('');
  for (const btn of document.querySelectorAll('.cancel-btn')) {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/orders/${btn.dataset.id}/cancel`, { userId: currentUserId });
        await refreshMarket();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

// --- Order form ---
$('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('order-error').textContent = '';
  if (!currentUserId) {
    $('order-error').textContent = 'Create or select an account first.';
    return;
  }
  const side = document.querySelector('input[name="side"]:checked').value;
  const price = Math.round(parseFloat($('order-price').value) * 100);
  const qty = parseInt($('order-qty').value, 10);
  try {
    await api('/api/orders', { userId: currentUserId, org: currentOrg, side, price, qty });
    $('order-price').value = '';
    $('order-qty').value = '';
    await refreshMarket();
    await loadOrgs();
  } catch (err) {
    $('order-error').textContent = err.message;
  }
});

// --- Admin ---
$('admin-btn').addEventListener('click', () => $('admin-dialog').showModal());
$('admin-close-btn').addEventListener('click', () => $('admin-dialog').close());
$('admin-grant-btn').addEventListener('click', async () => {
  const msg = $('admin-msg');
  msg.textContent = '';
  try {
    await api('/api/admin/grant', {
      password: $('admin-password').value,
      userId: Number($('admin-user').value),
      cash: Math.round(parseFloat($('admin-cash').value || '0') * 100),
      org: $('admin-org').value,
      shares: parseInt($('admin-shares').value || '0', 10),
    });
    msg.textContent = 'Granted.';
    msg.style.color = '#2e7d4f';
    await refreshWallet();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = '#ae4a3f';
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// --- Init ---
async function loadOrgs() {
  orgs = await api('/api/orgs');
  renderTabs();
  const adminOrg = $('admin-org');
  if (adminOrg.options.length === 0) {
    for (const org of orgs) {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = org.ticker;
      adminOrg.appendChild(opt);
    }
  }
}

(async function init() {
  await loadOrgs();
  await loadUsers();
  await showPage('home');
  setInterval(() => {
    if (currentPage === 'home') refreshHome();
    else if (currentPage === 'market') refreshMarket();
    else if (currentPage === 'portfolio') refreshPortfolio();
    loadOrgs();
  }, 3000);
})();
