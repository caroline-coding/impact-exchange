// Rebuilds the five orgs' trade history from the "Implied impact valuations
// from funding histories" spreadsheet (1/(t+5) schedule): each org starts
// with 1,000,000 founding shares held by its treasury account, each funded
// round issues 250,000 new shares, and every donation is a purchase of its
// sheet-listed share count from the treasury.
//
// Each trade's price is stored UNROUNDED as amountCents/qty (SQLite keeps
// the REAL despite the column's INTEGER affinity), so price × qty
// reproduces the exact donation amount in the trade history. The cost is a
// little per-trade jitter around the round price — small donations with few
// shares round coarsely (e.g. $100 for 9 shares reads $11.11 against a
// $10.68 round price).
//
// Fuzzy sheet dates ("Fall 2023", "Late 2024") map to representative
// concrete dates; same-day rows are staggered by a minute to keep listed
// order. Donor aliases are normalized to the account names the exchange
// already uses ("FLI" → Future of Life Institute; SFF/BERI/Initiative
// Committee routing rolls up to Jaan Tallinn per the sheet's Donor column).
//
// Wipes and re-creates trades, orders, and holdings for these orgs only
// (open buy orders get their cash escrow refunded first); users, balances,
// and comments are left alone. Safe to re-run.

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

// date|donor|amount|shares — transcribed from the sheet's donation rows.
const RAW = {
  timaeus: `
2023-08-16|Evan Hubinger|$100,000|41,688
2023-08-16|Marcus Abramovitch|$10,000|4,169
2023-08-16|Rachel Weinberg|$10,200|4,252
2023-08-16|Vincent Weisser|$1,500|625
2023-10-02|Ryan Kidd|$20,000|8,338
2023-10-15|Jaan Tallinn|$455,000|189,678
2023-10-23|Rachel Weinberg|$3,000|1,251
2024-08-21|Adam Gleave|$50,000|5,055
2024-08-21|Andy Martin|$250|25
2024-08-25|Garrett Baker|$200|20
2024-08-30|Lun|$10|1
2024-09-04|Evan Hubinger|$30,000|3,033
2024-10-15|Jaan Tallinn|$343,000|34,679
2025-01-17|Coefficient Giving|$2,049,000|207,164
2025-01-30|Vincent Weisser|$200|20
2025-03-03|Romain Deléglise|$20|2
2025-09-17|Jaan Tallinn|$276,000|37,996
2025-11-17|Coefficient Giving|$1,540,000|212,004
2026-07-07|Coefficient Giving|$32,000,000|250,000
`,
  iaps: `
2024-01-10|Coefficient Giving|$3,011,895|187,170
2024-04-22|Coefficient Giving|$828,049|51,458
2024-10-15|Jaan Tallinn|$183,000|11,372
2025-04-13|Coefficient Giving|$11,510,081|238,164
2025-10-15|Jaan Tallinn|$572,000|11,836
`,
  tarbell: `
2022-11-15|EAIF|$593,334|250,000
2023-06-15|Robert and Virginia Shiller Foundation|$25,000|5,919
2023-09-15|Coefficient Giving|$999,000|236,506
2024-02-15|Scott Alexander|$32,000|7,576
2024-06-15|Robert and Virginia Shiller Foundation|$25,000|4,592
2024-11-15|Coefficient Giving|$816,000|149,890
2024-11-20|Jaan Tallinn|$520,000|95,518
2025-02-15|Future of Life Institute|$150,000|9,715
2025-03-15|Coefficient Giving|$2,888,000|187,037
2025-11-15|Jaan Tallinn|$783,000|50,710
2025-12-25|Julia Wise and Jeff Kaufman|$10,543|683
2026-06-18|Nick Saraev|$1,000|65
2026-06-18|Marcus Abramovitch|$7,500|486
2026-06-18|Romain Deléglise|$100|6
2026-06-18|Adrian Kelly|$50|3
2026-06-18|Marius Hobbhahn|$10,000|648
2026-06-18|Ryan Kidd|$10,000|648
`,
  mats: `
2022-04-15|Coefficient Giving|$1,000,000|243,427
2022-10-15|LTFF|$27,000|6,573
2022-11-15|Coefficient Giving|$1,540,000|166,379
2023-06-15|Coefficient Giving|$429,000|46,348
2023-07-15|Jaan Tallinn|$345,000|37,273
2023-11-27|Tristan Hume|$150,000|10,938
2023-11-27|Vincent Weisser|$300|22
2023-11-27|Vincent Weisser|$500|36
2023-12-04|Adrian Kelly|$500|36
2023-12-21|Jalex Stark|$6,000|438
2023-12-30|molsonkiko|$1,210|88
2023-12-30|Evan Hubinger|$17,500|1,276
2023-12-31|Jalex Stark|$14,000|1,021
2023-12-31|Peter Berggren|$134|10
2024-04-28|Evan Hubinger|$80,000|5,834
2024-05-06|Philip Gubbins|$1,040|76
2024-05-11|Jakub Halmeš|$400|29
2024-06-04|The Foresight Institute|$70,000|5,104
2024-06-09|Tanmay Khattar|$1,000|73
2024-06-11|Coefficient Giving|$3,000,000|218,758
2024-07-02|Tanmay Khattar|$2,000|146
2024-08-21|Judd Rosenblatt|$100|7
2024-08-21|Dusan D Nesic|$113|8
2024-08-21|Isaac Dunn|$170|12
2024-08-21|Zach Stein-Perlman|$200|15
2024-08-21|Simon Fischer|$66|5
2024-08-21|Oscar Sykes|$50|4
2024-08-22|Jacob Goldman-Wetzler|$100|7
2024-08-22|Neel Nanda|$50|4
2024-08-22|Tassilo Neubauer|$50|4
2024-08-24|Zach Stein-Perlman|$10|1
2024-08-27|Matthew Cameron Farrugia-Roberts|$20|1
2024-08-28|Cameron Holmes|$50|4
2024-08-28|aNK555|$50|4
2024-08-29|Lun|$10|1
2024-08-30|Michaël Rubens Trazzi|$10|1
2024-09-01|Tanmay Khattar|$2,000|146
2024-09-04|James Faville|$50|4
2024-09-05|Andrew G|$25|2
2024-09-11|Orpheus Lummis|$50|4
2024-09-13|EA Community Choice|$1,500|109
2024-10-10|Tom Burns|$50|4
2024-10-16|Vanguard Charitable|$44,000|3,208
2024-10-25|Aidan|$140|10
2024-11-01|Anthropic|$35,000|2,552
2024-11-15|Coefficient Giving|$382,029|14,466
2024-12-27|Founders Pledge|$584,000|22,114
2024-12-29|Evan Hubinger|$10,000|379
2024-12-30|Coefficient Giving|$660,000|24,992
2025-01-27|Cooperative AI Foundation|$68,294|2,586
2025-01-30|Vincent Weisser|$200|8
2025-02-28|Schwab Charitable|$50,000|1,893
2025-03-21|Derik K|$200|8
2025-05-06|Coefficient Giving|$1,520,150|57,562
2025-05-07|Coefficient Giving|$3,038,300|115,049
2025-06-15|Tanmay Khattar|$12,000|189
2025-07-07|Jaan Tallinn|$289,000|10,943
2025-07-23|Coefficient Giving|$11,823,980|186,080
2025-09-12|Coefficient Giving|$3,629,280|57,116
2025-11-06|Google|$100,000|1,574
2026-02-19|jeff lynne|$200|3
2026-03-15|Alex Lyzhov|$130|2
2026-03-23|OpenAI|$120,000|1,889
2026-04-06|Coefficient Giving|$200,000|3,148
`,
  lightcone: `
2017-09-14|Eric Rogstad|$10,000|26,119
2017-09-29|CEA|$85,714|223,881
2018-02-08|Jaan Tallinn|$100,000|100,000
2018-09-04|Jaan Tallinn|$150,000|150,000
2019-11-15|Jaan Tallinn|$260,000|250,000
2020-06-15|Jaan Tallinn|$400,000|232,558
2020-06-15|Jed McCaleb|$30,000|17,442
2021-06-15|Jaan Tallinn|$1,055,000|136,305
2021-11-15|Casey and Family Foundation|$500,000|64,599
2021-11-15|Jaan Tallinn|$380,000|49,096
2022-02-15|FTX Future Fund|$1,400,000|50,725
2022-09-08|Coefficient Giving|$4,500,000|163,043
2022-11-15|Jaan Tallinn|$1,000,000|36,232
2023-03-01|Vitalik Buterin|$1,000,000|34,468
2023-04-15|Jed McCaleb|$1,000,000|34,468
2023-05-01|Scott Alexander|$100,000|3,447
2023-05-15|Patrick LaVictoire|$50,000|1,723
2023-06-15|Jaan Tallinn|$1,733,000|59,734
2023-10-23|Coefficient Giving|$2,960,000|102,027
2023-12-15|Jaan Tallinn|$410,000|14,132
2024-05-09|Chris Lakin|$500|34
2024-05-09|Andy Martin|$500|34
2024-05-09|Austin Chen|$5,000|335
2024-05-10|Nick Fitz|$25|2
2024-05-27|Jay Schreiber|$5,000|335
2024-06-11|Daniel Filan|$10|1
2024-06-25|Andy Martin|$500|34
2024-07-03|Steven Byrnes|$100|7
2024-07-10|Steven Byrnes|$10|1
2024-08-02|aNK555|$50|3
2024-08-21|Case Sandberg|$50|3
2024-08-21|Isabel Juniewicz|$100|7
2024-08-21|Ross Rheingans-Yoo|$100|7
2024-08-21|Judd Rosenblatt|$142|10
2024-08-21|Pat Scott|$20|1
2024-08-21|Alex Palcuie|$20|1
2024-08-21|julia persson|$300|20
2024-08-21|Michael Dickens|$100|7
2024-08-21|Martin Milbradt|$100|7
2024-08-21|Anton Makiievskyi|$200|13
2024-08-21|Dusan D Nesic|$114|8
2024-08-21|Jacob Goldman-Wetzler|$100|7
2024-08-21|Sapphire Star|$200|13
2024-08-21|Sapphire Star|$400|27
2024-08-21|Adam Scholl|$500|34
2024-08-21|Isaac Dunn|$160|11
2024-08-21|Aleph Coin|$300|20
2024-08-21|Elizabeth Van Nostrand|$100|7
2024-08-21|Daniel Hnyk|$500|34
2024-08-21|Steven Byrnes|$500|34
2024-08-21|Andy Martin|$100|7
2024-08-21|Simon Fischer|$68|5
2024-08-21|Zach Stein-Perlman|$250|17
2024-08-22|Garrett Baker|$50|3
2024-08-22|Neel Nanda|$50|3
2024-08-22|Johannes C. Mayer|$200|13
2024-08-23|Eli Lifland|$600|40
2024-08-23|Alex Veshev|$50|3
2024-08-26|N.C. Young|$50|3
2024-08-26|Lucie Philippon|$100|7
2024-08-27|Tassilo Neubauer|$100|7
2024-08-28|aNK555|$10|1
2024-08-29|Isabel Juniewicz|$200|13
2024-08-30|Michaël Rubens Trazzi|$10|1
2024-09-01|Elizabeth Van Nostrand|$600|40
2024-09-03|Ravi Parikh|$500|34
2024-09-03|Nate Soares|$200|13
2024-09-03|Ben Weinstein-Raun|$300|20
2024-09-03|Ross Nordby|$1,000|67
2024-09-03|Michael Dickens|$100|7
2024-09-03|Max Howald|$500|34
2024-09-03|Rafe Kennedy|$400|27
2024-09-03|Oliver Habryka|$750|50
2024-09-03|Garrett Baker|$95|6
2024-09-04|Mikhail Samin|$50|3
2024-09-04|David Kasten|$100|7
2024-09-04|Joshua David|$10|1
2024-09-04|loops|$40|3
2024-09-04|Mateusz Bagiński|$50|3
2024-09-04|Mateusz Bagiński|$10|1
2024-09-04|DRAKE MORRISON|$100|7
2024-09-04|Girl Lich|$100|7
2024-09-04|Cameron Holmes|$50|3
2024-09-04|Peter Burns|$100|7
2024-09-04|Luke Stebbing|$1,000|67
2024-09-04|Shauna|$100|7
2024-09-05|Andrew G|$50|3
2024-09-05|Aaron Lehmann|$100|7
2024-09-11|Orpheus Lummis|$50|3
2024-09-13|EA Community Choice|$24,600|1,648
2024-09-17|aysja|$200|13
2024-09-18|loops|$90|6
2024-10-05|loops|$25|2
2024-10-20|Jaan Tallinn|$513,500|34,407
2024-10-20|Jaan Tallinn|$1,720,000|115,247
2024-10-20|Jaan Tallinn|$200,000|13,401
2024-11-01|drethelin|$150,000|10,051
2024-11-10|EAIF|$250,000|16,751
2024-11-30|Chin Ze Shen|$20|1
2024-11-30|Andrew G|$58|4
2024-12-01|Orpheus Lummis|$20|1
2024-12-01|Tassilo Neubauer|$500|34
2024-12-01|Small donors|$700,000|46,903
2024-12-03|Jan Görgens|$10|1
2024-12-04|Jay Schreiber|$13,100|878
2024-12-09|Lucie Philippon|$50|3
2024-12-15|Eric Neyman|$5,000|335
2024-12-17|Saul Munn|$1,000|67
2024-12-20|Emmett Shear|$50,000|3,350
2024-12-20|Nate Soares|$25,000|1,675
2024-12-20|Ryan Greenblatt|$33,000|2,211
2024-12-20|Daniel Kokotajlo|$10,000|670
2024-12-29|Evan Hubinger|$10,000|670
2024-12-30|frib|$1,040|70
2025-01-04|Dusan D Nesic|$1,000|94
2025-01-15|Small donors|$1,100,000|103,013
2025-01-30|Vincent Weisser|$100|9
2025-03-03|Romain Deléglise|$20|2
2025-03-11|Josh Sacks|$1,000|94
2025-06-15|Casey and Family Foundation|$100,000|9,365
2025-06-17|Thomas Larsen|$10,000|936
2025-10-15|Jaan Tallinn|$1,311,000|122,773
2025-10-27|Ben Eisenpress|$250|23
2025-11-15|Stephen McAleese|$100|9
2025-12-24|Lauren Mangla|$50,000|4,682
2025-12-26|Marius Hobbhahn|$25,000|2,341
2025-12-31|Alexandra Bates|$50,000|4,682
2026-01-16|Jesse Richardson|$20,000|1,873
2026-04-07|Nick Saraev|$1,000|94
2026-04-08|Romain Deléglise|$100|9
`,
};

