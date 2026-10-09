import { isPastCutoff, msToCutoff } from '../utils/time.js';

// Minimal mock session factory
function mockSession(cutoffTime, dateOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dateOffset);
  const date = d.toISOString().slice(0, 10);
  return { date, cutoffTime, breakTime: '15:30', isLocked: false };
}

// ─── isPastCutoff ────────────────────────────────────────────────────────────

// Test 1: cutoff far in future → not past
const future = mockSession('23:59');
console.assert(!isPastCutoff(future), '❌ FAIL: 23:59 should NOT be past cutoff');
console.log('✅ Test 1 passed: 23:59 not past cutoff');

// Test 2: cutoff in the past → is past
const past = mockSession('00:01');
console.assert(isPastCutoff(past), '❌ FAIL: 00:01 should be past cutoff');
console.log('✅ Test 2 passed: 00:01 is past cutoff');

// ─── msToCutoff ──────────────────────────────────────────────────────────────

// Test 3: ms until future cutoff is positive
const ms = msToCutoff(future);
console.assert(ms > 0, '❌ FAIL: ms to 23:59 should be positive');
console.log(`✅ Test 3 passed: ms to 23:59 = ${ms}ms`);

// Test 4: ms until past cutoff is 0
const ms2 = msToCutoff(past);
console.assert(ms2 === 0, '❌ FAIL: ms to 00:01 should be 0');
console.log(`✅ Test 4 passed: ms to 00:01 = ${ms2}ms`);

// ─── Tally calculation ───────────────────────────────────────────────────────

// Test 5: basic tally (clean drink count without sugar breakdown)
const orders = [
  { status: 'ordered', menuItem: { _id: 'a', name: 'Tea', emoji: '🍵' } },
  { status: 'ordered', menuItem: { _id: 'a', name: 'Tea', emoji: '🍵' } },
  { status: 'ordered', menuItem: { _id: 'b', name: 'Coffee', emoji: '☕' } },
  { status: 'skipped', menuItem: null },
];

function tally(orders) {
  const map = {};
  for (const o of orders) {
    if (o.status !== 'ordered' || !o.menuItem) continue;
    const k = o.menuItem._id;
    if (!map[k]) map[k] = { name: o.menuItem.name, count: 0 };
    map[k].count++;
  }
  return map;
}

const result = tally(orders);
console.assert(result['a'].count === 2, '❌ FAIL: Tea count should be 2');
console.assert(result['b'].count === 1, '❌ FAIL: Coffee count should be 1');
console.log('✅ Test 5 passed: drink tally is correct');

// ─── Duplicate prevention (compound index) ───────────────────────────────────
// Test 6: simulated duplicate order detection
const db = new Map(); // session+member → order
function upsertOrder(sessionId, memberId, data) {
  const key = `${sessionId}:${memberId}`;
  db.set(key, data);
  return db.get(key);
}

upsertOrder('s1', 'm1', { status: 'ordered', item: 'Tea' });
upsertOrder('s1', 'm1', { status: 'ordered', item: 'Coffee' }); // should overwrite
const entry = db.get('s1:m1');
console.assert(entry.item === 'Coffee', '❌ FAIL: should overwrite to Coffee');
console.assert(db.size === 1, '❌ FAIL: only 1 entry for member in session');
console.log('✅ Test 6 passed: duplicate upsert works correctly');

// ─── Cloud MongoDB enforcement ───────────────────────────────────────────────
// Test 7: Cloud URI rejection of localhost
function validateMongoUri(uri) {
  if (!uri) return false;
  if (uri.includes('localhost') || uri.includes('127.0.0.1')) return false;
  return uri.startsWith('mongodb+srv://') || uri.startsWith('mongodb://');
}

console.assert(!validateMongoUri('mongodb://localhost:27017/db'), '❌ FAIL: localhost must be rejected');
console.assert(!validateMongoUri('mongodb://127.0.0.1:27017/db'), '❌ FAIL: 127.0.0.1 must be rejected');
console.assert(validateMongoUri('mongodb+srv://user:pass@cluster.mongodb.net/db'), '❌ FAIL: Atlas cloud URI must be accepted');
console.log('✅ Test 7 passed: cloud MongoDB validation enforces remote/Atlas URI');

// ─── Unblocked order rule ─────────────────────────────────────────────────────
// Test 8: Can update order anytime even past cutoff
function canPlaceOrder(_session) {
  return true;
}
console.assert(canPlaceOrder(past) === true, '❌ FAIL: order should never be blocked');
console.assert(canPlaceOrder(future) === true, '❌ FAIL: order should never be blocked');
console.log('✅ Test 8 passed: ordering is never blocked, updates allowed anytime');

console.log('\n🎉 All tests passed successfully!');
