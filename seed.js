// One-shot seeder: turns the AI-safety-org donations spreadsheet into
// backdated trade history. Each donation is modeled as the donor buying
// newly-issued shares from the org's Treasury account at a valuation-based
// price (prices in cents; qty = amount / price).
//
// Sources: AI_safety_org_donations (1).xlsx. Fuzzy dates ("SFF-2023-H2",
// "2019-mid-2022 cumulative") are mapped to representative concrete dates.
// The Lightcone Nov24-Jan25 fundraiser lump sum ($2.1M) is reduced by the
// four named gifts listed as its subset ($485k) to avoid double counting.
// Vincent Weisser's combined Timaeus row is split back into its two dates.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');

// [date, donor, amountCents, priceCents]
const DONATIONS = {
  timaeus: [
    ['2023-08-16 12:00', 'Evan Hubinger', 100000_00, 430],
    ['2023-08-16 12:05', 'Marcus Abramovitch', 10000_00, 430],
    ['2023-08-16 12:10', 'Rachel Weinberg', 10200_00, 440],
    ['2023-08-16 12:15', 'Vincent Weisser', 1500_00, 440],
    ['2023-10-02 12:00', 'Ryan Kidd', 20000_00, 470],
    ['2023-10-23 12:00', 'Rachel Weinberg', 3000_00, 480],
    ['2023-12-15 12:00', 'Jaan Tallinn', 455000_00, 590],
    ['2024-06-15 12:00', 'Jaan Tallinn', 343000_00, 770],
    ['2024-08-21 12:00', 'Adam Gleave', 50000_00, 855],
    ['2024-08-21 12:05', 'Andy Martin', 250_00, 855],
    ['2024-08-25 12:00', 'Garrett Baker', 200_00, 870],
    ['2024-09-04 12:00', 'Evan Hubinger', 30000_00, 900],
    ['2024-12-15 12:00', 'Coefficient Giving', 1557000_00, 1180],
    ['2025-01-30 12:00', 'Vincent Weisser', 200_00, 1200],
    ['2025-10-15 12:00', 'Jaan Tallinn', 276000_00, 1500],
  ],
  aisc: [
    ['2019-08-01 12:00', 'Long-Term Future Fund', 95000_00, 430],
    ['2021-05-15 12:00', 'Long-Term Future Fund', 85000_00, 540],
    ['2022-01-15 12:00', 'Jaan Tallinn', 130000_00, 650],
    ['2022-06-01 12:00', 'FTX Future Fund', 290000_00, 790],
    ['2024-02-06 12:00', 'Richard Ngo', 15000_00, 610],
    ['2024-02-06 12:05', 'Alexander Mont', 15000_00, 610],
    ['2024-02-06 12:10', 'Dr Waku', 250_00, 610],
    ['2024-02-06 12:15', 'Adrian Kelly', 200_00, 610],
    ['2024-02-06 12:20', 'Adam Yedidia', 3000_00, 610],
    ['2024-02-06 12:25', 'Judd Rosenblatt', 1040_00, 610],
    ['2024-02-06 12:30', 'Nik Samoylov', 5000_00, 610],
    ['2024-02-06 12:35', 'Isaak Freeman', 2000_00, 610],
    ['2024-02-07 12:00', 'Ravi Parikh', 5000_00, 610],
    ['2024-02-10 12:00', 'rudolf ordoyne', 2000_00, 620],
    ['2024-02-17 12:00', 'rudolf ordoyne', 1000_00, 620],
    ['2024-03-03 12:00', 'Alex Mennen', 4000_00, 635],
    ['2024-09-15 12:00', 'Jaan Tallinn', 30000_00, 685],
    ['2025-01-23 12:00', 'Anton Makiievskyi', 2600_00, 720],
    ['2025-01-30 12:00', 'Vincent Weisser', 200_00, 720],
    ['2025-02-16 12:00', 'Anton Makiievskyi', 20000_00, 755],
    ['2025-02-16 12:05', 'Alexander Mont', 12000_00, 755],
    ['2025-02-16 12:10', 'Robert Gambee', 4000_00, 755],
    ['2025-02-16 12:15', 'Austin Chen', 1000_00, 755],
    ['2025-02-16 12:20', 'Jay Bailey', 1000_00, 755],
    ['2025-02-16 12:25', 'Jason', 500_00, 755],
    ['2025-02-16 12:30', 'Lucius Bushnaq', 500_00, 755],
    ['2025-02-16 12:35', 'Nell Watson', 200_00, 755],
    ['2025-10-15 12:00', 'Jaan Tallinn', 200000_00, 805],
    ['2025-11-02 12:00', 'Lucius Bushnaq', 5000_00, 830],
    ['2026-02-04 12:00', 'Anton Makiievskyi', 40000_00, 900],
  ],
  lightcone: [
    ['2021-01-15 12:00', 'Jaan Tallinn', 2300000_00, 2325],
    ['2021-06-15 12:00', 'Coefficient Giving', 8000000_00, 2575],
    ['2022-04-01 12:00', 'FTX Future Fund', 2000000_00, 3025],
    ['2023-03-01 12:00', 'Vitalik Buterin', 1000000_00, 3500],
    ['2023-04-15 12:00', 'Jed McCaleb', 1000000_00, 3550],
    ['2023-05-01 12:00', 'Scott Alexander', 100000_00, 3625],
    ['2023-05-15 12:00', 'Patrick LaVictoire', 50000_00, 3625],
    ['2023-06-15 12:00', 'Jaan Tallinn', 1733000_00, 3725],
    ['2023-12-15 12:00', 'Jaan Tallinn', 410000_00, 3975],
    ['2024-06-15 12:00', 'Jaan Tallinn', 513500_00, 4200],
    ['2024-08-01 12:00', 'Jaan Tallinn', 1720000_00, 4325],
    ['2024-08-01 12:05', 'Jaan Tallinn', 200000_00, 4325],
    ['2024-11-20 12:00', 'drethelin', 150000_00, 3850],
    ['2024-12-10 12:00', 'So8res', 25000_00, 3900],
    ['2024-12-15 12:00', 'Daniel Kokotajlo (and spouse)', 10000_00, 3900],
    ['2024-12-30 12:00', 'Oliver Habryka', 300000_00, 3975],
    ['2025-01-20 12:00', '~1,000 individual donors (LW/EA fundraiser)', 1615000_00, 4075],
    ['2025-10-15 12:00', 'Jaan Tallinn', 1311000_00, 4900],
  ],
};

