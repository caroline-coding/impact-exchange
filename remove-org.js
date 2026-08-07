// Usage: node remove-org.js <orgId> "<Org Account Name>"
// Removes a market: its trades, orders, and holdings, the org's own account,
// and any accounts left with nothing (no holdings/orders/trades, zero cash).
const Database = require('better-sqlite3');
const path = require('path');

const [orgId, orgAccountName] = process.argv.slice(2);
if (!orgId || !orgAccountName) {
  console.error('Usage: node remove-org.js <orgId> "<Org Account Name>"');
  process.exit(1);
}

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'exchange.db'));

const tx = db.transaction(() => {
  console.log('trades removed:', db.prepare('DELETE FROM trades WHERE org = ?').run(orgId).changes);
  console.log('orders removed:', db.prepare('DELETE FROM orders WHERE org = ?').run(orgId).changes);
  console.log('holdings removed:', db.prepare('DELETE FROM holdings WHERE org = ?').run(orgId).changes);

  const orgAccount = db.prepare('SELECT id FROM users WHERE name = ?').get(orgAccountName);
  if (orgAccount) {
    db.prepare('DELETE FROM holdings WHERE user_id = ?').run(orgAccount.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(orgAccount.id);
    console.log('org account removed:', orgAccountName);
  }

  const orphans = db
    .prepare(
      `DELETE FROM users WHERE balance = 0
       AND id NOT IN (SELECT user_id FROM holdings)
       AND id NOT IN (SELECT user_id FROM orders)
       AND id NOT IN (SELECT buyer_id FROM trades)
       AND id NOT IN (SELECT seller_id FROM trades)`
    )
    .run().changes;
  console.log('empty accounts removed:', orphans);
});
tx();
console.log('Done.');
