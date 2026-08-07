// One-off migration: rescale all historical trade prices so the latest trade
// lands on the target price per org, keeping each trade's total (price*qty)
// equal to the original donation amount — so quantities rescale inversely.
// Buyer holdings are adjusted by the qty delta; each org account's stake is
// recomputed as the new supply minus issued shares.
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'exchange.db'));

const TARGETS = { aisc: 900, timaeus: 1500, lightcone: 4900 }; // cents
const INC = { aisc: 5, timaeus: 5, lightcone: 25 }; // price rounding increment
const SUPPLY = { aisc: 175000, timaeus: 470000, lightcone: 860000 };
const ORG_ACCOUNTS = {
  aisc: 'AI Safety Camp',
  timaeus: 'Timaeus',
  lightcone: 'Lightcone Infrastructure',
};

const adjustHoldings = (userId, org, delta) => {
  const upd = db
    .prepare('UPDATE holdings SET shares = shares + ? WHERE user_id = ? AND org = ?')
    .run(delta, userId, org);
  if (upd.changes === 0) {
    db.prepare('INSERT INTO holdings (user_id, org, shares) VALUES (?, ?, ?)').run(userId, org, delta);
  }
};

const tx = db.transaction(() => {
  for (const org of Object.keys(TARGETS)) {
    const orgAccountId = db.prepare('SELECT id FROM users WHERE name = ?').get(ORG_ACCOUNTS[org]).id;
    const trades = db.prepare('SELECT * FROM trades WHERE org = ? ORDER BY id').all(org);
    const lastId = trades[trades.length - 1].id;
    const factor = TARGETS[org] / trades[trades.length - 1].price;

    for (const t of trades) {
      let newPrice = Math.round((t.price * factor) / INC[org]) * INC[org];
      if (t.id === lastId) newPrice = TARGETS[org];
      const amount = t.price * t.qty;
      const newQty = Math.max(1, Math.round(amount / newPrice));

      adjustHoldings(t.buyer_id, org, newQty - t.qty);
      // Seller (the org account) banks the slightly different proceeds.
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(
        newPrice * newQty - amount,
        t.seller_id
      );
      db.prepare('UPDATE trades SET price = ?, qty = ? WHERE id = ?').run(newPrice, newQty, t.id);
      db.prepare('UPDATE orders SET price = ?, qty = ? WHERE id IN (?, ?)').run(
        newPrice,
        newQty,
        t.buy_order_id,
        t.sell_order_id
      );
    }

    const issued = db
      .prepare('SELECT COALESCE(SUM(shares),0) s FROM holdings WHERE org = ? AND user_id != ?')
      .get(org, orgAccountId).s;
    const remainder = SUPPLY[org] - issued;
    if (remainder < 0) throw new Error(`${org}: issued ${issued} exceeds supply ${SUPPLY[org]}`);
    db.prepare('UPDATE holdings SET shares = ? WHERE user_id = ? AND org = ?').run(
      remainder,
      orgAccountId,
      org
    );
    console.log(
      `${org}: last price $${(TARGETS[org] / 100).toFixed(2)}, issued ${issued.toLocaleString()}, org account holds ${remainder.toLocaleString()} of ${SUPPLY[org].toLocaleString()}`
    );
  }
});

tx();
console.log('Done.');