const TREASURIES = {
  timaeus: 'Timaeus',
  aisc: 'AI Safety Camp',
  lightcone: 'Lightcone Infrastructure',
};

if (db.prepare('SELECT id FROM users WHERE name = ?').get(TREASURIES.timaeus)) {
  console.error('Already seeded (treasury accounts exist). Aborting.');
  process.exit(1);
}

function getOrCreateUser(name) {
  const row = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (row) return row.id;
  return db.prepare('INSERT INTO users (name) VALUES (?)').run(name).lastInsertRowid;
}

const seed = db.transaction(() => {
  // Remove the smoke-test trade and its orders so the seeded history is clean.
  db.exec('DELETE FROM trades; DELETE FROM orders;');

  for (const [org, rows] of Object.entries(DONATIONS)) {
    const treasuryId = getOrCreateUser(TREASURIES[org]);
    // Chronological order so trade ids ascend with time.
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    for (const [date, donor, amount, price] of rows) {
      const donorId = getOrCreateUser(donor);
      const qty = Math.max(1, Math.round(amount / price));
      const ts = date + ':00';

      const sellId = db
        .prepare(
          `INSERT INTO orders (user_id, org, side, price, qty, remaining, status, created_at)
           VALUES (?, ?, 'sell', ?, ?, 0, 'filled', ?)`
        )
        .run(treasuryId, org, price, qty, ts).lastInsertRowid;
      const buyId = db
        .prepare(
          `INSERT INTO orders (user_id, org, side, price, qty, remaining, status, created_at)
           VALUES (?, ?, 'buy', ?, ?, 0, 'filled', ?)`
        )
        .run(donorId, org, price, qty, ts).lastInsertRowid;
      db.prepare(
        `INSERT INTO trades (org, price, qty, buyer_id, seller_id, buy_order_id, sell_order_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(org, price, qty, donorId, treasuryId, buyId, sellId, ts);

      // Donor holds the shares; treasury banks the proceeds.
      const upd = db
        .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
        .run(qty, donorId, org);
      if (upd.changes === 0) {
        db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(donorId, org, qty);
      }
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(price * qty, treasuryId);
    }
  }
});

seed();

// Fixed share supply per org; the treasury holds whatever donors didn't buy.
const SUPPLY = { aisc: 175000, timaeus: 470000, lightcone: 860000 };
for (const org of Object.keys(SUPPLY)) {
  const tid = db.prepare('SELECT id FROM users WHERE name = ?').get(TREASURIES[org]).id;
  const issued = db
    .prepare('SELECT COALESCE(SUM(shares),0) s FROM holdings WHERE org = ? AND user_id != ?')
    .get(org, tid).s;
  const remainder = SUPPLY[org] - issued;
  const upd = db
    .prepare('UPDATE holdings SET shares = ? WHERE user_id = ? AND org = ?')
    .run(remainder, tid, org);
  if (upd.changes === 0) {
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(tid, org, remainder);
  }
}

for (const org of Object.keys(DONATIONS)) {
  const n = db.prepare('SELECT COUNT(*) c FROM trades WHERE org = ?').get(org).c;
  const last = db.prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1').get(org);
  console.log(`${org}: ${n} trades seeded, last price $${(last.price / 100).toFixed(2)}`);
}
console.log('Done.');
