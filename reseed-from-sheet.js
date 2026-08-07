// Rebuilds the five orgs' trade history from the "Implied impact valuations
// from funding histories" spreadsheet (1/(t+5) schedule): each org starts
// with 1,000,000 founding shares held by its treasury account, each funded
// round issues 250,000 new shares, and every donation is modeled as the donor
// buying its sheet-listed share count from the treasury at the round price.
//
// Prices are the sheet's per-share round prices rounded to integer cents.
// Fuzzy dates ("Fall 2023", "Q4 2024") map to representative concrete dates.
// Donor aliases are normalized ("Open Philanthropy (allocated…)" and
// "Jaan Tallinn via SFF" roll up to Coefficient Giving / Jaan Tallinn) to
// match the account names the exchange already uses.
//
// Wipes and re-creates trades, orders, and holdings for these orgs only
// (open buy orders get their cash escrow refunded first); other tables and
// other users' cash balances are left alone. Safe to re-run.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const FOUNDING_SHARES = 1_000_000;

const TREASURIES = {
  mats: 'MATS',
  timaeus: 'Timaeus',
  lightcone: 'Lightcone Infrastructure',
  iaps: 'Institute for AI Policy and Strategy',
  tarbell: 'Tarbell',
};

// [timestamp, donor, sharesPurchased, roundPriceCents]
const DONATIONS = {
  timaeus: [
    ['2023-08-16 12:00', 'Evan Hubinger', 41688, 240],
    ['2023-08-16 12:05', 'Marcus Abramovitch', 4169, 240],
    ['2023-08-16 12:10', 'Rachel Weinberg', 4252, 240],
    ['2023-08-16 12:15', 'Vincent Weisser', 625, 240],
    ['2023-10-02 12:00', 'Ryan Kidd', 8338, 240],
    ['2023-10-15 12:00', 'Jaan Tallinn', 189678, 240], // Fall 2023
    ['2023-10-23 12:00', 'Rachel Weinberg', 1251, 240],
    ['2024-08-21 12:00', 'Adam Gleave', 5055, 989],
    ['2024-08-21 12:05', 'Andy Martin', 25, 989],
    ['2024-08-25 12:00', 'Garrett Baker', 20, 989],
    ['2024-08-30 12:00', 'Lun', 1, 989],
    ['2024-09-04 12:00', 'Evan Hubinger', 3033, 989],
    ['2024-10-15 12:00', 'Jaan Tallinn', 34679, 989], // Fall 2024
    ['2025-01-17 12:00', 'Coefficient Giving', 207164, 989],
    ['2025-01-30 12:00', 'Vincent Weisser', 20, 989],
    ['2025-03-03 12:00', 'Romain Deléglise', 2, 989],
    ['2025-09-17 12:00', 'Jaan Tallinn', 37996, 726],
    ['2025-11-17 12:00', 'Coefficient Giving', 212004, 726],
    ['2026-07-07 12:00', 'Coefficient Giving', 250000, 12800],
  ],
  iaps: [
    ['2024-01-10 12:00', 'Coefficient Giving', 187170, 1609],
    ['2024-04-22 12:00', 'Coefficient Giving', 51458, 1609],
    ['2024-10-15 12:00', 'Jaan Tallinn', 11372, 1609], // Fall 2024
    ['2025-04-13 12:00', 'Coefficient Giving', 238164, 4833],
    ['2025-10-15 12:00', 'Jaan Tallinn', 11836, 4833], // Fall 2025
  ],
  tarbell: [
    ['2022-11-15 12:00', 'EAIF', 148482, 400], // Q4 2022, priced in the 2023 round
    ['2023-09-15 12:00', 'Coefficient Giving', 250000, 400],
    ['2024-11-15 12:00', 'Coefficient Giving', 152695, 534],
    ['2024-11-15 12:05', 'Jaan Tallinn', 97305, 534], // Q4 2024
    ['2025-03-15 12:00', 'Coefficient Giving', 196677, 1468],
    ['2025-11-15 12:00', 'Jaan Tallinn', 53323, 1468], // Q4 2025
  ],
  mats: [
    ['2022-04-15 12:00', 'Coefficient Giving', 243427, 411],
    ['2022-10-15 12:00', 'LTFF', 6573, 411],
    ['2022-11-15 12:00', 'Coefficient Giving', 166379, 926], // 2023 round
    ['2023-06-15 12:00', 'Coefficient Giving', 46348, 926],
    ['2023-07-15 12:00', 'Jaan Tallinn', 37273, 926],
    ['2024-01-29 12:00', 'BERI', 40, 2513],
    ['2024-02-02 12:00', 'BERI', 19854, 2513],
    ['2024-05-10 12:00', 'BERI', 19894, 2513],
    ['2024-06-03 12:00', 'BERI', 19894, 2513],
    ['2024-06-04 12:00', 'The Foresight Institute', 2785, 2513],
    ['2024-06-11 12:00', 'Coefficient Giving', 119362, 2513],
    ['2024-10-16 12:00', 'Vanguard Charitable', 1751, 2513],
    ['2024-11-01 12:00', 'Anthropic', 1393, 2513], // Late 2024, API credits
    ['2024-11-15 12:00', 'Coefficient Giving', 15200, 2513],
    ['2024-11-29 12:00', 'Manifund', 333, 2513],
    ['2024-12-27 12:00', 'Founders Pledge', 23236, 2513],
    ['2024-12-30 12:00', 'Coefficient Giving', 26260, 2513],
    ['2025-01-21 12:00', 'Manifund', 118, 8445],
    ['2025-01-27 12:00', 'Cooperative AI Foundation', 809, 8445],
    ['2025-02-28 12:00', 'Schwab Charitable', 592, 8445],
    ['2025-03-05 12:00', 'BERI', 5329, 8445],
    ['2025-05-02 12:00', 'Manifund', 5, 8445],
    ['2025-05-06 12:00', 'Coefficient Giving', 18002, 8445],
    ['2025-05-07 12:00', 'Coefficient Giving', 35979, 8445],
    ['2025-06-15 12:00', 'Tanmay Khattar', 142, 8445],
    ['2025-07-07 12:00', 'Jaan Tallinn', 3422, 8445],
    ['2025-07-23 12:00', 'Coefficient Giving', 140019, 8445],
    ['2025-09-12 12:00', 'Coefficient Giving', 42978, 8445],
    ['2025-11-06 12:00', 'Google', 1184, 8445], // compute
    ['2026-03-23 12:00', 'OpenAI', 1421, 8445], // ChatGPT access, 2025 round
    ['2026-04-06 12:00', 'Coefficient Giving', 2368, 8445], // 2025 round
  ],
  lightcone: [
    ['2019-06-15 12:00', 'Coefficient Giving', 200000, 600],
    ['2019-06-15 12:05', 'Jaan Tallinn', 50000, 600],
    ['2020-06-15 12:00', 'Coefficient Giving', 200000, 800],
    ['2020-06-15 12:05', 'Jaan Tallinn', 50000, 800],
    ['2021-06-15 12:00', 'Coefficient Giving', 200000, 1200],
    ['2021-06-15 12:05', 'Jaan Tallinn', 50000, 1200],
    ['2022-06-15 12:00', 'Coefficient Giving', 120690, 2320],
    ['2022-06-15 12:05', 'Jaan Tallinn', 43103, 2320],
    ['2022-06-15 12:10', 'FTX Future Fund', 86207, 2320],
    ['2023-03-01 12:00', 'Vitalik Buterin', 58234, 1717],
    ['2023-04-15 12:00', 'Jed McCaleb', 58234, 1717],
    ['2023-05-01 12:00', 'Scott Alexander', 5823, 1717],
    ['2023-05-15 12:00', 'Patrick LaVictoire', 2912, 1717],
    ['2023-06-15 12:00', 'Jaan Tallinn', 100920, 1717], // SFF 2023-H1
    ['2023-12-15 12:00', 'Jaan Tallinn', 23876, 1717], // SFF 2023-H2
    ['2024-06-15 12:00', 'Jaan Tallinn', 37389, 1373], // SFF-2024
    ['2024-08-01 12:00', 'Jaan Tallinn', 125237, 1373], // Initiative Committee, general
    ['2024-08-01 12:05', 'Jaan Tallinn', 14562, 1373], // Initiative Committee, flexHEG
    ['2024-12-01 12:00', '~1,000 individual donors (LW/EA fundraiser)', 72812, 1373],
    ['2025-01-20 12:00', '~1,000 individual donors (LW/EA fundraiser)', 156161, 704],
    ['2025-10-15 12:00', 'Jaan Tallinn', 93839, 704], // SFF-2025, confirmed portion
  ],
};

