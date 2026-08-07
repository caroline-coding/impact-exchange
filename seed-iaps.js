// One-shot seeder for the IAPS market. Same model as seed.js: each grant is
// the donor buying newly-issued shares from the org account at a
// valuation-based price; the org account keeps the unissued remainder.
//
// Sources (researched 2026-07-20): Open Philanthropy / Coefficient Giving
// grants database (incl. 2021-2023 grants to the predecessor Rethink
// Priorities AI Governance & Strategy team), SFF recommendation pages
// (listed as Jaan Tallinn), Manifund "AI Policy work @ IAPS" ($10,050,
// donors not itemized). SFF-2025 $572k includes a $300k matching pledge.
// Fuzzy dates mapped to mid-month representative dates.
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');

const ORG = 'iaps';
const ORG_ACCOUNT = 'Institute for AI Policy and Strategy';
const SUPPLY = 950000;

// [date, donor, amountCents, priceCents]
const DONATIONS = [
  ['2021-07-15 12:00', 'Coefficient Giving', 612185_00, 1200],
  ['2022-03-15 12:00', 'Coefficient Giving', 2728319_00, 1500],
  ['2023-04-15 12:00', 'Coefficient Giving', 154810_00, 1800],
  ['2023-04-15 12:05', 'Coefficient Giving', 302390_00, 1800],
  ['2023-11-15 12:00', 'Manifund donors', 10050_00, 1900],
  ['2023-12-15 12:00', 'Jaan Tallinn', 402000_00, 2000],
  ['2024-01-15 12:00', 'Coefficient Giving', 3011895_00, 2200],
  ['2024-04-15 12:00', 'Coefficient Giving', 828049_00, 2400],
  ['2024-11-15 12:00', 'Jaan Tallinn', 183000_00, 2800],
  ['2025-04-15 12:00', 'Coefficient Giving', 11510081_00, 3600],
  ['2025-10-15 12:00', 'Jaan Tallinn', 572000_00, 4000],
];

if (db.prepare('SELECT 1 FROM trades WHERE org = ? LIMIT 1').get(ORG)) {
  console.error('IAPS already has trades. Aborting.');
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
  console.log(`iaps: ${DONATIONS.length} trades, issued ${issued.toLocaleString()}, org holds ${remainder.toLocaleString()} of ${SUPPLY.toLocaleString()}`);
});

seed();
console.log('Done.');
