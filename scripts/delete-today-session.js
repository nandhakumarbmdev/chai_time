// Delete TODAY's session (IST) and all of today's orders, so the next
// GET /api/session/today recreates it and seeds it from each member's previous order.
// IMPORTANT: restart the backend afterwards (it caches today's session in memory).
// Usage:
//   node scripts/delete-today-session.js         # dry run
//   node scripts/delete-today-session.js --yes   # delete
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Session from '../models/Session.js';
import Order from '../models/Order.js';
import Member from '../models/Member.js';
import { todayIST } from '../utils/time.js';

const confirm = process.argv.includes('--yes');

async function run() {
  await connectDB();
  const date = todayIST();
  const session = await Session.findOne({ date });
  if (!session) { console.log(`No session for today (${date}). Nothing to delete.`); return; }

  const orders = await Order.find({ session: session._id }).lean();
  const members = await Member.find({ _id: { $in: orders.map((o) => o.member) } }).select('name').lean();
  const nameById = new Map(members.map((m) => [m._id.toString(), m.name]));

  console.log(`Today's session: ${date} (${orders.length} orders)`);
  for (const o of orders) console.log(`  - ${nameById.get(o.member.toString()) ?? o.member}: ${o.status}`);

  if (!confirm) {
    console.log('\nDry run only. Re-run with --yes to delete the session and these orders.');
    return;
  }
  const res = await Order.deleteMany({ session: session._id });
  await Session.deleteOne({ _id: session._id });
  console.log(`\nDeleted ${res.deletedCount} orders and the session for ${date}.`);
  console.log('Now restart the backend, then open the app to recreate + seed today.');
}

run()
  .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