// Parse the RAW blocks into [ts, donor, qty, amountCents], staggering
// same-day rows by a minute so listed order survives the chronological sort.
function parseRows(raw) {
  const seen = {};
  return raw
    .trim()
    .split('\n')
    .map((line) => {
      const [date, donor, amount, shares] = line.split('|').map((s) => s.trim());
      const amountCents = Math.round(parseFloat(amount.replace(/[$,]/g, '')) * 100);
      const qty = parseInt(shares.replace(/,/g, ''), 10);
      const n = (seen[date] = (seen[date] ?? -1) + 1);
      const ts = `${date} 12:${String(n).padStart(2, '0')}:00`;
      return [ts, donor, qty, amountCents];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function getOrCreateUser(name) {
  const row = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (row) return row.id;
  return db.prepare('INSERT INTO users (name) VALUES (?)').run(name).lastInsertRowid;
}

const reseed = db.transaction(() => {
  for (const [org, raw] of Object.entries(RAW)) {
    // Open buy orders hold escrowed cash; give it back before wiping.
    for (const o of db
      .prepare("SELECT user_id, price, remaining FROM orders WHERE org = ? AND status = 'open' AND side = 'buy'")
      .all(org)) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(
        Math.round(o.price * o.remaining),
        o.user_id
      );
    }
    db.prepare('DELETE FROM trades WHERE org = ?').run(org);
    db.prepare('DELETE FROM orders WHERE org = ?').run(org);
    db.prepare('DELETE FROM holdings WHERE org = ?').run(org);

    const treasuryId = getOrCreateUser(TREASURIES[org]);
    db.prepare('UPDATE users SET balance = 0 WHERE id = ?').run(treasuryId);

    for (const [ts, donor, qty, amountCents] of parseRows(raw)) {
      const donorId = getOrCreateUser(donor);
      // Exact per-trade price so price × qty reproduces the donation.
      const price = amountCents / qty;
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
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amountCents, treasuryId);
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

for (const org of Object.keys(RAW)) {
  const n = db.prepare('SELECT COUNT(*) c FROM trades WHERE org = ?').get(org).c;
  const last = db.prepare('SELECT price FROM trades WHERE org = ? ORDER BY id DESC LIMIT 1').get(org);
  const outstanding = db.prepare('SELECT SUM(shares) s FROM holdings WHERE org = ?').get(org).s;
  const raised = db.prepare('SELECT SUM(price * qty) v FROM trades WHERE org = ?').get(org).v;
  console.log(
    `${org}: ${n} trades, ${(outstanding - FOUNDING_SHARES).toLocaleString()} shares issued, ` +
      `total raised $${Math.round(raised / 100).toLocaleString()}, ` +
      `last $${(last.price / 100).toFixed(2)}, ` +
      `implied valuation $${((last.price * outstanding) / 100 / 1e6).toFixed(1)}m`
  );
}
console.log('Done.');
