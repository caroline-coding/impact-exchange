// Usage: node merge-users.js "Old Name" "New Name"
// Moves the old account's balance, holdings, orders, and trades onto the new
// account (creating it if needed) and deletes the old one.
const Database = require('better-sqlite3');
const path = require('path');

const [oldName, newName] = process.argv.slice(2);
if (!oldName || !newName) {
  console.error('Usage: node merge-users.js "Old Name" "New Name"');
  process.exit(1);
}

const db = new Database(path.join(__dirname, 'exchange.db'));

const merge = db.transaction(() => {
  const oldU = db.prepare('SELECT * FROM users WHERE name = ?').get(oldName);
  if (!oldU) throw new Error(`No user named "${oldName}"`);
  let newU = db.prepare('SELECT * FROM users WHERE name = ?').get(newName);
  if (!newU) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(newName, oldU.id);
    console.log(`renamed: ${oldName} -> ${newName}`);
    return;
  }
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(oldU.balance, newU.id);
  for (const h of db.prepare('SELECT * FROM holdings WHERE user_id = ?').all(oldU.id)) {
    const upd = db
      .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
      .run(h.shares, newU.id, h.org);
    if (upd.changes === 0) {
      db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(newU.id, h.org, h.shares);
    }
  }
  db.prepare('DELETE FROM holdings WHERE user_id = ?').run(oldU.id);
  db.prepare('UPDATE orders SET user_id = ? WHERE user_id = ?').run(newU.id, oldU.id);
  db.prepare('UPDATE trades SET buyer_id = ? WHERE buyer_id = ?').run(newU.id, oldU.id);
  db.prepare('UPDATE trades SET seller_id = ? WHERE seller_id = ?').run(newU.id, oldU.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(oldU.id);
  console.log(`merged: ${oldName} -> ${newName}`);
});

merge();
