const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PORT = process.env.PORT || 3000;

// Prices and cash are stored in integer cents to avoid float rounding.
const ORGS = {
  mats: {
    id: 'mats',
    name: 'MATS',
    ticker: 'MATS',
    url: 'https://matsprogram.org',
    logo: '/logos/mats.png',
    blurb:
      'ML Alignment & Theory Scholars — a Berkeley-based research fellowship ' +
      'that pairs emerging researchers with mentors at leading AI safety ' +
      'organizations for intensive research cohorts. One of the main talent ' +
      'pipelines into alignment research.',
  },
  timaeus: {
    id: 'timaeus',
    name: 'Timaeus',
    ticker: 'TIMA',
    url: 'https://timaeus.co',
    logo: '/logos/timaeus.png',
    blurb:
      'An AI safety research organization focused on developmental ' +
      'interpretability: applying singular learning theory to understand how ' +
      'structure and capabilities emerge in neural networks over training.',
  },
  lightcone: {
    id: 'lightcone',
    name: 'Lightcone Infrastructure',
    ticker: 'LCON',
    url: 'https://lightconeinfrastructure.com',
    logo: '/logos/lightcone.svg',
    blurb:
      'Builds infrastructure for the rationality and AI safety communities. ' +
      'Runs LessWrong and the AI Alignment Forum, and operates the Lighthaven ' +
      'campus in Berkeley for conferences, workshops, and research retreats.',
  },
  iaps: {
    id: 'iaps',
    name: 'Institute for AI Policy and Strategy',
    ticker: 'IAPS',
    url: 'https://www.iaps.ai',
    logo: '/logos/iaps.webp',
    blurb:
      'A nonpartisan, Washington DC-based think tank producing policy research ' +
      'on frontier AI: compute governance, standards and regulation, ' +
      'information security, and international governance. Spun out of ' +
      "Rethink Priorities' AI Governance and Strategy team in September 2023.",
  },
  tarbell: {
    id: 'tarbell',
    name: 'Tarbell',
    ticker: 'TARB',
    url: 'https://www.tarbellcenter.org',
    logo: '/logos/tarbell.png',
    blurb:
      'The Tarbell Center for AI Journalism funds and trains journalists ' +
      'covering AI: a 12-month fellowship placing reporters at outlets like ' +
      'Bloomberg, TIME, and The Guardian, plus grants for original AI ' +
      'reporting and the Transformer newsletter. Launched in 2022 as the ' +
      'Tarbell Fellowship under Training for Good, independent since 2024.',
  },
};

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS holdings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  org TEXT NOT NULL,
  shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
  PRIMARY KEY (user_id, org)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  org TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price INTEGER NOT NULL CHECK (price > 0),
  qty INTEGER NOT NULL CHECK (qty > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  buy_order_id INTEGER NOT NULL REFERENCES orders(id),
  sell_order_id INTEGER NOT NULL REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_book ON orders (org, side, status, price);
CREATE INDEX IF NOT EXISTS idx_trades_org ON trades (org, id);
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getHoldings(userId) {
  const rows = db
    .prepare('SELECT org, shares FROM holdings WHERE user_id = ?')
    .all(userId);
  const holdings = {};
  for (const org of Object.keys(ORGS)) holdings[org] = 0;
  for (const row of rows) holdings[row.org] = row.shares;
  return holdings;
}

function adjustShares(userId, org, delta) {
  // Can't use INSERT ... ON CONFLICT here: SQLite evaluates the CHECK on the
  // inserted values (possibly negative) before conflict resolution runs.
  const { changes } = db
    .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
    .run(delta, userId, org);
  if (changes === 0) {
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(
      userId,
      org,
      delta
    );
  }
}

function adjustBalance(userId, delta) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(delta, userId);
}

function requireUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw httpError(404, 'User not found');
  return user;
}

