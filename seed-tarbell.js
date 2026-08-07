// One-shot seeder for the Tarbell market. Same model as seed-iaps.js.
//
// Sources (researched 2026-07-20): Open Philanthropy / Coefficient Giving
// grants (incl. the Sep 2023 grant to Training for Good covering the Tarbell
// Fellowship), SFF 2024/2025 rounds (as Jaan Tallinn; 2025 excludes the
// $200k conditional matching pledge), Future of Life Institute 2024, ACX
// Grants (as Scott Alexander), and Manifund's per-donor list ($28,650 total;
// the two sub-$1k donations are combined into "Manifund donors").
// Unitemized band-only funders (EAIF, Casey & Family, Ought, etc.) excluded.
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');

const ORG = 'tarbell';
const ORG_ACCOUNT = 'Tarbell';
const SUPPLY = 800000;

// [date, donor, amountCents, priceCents]
const DONATIONS = [
  ['2023-09-15 12:00', 'Coefficient Giving', 575000_00, 500],
  ['2024-02-10 12:00', 'Scott Alexander', 32000_00, 550],
  ['2024-07-15 12:00', 'Future of Life Institute', 150000_00, 600],
  ['2024-11-15 12:00', 'Jaan Tallinn', 520000_00, 700],
  ['2024-11-15 12:05', 'Coefficient Giving', 816000_00, 700],
  ['2025-08-15 12:00', 'Coefficient Giving', 2888000_00, 1000],
  ['2025-09-20 12:00', 'Ryan Kidd', 10000_00, 1050],
  ['2025-09-21 12:00', 'Marius Hobbhahn', 10000_00, 1050],
  ['2025-10-06 12:00', 'Manifund donors', 150_00, 1050],
  ['2025-10-15 12:00', 'Jaan Tallinn', 583000_00, 1100],
  ['2025-10-20 12:00', 'Marcus Abramovitch', 7500_00, 1100],
  ['2026-04-10 12:00', 'Nick Saraev', 1000_00, 1200],
];

if (db.prepare('SELECT 1 FROM trades WHERE org = ? LIMIT 1').get(ORG)) {
  console.error('Tarbell already has trades. Aborting.');
  process.exit(1);
}

function getOrCreateUser(name) {
  const row = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (row) return row.id;
  return db.prepare('INSERT INTO users (name) VALUES (?)').run(name).lastInsertRowid;
}

function adjustHoldings(userId, org, delta) {
  const upd = db
    .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
    .run(delta, userId, org);
  if (upd.changes === 0) {
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(userId, org, delta);
  }
}

const seed = db.transaction(() => {
  const orgAccountId = getOrCreateUser(ORG_ACCOUNT);
  for (const [date, donor, amount, price] of DONATIONS) {
    const donorId = getOrCreateUser(donor);
    const qty = Math.max(1, Math.round(amount / price));
    const ts = date + ':00';
    const sellId = db
      .prepare(
        `INSERT INTO orders (user_id, org, side, price, qty, remaining, status, created_at)
         VALUES (?, ?, 'sell', ?, ?, 0, 'filled', ?)`
      )
      .run(orgAccountId, ORG, price, qty, ts).lastInsertRowid;
    const buyId = db
      .prepare(
        `INSERT INTO orders (user_id, org, side, price, qty, remaining, status, created_at)
         VALUES (?, ?, 'buy', ?, ?, 0, 'filled', ?)`
      )
      .run(donorId, ORG, price, qty, ts).lastInsertRowid;
    db.prepare(
      `INSERT INTO trades (org, price, qty, buyer_id, seller_id, buy_order_id, sell_order_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ORG, price, qty, donorId, orgAccountId, buyId, sellId, ts);

    adjustHoldings(donorId, ORG, qty);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(price * qty, orgAccountId);
  }

  const issued = db
    .prepare('SELECT COALESCE(SUM(shares),0) s FROM holdings WHERE org = ? AND user_id != ?')
    .get(ORG, orgAccountId).s;
  const remainder = SUPPLY - issued;
  if (remainder < 0) throw new Error(`issued ${issued} exceeds supply ${SUPPLY}`);
  adjustHoldings(orgAccountId, ORG, remainder);
  console.log(`tarbell: ${DONATIONS.length} trades, issued ${issued.toLocaleString()}, org holds ${remainder.toLocaleString()} of ${SUPPLY.toLocaleString()}`);
});

seed();
console.log('Done.');
