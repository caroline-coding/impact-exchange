// Builds the deployable static site in dist/: a copy of public/ plus
// data/*.json files that replace the old Express API for the read-only demo.
// The frontend's api() helper maps old API paths onto these files.
//
// Run after any reseed: node export-static.js
//
// Layout:
//   dist/data/orgs.json                 — /api/orgs
//   dist/data/leaderboard.json          — { value: [...], returns: [...] }
//   dist/data/orgs/<org>.json           — { trades, holders, comments }
//   dist/data/users.json                — full search list (users + tags)
//   dist/data/users/<id>.json           — { profile, history }
//   dist/data/tags/<tag>.json           — { profile, history }

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, 'exchange.db'), { readonly: true });

const ORG_IDS = ['mats', 'timaeus', 'lightcone', 'iaps', 'tarbell'];
const ORG_NAMES = {
  mats: 'MATS',
  timaeus: 'Timaeus',
  lightcone: 'Lightcone Infrastructure',
  iaps: 'Institute for AI Policy and Strategy',
  tarbell: 'Tarbell',
};
const TAGS = { manifund: 'Manifund regranting', sff: 'SFF' };
const HIDDEN_FROM_LEADERBOARD = [
  ...Object.values(ORG_NAMES),
  '~1,000 individual donors (LW/EA fundraiser)',
  'Manifund donors',
  'Small donors',
];

// Org metadata lives in server.js's ORGS table; read it from there so the
// blurbs and logos stay single-sourced.
const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const orgsLiteral = serverSrc.match(/const ORGS = (\{[\s\S]*?\n\});/)[1];
const ORGS = eval(`(${orgsLiteral})`);

const DIST = path.join(__dirname, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, 'public'), DIST, { recursive: true });
const dataDir = (...p) => {
  const dir = path.join(DIST, 'data', ...p);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  return dir;
};
const write = (file, obj) => fs.writeFileSync(dataDir(file), JSON.stringify(obj));

// --- Shared helpers (mirroring server.js) ---
function getLastPrices() {
  const prices = {};
  for (const org of ORG_IDS) {
    const t = db.prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1').get(org);
    prices[org] = t ? t.price : 0;
  }
  return prices;
}

function portfolioValue(userId, lastPrices) {
  return db
    .prepare('SELECT org, shares FROM holdings WHERE user_id = ? AND shares > 0')
    .all(userId)
    .reduce((sum, h) => sum + h.shares * (lastPrices[h.org] ?? 0), 0);
}

function tagAggregates(tag, lastPrices) {
  const rows = db
    .prepare('SELECT org, SUM(qty) AS shares, SUM(price * qty) AS cost FROM trades WHERE tag = ? GROUP BY org')
    .all(tag)
    .filter((r) => ORG_IDS.includes(r.org));
  let value = 0;
  let cost = 0;
  const holdings = rows.map((r) => {
    value += r.shares * lastPrices[r.org];
    cost += r.cost;
    return { org: r.org, shares: r.shares, lastPrice: lastPrices[r.org], value: r.shares * lastPrices[r.org] };
  });
  return { holdings, value, cost };
}

function valueHistory(isMine) {
  const allTrades = db
    .prepare('SELECT org, price, qty, buyer_id, seller_id, tag, created_at FROM trades ORDER BY created_at, id')
    .all();
  const lastPrice = {};
  const shares = {};
  let deposits = 0;
  let involved = false;
  const series = [];
  for (const t of allTrades) {
    lastPrice[t.org] = t.price;
    const mine = isMine(t);
    if (mine === 'buy') {
      shares[t.org] = (shares[t.org] ?? 0) + t.qty;
      deposits += t.price * t.qty;
      involved = true;
    } else if (mine === 'sell') {
      shares[t.org] = (shares[t.org] ?? 0) - t.qty;
      deposits -= t.price * t.qty;
    }
    if (!involved) continue;
    const value = Object.entries(shares).reduce((s, [org, q]) => s + q * (lastPrice[org] ?? 0), 0);
    series.push({ t: t.created_at, value, deposits });
  }
  if (series.length > 0) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    series.push({ ...series[series.length - 1], t: now });
  }
  return series;
}

const lastPrices = getLastPrices();

// --- orgs.json ---
write(
  'orgs.json',
  Object.values(ORGS).map((org) => {
    const lastTrade = db.prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1').get(org.id);
    const totalShares = db
      .prepare('SELECT COALESCE(SUM(shares), 0) AS s FROM holdings WHERE org = ?')
      .get(org.id).s;
    const spark = db
      .prepare('SELECT price FROM trades WHERE org = ? ORDER BY id')
      .all(org.id)
      .map((r) => r.price);
    return { ...org, lastPrice: lastTrade ? lastTrade.price : null, totalShares, spark };
  })
);