function requireOrg(org) {
  if (!ORGS[org]) throw httpError(404, 'Unknown organization');
  return ORGS[org];
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// --- Matching engine ---
// Funds are escrowed at order placement: buys lock price*qty cash, sells lock
// shares. Fills execute at the resting order's price; a buyer whose limit was
// above the fill price gets the difference refunded from escrow.
const placeOrder = db.transaction((userId, org, side, price, qty) => {
  const user = requireUser(userId);

  if (side === 'buy') {
    const cost = price * qty;
    if (user.balance < cost) throw httpError(400, 'Insufficient balance');
    adjustBalance(userId, -cost);
  } else {
    const holdings = getHoldings(userId);
    if (holdings[org] < qty) throw httpError(400, 'Insufficient shares');
    adjustShares(userId, org, -qty);
  }

  const orderId = db
    .prepare(
      `INSERT INTO orders (user_id, org, side, price, qty, remaining)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, org, side, price, qty, qty).lastInsertRowid;

  let remaining = qty;
  const oppositeSide = side === 'buy' ? 'sell' : 'buy';
  const priceCond = side === 'buy' ? 'price <= ?' : 'price >= ?';
  const priceOrder = side === 'buy' ? 'price ASC' : 'price DESC';
  const matches = db
    .prepare(
      `SELECT * FROM orders
       WHERE org = ? AND side = ? AND status = 'open' AND ${priceCond}
       ORDER BY ${priceOrder}, id ASC`
    )
    .all(org, oppositeSide, price);

  for (const resting of matches) {
    if (remaining === 0) break;
    const fillQty = Math.min(remaining, resting.remaining);
    const fillPrice = resting.price; // resting order sets the price
    const buyOrderId = side === 'buy' ? orderId : resting.id;
    const sellOrderId = side === 'sell' ? orderId : resting.id;
    const buyerId = side === 'buy' ? userId : resting.user_id;
    const sellerId = side === 'sell' ? userId : resting.user_id;

    adjustBalance(sellerId, fillPrice * fillQty);
    adjustShares(buyerId, org, fillQty);
    // Incoming buy escrowed at its own limit price; refund any improvement.
    if (side === 'buy' && price > fillPrice) {
      adjustBalance(userId, (price - fillPrice) * fillQty);
    }

    db.prepare(
      `INSERT INTO trades (org, price, qty, buyer_id, seller_id, buy_order_id, sell_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(org, fillPrice, fillQty, buyerId, sellerId, buyOrderId, sellOrderId);

    const restingRemaining = resting.remaining - fillQty;
    db.prepare('UPDATE orders SET remaining = ?, status = ? WHERE id = ?').run(
      restingRemaining,
      restingRemaining === 0 ? 'filled' : 'open',
      resting.id
    );
    remaining -= fillQty;
  }

  db.prepare('UPDATE orders SET remaining = ?, status = ? WHERE id = ?').run(
    remaining,
    remaining === 0 ? 'filled' : 'open',
    orderId
  );

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
});

const cancelOrder = db.transaction((orderId, userId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw httpError(404, 'Order not found');
  if (order.user_id !== userId) throw httpError(403, 'Not your order');
  if (order.status !== 'open') throw httpError(400, 'Order is not open');

  if (order.side === 'buy') {
    adjustBalance(userId, order.price * order.remaining);
  } else {
    adjustShares(userId, order.org, order.remaining);
  }
  db.prepare("UPDATE orders SET status = 'cancelled', remaining = 0 WHERE id = ?").run(orderId);
});

// --- API ---
app.get('/api/orgs', (req, res) => {
  const orgs = Object.values(ORGS).map((org) => {
    const lastTrade = db
      .prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1')
      .get(org.id);
    return { ...org, lastPrice: lastTrade ? lastTrade.price : null };
  });
  res.json(orgs);
});

app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT id, name, balance FROM users ORDER BY name').all());
});

app.post('/api/users', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  try {
    const info = db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
    res.json(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw httpError(400, 'Name already taken');
    throw err;
  }
});

app.get('/api/users/:id', (req, res) => {
  const user = requireUser(req.params.id);
  res.json({
    ...user,
    holdings: getHoldings(user.id),
    openOrders: db
      .prepare(
        "SELECT * FROM orders WHERE user_id = ? AND status = 'open' ORDER BY id DESC"
      )
      .all(user.id),
  });
});

