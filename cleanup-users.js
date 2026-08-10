// Deletes users with no footprint: no trades (either side), no orders, no
// held shares, no comments, and a zero balance — plus the named smoke-test
// accounts regardless of balance. These accumulate when reseeds rename
// donors (e.g. "Daniel Kokotajlo (and spouse)" → "Daniel Kokotajlo").
// Safe to re-run.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));
db.pragma('foreign_keys = ON');

const DELETE_REGARDLESS_OF_BALANCE = ['alice', 'bob'];

const orphans = db
  .prepare(
    `SELECT id, name, balance FROM users WHERE id NOT IN (
       SELECT buyer_id FROM trades
       UNION SELECT seller_id FROM trades
       UNION SELECT user_id FROM orders
       UNION SELECT user_id FROM holdings WHERE shares > 0
       UNION SELECT user_id FROM comments
     )`
  )
  .all()
  .filter((u) => u.balance === 0 || DELETE_REGARDLESS_OF_BALANCE.includes(u.name));

const del = db.prepare('DELETE FROM users WHERE id = ?');
for (const u of orphans) {
  del.run(u.id);
  console.log(`deleted: ${u.name}${u.balance ? ` (balance $${(u.balance / 100).toFixed(2)})` : ''}`);
}
console.log(`${orphans.length} users deleted.`);
