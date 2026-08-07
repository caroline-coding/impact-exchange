// One-shot seeder for the MATS market. Same model as seed-iaps.js.
//
// Sources (researched 2026-07-20): Open Philanthropy / Coefficient Giving
// grants (incl. grants routed via fiscal sponsors BERI, AI Safety Support,
// and Conjecture for London ops; the ~$1.1M 2023 AI Safety Support grant is
// inferred from OP's stated $2,641,368 two-grant total; the $26.9M May 2025
// grant appears double-listed upstream and is counted once), SFF/Lightspeed
// rounds (as Jaan Tallinn), LTFF, and Manifund's per-donor list ($290,323
// total; small donors and the EA Community Choice match are combined into
// "Manifund donors"; Jalex Stark's two Dec 2023 donations combined).
// Excluded: the 2021 SERI Summer Fellowships precursor grant ($210k).
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');

const ORG = 'mats';
const ORG_ACCOUNT = 'MATS';
const SUPPLY = 1750000;

// [date, donor, amountCents, priceCents]
const DONATIONS = [
  ['2021-11-15 12:00', 'Coefficient Giving', 195000_00, 800],
  ['2022-04-15 12:00', 'Coefficient Giving', 1008127_00, 1000],
  ['2022-10-15 12:00', 'Coefficient Giving', 457380_00, 1200],
  ['2022-11-15 12:00', 'Coefficient Giving', 2047268_00, 1300],
  ['2022-11-15 12:05', 'Coefficient Giving', 1538000_00, 1300],
  ['2022-12-15 12:00', 'Long-Term Future Fund', 27000_00, 1300],
  ['2023-04-15 12:00', 'Coefficient Giving', 245000_00, 1500],
  ['2023-06-15 12:00', 'Coefficient Giving', 428942_00, 1600],
  ['2023-09-15 12:00', 'Coefficient Giving', 1103368_00, 1700],
  ['2023-11-27 12:00', 'Tristan Hume', 150000_00, 1800],
  ['2023-12-15 12:00', 'Jaan Tallinn', 297818_00, 1900],
  ['2023-12-15 12:05', 'Jaan Tallinn', 48000_00, 1900],
  ['2023-12-15 12:10', 'Jaan Tallinn', 282300_00, 1900],
  ['2023-12-28 12:00', 'Jalex Stark', 20000_00, 1900],
  ['2023-12-30 12:00', 'Evan Hubinger', 17533_00, 1900],
  ['2024-04-28 12:00', 'Evan Hubinger', 80000_00, 2200],
  ['2024-06-05 12:00', 'Coefficient Giving', 3382029_00, 2500],
  ['2024-09-13 12:00', 'Manifund donors', 12790_00, 2700],
  ['2024-11-15 12:00', 'Jaan Tallinn', 639000_00, 3000],
  ['2024-12-19 12:00', 'Coefficient Giving', 660000_00, 3200],
  ['2024-12-29 12:00', 'Evan Hubinger', 10000_00, 3200],
  ['2025-03-14 12:00', 'Coefficient Giving', 6880000_00, 4000],
  ['2025-05-15 12:00', 'Coefficient Giving', 26924000_00, 5000],
  ['2025-10-15 12:00', 'Jaan Tallinn', 289000_00, 5500],
  ['2026-04-06 12:00', 'Coefficient Giving', 200000_00, 6000],
];

if (db.prepare('SELECT 1 FROM trades WHERE org = ? LIMIT 1').get(ORG)) {
  console.error('MATS already has trades. Aborting.');
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
  // SET (not +=): the org account may hold a provisional placeholder amount.
  const upd = db
    .prepare('UPDATE holdings SET shares = ? WHERE user_id = ? AND org = ?')
    .run(remainder, orgAccountId, ORG);
  if (upd.changes === 0) {
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(orgAccountId, ORG, remainder);
  }
  console.log(`mats: ${DONATIONS.length} trades, issued ${issued.toLocaleString()}, org holds ${remainder.toLocaleString()} of ${SUPPLY.toLocaleString()}`);
});

seed();
console.log('Done.');