app.post('/api/orders', (req, res) => {
  const { userId, org, side, price, qty } = req.body;
  requireOrg(org);
  if (side !== 'buy' && side !== 'sell') throw httpError(400, 'Side must be buy or sell');
  if (!Number.isInteger(price) || price <= 0) {
    throw httpError(400, 'Price must be a positive integer number of cents');
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw httpError(400, 'Quantity must be a positive integer');
  }
  res.json(placeOrder(userId, org, side, price, qty));
});

app.post('/api/orders/:id/cancel', (req, res) => {
  cancelOrder(Number(req.params.id), req.body.userId);
  res.json({ ok: true });
});

app.get('/api/orgs/:org/book', (req, res) => {
  const org = requireOrg(req.params.org).id;
  const levels = (side, order) =>
    db
      .prepare(
        `SELECT price, SUM(remaining) AS qty FROM orders
         WHERE org = ? AND side = ? AND status = 'open'
         GROUP BY price ORDER BY price ${order} LIMIT 15`
      )
      .all(org, side);
  res.json({ bids: levels('buy', 'DESC'), asks: levels('sell', 'ASC') });
});

app.get('/api/leaderboard', (req, res) => {
  const lastPrices = {};
  for (const org of Object.keys(ORGS)) {
    const t = db
      .prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1')
      .get(org);
    lastPrices[org] = t ? t.price : 0;
  }
  // Hidden from the leaderboard: org accounts hold their own unissued shares
  // (not "owned impact"), and the donor aggregates aren't single holders.
  const hiddenNames = [
    ...Object.values(ORGS).map((o) => o.name),
    '~1,000 individual donors (LW/EA fundraiser)',
    'Manifund donors',
  ];
  const rows = db
    .prepare(
      `SELECT u.name, h.org, h.shares FROM holdings h
       JOIN users u ON u.id = h.user_id
       WHERE h.shares > 0 AND u.name NOT IN (${hiddenNames.map(() => '?').join(',')})`
    )
    .all(...hiddenNames);
  const byUser = {};
  for (const r of rows) {
    byUser[r.name] ??= { name: r.name, holdings: {}, value: 0 };
    byUser[r.name].holdings[r.org] = r.shares;
    byUser[r.name].value += r.shares * lastPrices[r.org];
  }
  res.json(
    Object.values(byUser)
      .sort((a, b) => b.value - a.value)
      .slice(0, 25)
  );
});

app.get('/api/orgs/:org/holders', (req, res) => {
  const org = requireOrg(req.params.org).id;
  res.json(
    db
      .prepare(
        `SELECT u.name, h.shares FROM holdings h
         JOIN users u ON u.id = h.user_id
         WHERE h.org = ? AND h.shares > 0
         ORDER BY h.shares DESC`
      )
      .all(org)
  );
});

app.get('/api/orgs/:org/trades', (req, res) => {
  const org = requireOrg(req.params.org).id;
  res.json(
    db
      .prepare(
        `SELECT t.id, t.price, t.qty, t.created_at,
                b.name AS buyer, s.name AS seller
         FROM trades t
         JOIN users b ON b.id = t.buyer_id
         JOIN users s ON s.id = t.seller_id
         WHERE t.org = ? ORDER BY t.id DESC LIMIT 100`
      )
      .all(org)
  );
});

app.post('/api/admin/grant', (req, res) => {
  const { password, userId, cash, org, shares } = req.body;
  if (password !== ADMIN_PASSWORD) throw httpError(403, 'Wrong admin password');
  requireUser(userId);
  const grant = db.transaction(() => {
    if (cash) {
      if (!Number.isInteger(cash)) throw httpError(400, 'Cash must be an integer number of cents');
      adjustBalance(userId, cash);
    }
    if (shares) {
      requireOrg(org);
      if (!Number.isInteger(shares)) throw httpError(400, 'Shares must be an integer');
      adjustShares(userId, org, shares);
    }
  });
  grant();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  // SQLite CHECK violations (e.g. balance would go negative) surface here.
  if (String(err.message).includes('CHECK constraint')) {
    return res.status(400).json({ error: 'Insufficient funds or shares' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Impact Exchange running at http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD} (set ADMIN_PASSWORD env var to change)`);
});