function getOrCreateUser(name) {
  const row = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (row) return row.id;
  return db.prepare('INSERT INTO users (name) VALUES (?)').run(name).lastInsertRowid;
}

const reseed = db.transaction(() => {
  for (const [org, rows] of Object.entries(DONATIONS)) {
    // Open buy orders hold escrowed cash; give it back before wiping.
    for (const o of db
      .prepare("SELECT user_id, price, remaining FROM orders WHERE org = ? AND status = 'open' AND side = 'buy'")
      .all(org)) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(o.price * o.remaining, o.user_id);
    }
    db.prepare('DELETE FROM trades WHERE org = ?').run(org);
    db.prepare('DELETE FROM orders WHERE org = ?').run(org);
    db.prepare('DELETE FROM holdings WHERE org = ?').run(org);

    const treasuryId = getOrCreateUser(TREASURIES[org]);
    db.prepare('UPDATE users SET balance = 0 WHERE id = ?').run(treasuryId);
    rows.sort((a, b) => a[0].localeCompare(b[0]));

    for (const [date, donor, qty, price] of rows) {
      const donorId = getOrCreateUser(donor);
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

      const upd = db
        .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
        .run(qty, donorId, org);
      if (upd.changes === 0) {
        db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(donorId, org, qty);
      }
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(price * qty, treasuryId);
    }

    // The org retains its founding shares; rounds issued the rest.
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(
      treasuryId,
      org,
      FOUNDING_SHARES
    );
  }
});

reseed();

for (const org of Object.keys(DONATIONS)) {
  const n = db.prepare('SELECT COUNT(*) c FROM trades WHERE org = ?').get(org).c;
  const last = db.prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1').get(org);
  const outstanding = db.prepare('SELECT SUM(shares) s FROM holdings WHERE org = ?').get(org).s;
  const val = (last.price * outstanding) / 100;
  console.log(
    `${org}: ${n} trades, last $${(last.price / 100).toFixed(2)}, ` +
      `${outstanding.toLocaleString()} shares outstanding, implied valuation $${(val / 1e6).toFixed(1)}m`
  );
}
console.log('Done.');