// --- leaderboard.json ---
function leaderboard() {
  const rows = db
    .prepare(
      `SELECT u.id AS uid, u.name, h.org, h.shares FROM holdings h
       JOIN users u ON u.id = h.user_id
       WHERE h.shares > 0 AND u.name NOT IN (${HIDDEN_FROM_LEADERBOARD.map(() => '?').join(',')})`
    )
    .all(...HIDDEN_FROM_LEADERBOARD);
  const byUser = {};
  for (const r of rows) {
    byUser[r.name] ??= { id: r.uid, name: r.name, holdings: {}, value: 0 };
    byUser[r.name].holdings[r.org] = r.shares;
    byUser[r.name].value += r.shares * lastPrices[r.org];
  }
  const costByName = {};
  for (const r of db
    .prepare(
      `SELECT u.name AS name, SUM(t.price * t.qty) AS cost
       FROM trades t JOIN users u ON u.id = t.buyer_id GROUP BY t.buyer_id`
    )
    .all()) {
    costByName[r.name] = r.cost;
  }
  const entries = Object.values(byUser).map((u) => {
    const cost = costByName[u.name] ?? 0;
    return { ...u, returns: cost > 0 ? u.value / cost : null };
  });
  for (const [tag, label] of Object.entries(TAGS)) {
    const agg = tagAggregates(tag, lastPrices);
    if (agg.holdings.length === 0) continue;
    entries.push({ tag, name: label, isTag: true, value: agg.value, returns: agg.cost > 0 ? agg.value / agg.cost : null });
  }
  return {
    value: [...entries].sort((a, b) => b.value - a.value).slice(0, 20),
    returns: entries
      .filter((u) => u.returns !== null)
      .sort((a, b) => b.returns - a.returns)
      .slice(0, 20),
  };
}
write('leaderboard.json', leaderboard());

// --- per-org files ---
for (const org of ORG_IDS) {
  const trades = db
    .prepare(
      `SELECT t.id, t.price, t.qty, t.created_at, b.name AS buyer, s.name AS seller, t.buyer_id, t.seller_id
       FROM trades t JOIN users b ON b.id = t.buyer_id JOIN users s ON s.id = t.seller_id
       WHERE t.org = ? ORDER BY t.id DESC LIMIT 500`
    )
    .all(org);
  const holders = db
    .prepare(
      `SELECT u.id, u.name, h.shares FROM holdings h JOIN users u ON u.id = h.user_id
       WHERE h.org = ? AND h.shares > 0 ORDER BY h.shares DESC`
    )
    .all(org);
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.name AS author, c.user_id AS author_id
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.org = ? ORDER BY c.id DESC LIMIT 200`
    )
    .all(org);
  write(path.join('orgs', `${org}.json`), { trades, holders, comments });
}

// --- users ---
const users = db.prepare('SELECT id, name FROM users ORDER BY name').all();
write('users.json', [
  ...users.map((u) => ({ ...u, value: portfolioValue(u.id, lastPrices) })),
  ...Object.entries(TAGS).map(([tag, label]) => ({
    tag,
    name: label,
    isTag: true,
    value: tagAggregates(tag, lastPrices).value,
  })),
].sort((a, b) => a.name.localeCompare(b.name)));

for (const u of users) {
  const holdings = db
    .prepare('SELECT org, shares FROM holdings WHERE user_id = ? AND shares > 0')
    .all(u.id)
    .filter((h) => ORG_IDS.includes(h.org))
    .map((h) => ({ org: h.org, shares: h.shares, lastPrice: lastPrices[h.org], value: h.shares * lastPrices[h.org] }));
  const trades = db
    .prepare(
      `SELECT t.org, t.price, t.qty, t.created_at,
              CASE WHEN t.buyer_id = @id THEN 'buy' ELSE 'sell' END AS side,
              CASE WHEN t.buyer_id = @id THEN s.name ELSE b.name END AS counterparty,
              CASE WHEN t.buyer_id = @id THEN t.seller_id ELSE t.buyer_id END AS counterpartyId
       FROM trades t JOIN users b ON b.id = t.buyer_id JOIN users s ON s.id = t.seller_id
       WHERE t.buyer_id = @id OR t.seller_id = @id
       ORDER BY t.created_at DESC, t.id DESC LIMIT 200`
    )
    .all({ id: u.id });
  const isTreasury = Object.values(ORG_NAMES).includes(u.name);
  const history = isTreasury
    ? []
    : valueHistory((t) => (t.buyer_id === u.id ? 'buy' : t.seller_id === u.id ? 'sell' : null));
  write(path.join('users', `${u.id}.json`), {
    profile: { id: u.id, name: u.name, holdings, trades },
    history,
  });
}

// --- tags ---
for (const [tag, label] of Object.entries(TAGS)) {
  const { holdings } = tagAggregates(tag, lastPrices);
  const trades = db
    .prepare(
      `SELECT t.org, t.price, t.qty, t.created_at, 'buy' AS side,
              b.name AS counterparty, t.buyer_id AS counterpartyId
       FROM trades t JOIN users b ON b.id = t.buyer_id
       WHERE t.tag = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 200`
    )
    .all(tag);
  write(path.join('tags', `${tag}.json`), {
    profile: { tag, name: label, isTag: true, holdings, trades },
    history: valueHistory((t) => (t.tag === tag ? 'buy' : null)),
  });
}

const count = fs.readdirSync(path.join(DIST, 'data', 'users')).length;
console.log(`dist/ built: 5 orgs, ${count} user files, ${Object.keys(TAGS).length} tags.`);
