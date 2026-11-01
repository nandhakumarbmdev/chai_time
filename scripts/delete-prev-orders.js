// Delete the orders of the most recent PREVIOUS day that had orders (before today, IST).
// Usage:
//   node scripts/delete-prev-orders.js                 # dry run: shows what would be deleted
//   node scripts/delete-prev-orders.js --yes           # actually delete
//   node scripts/delete-prev-orders.js --date 2026-10-30 --yes   # target a specific day instead
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Session from '../models/Session.js';
import Order from '../models/Order.js';
import Member from '../models/Member.js';
import { todayIST } from '../utils/time.js';

const args = process.argv.slice(2);
const confirm = args.includes('--yes');
const dateIdx = args.indexOf('--date');
const targetDate = dateIdx !== -1 ? args[dateIdx + 1] : null;

async function run() {
  await connectDB();
  const today = todayIST();

  let session;
  if (targetDate) {
    if (targetDate >= today) throw new Error(`--date must be before today (${today})`);
    session = await Session.findOne({ date: targetDate });
    if (!session) throw new Error(`No session found for ${targetDate}`);
  } else {
    // Walk back through past sessions to find the latest one that has orders
    const past = await Session.find({ date: { $lt: today } }).sort({ date: -1 }).lean();
    for (const s of past) {
      if (await Order.exists({ session: s._id })) { session = s; break; }
    }
    if (!session) { console.log('No previous day with orders found.'); return; }
  }

  const orders = await Order.find({ session: session._id }).lean();
  const members = await Member.find({ _id: { $in: orders.map((o) => o.member) } }).select('name').lean();
  const nameById = new Map(members.map((m) => [m._id.toString(), m.name]));

  console.log(`Previous order day: ${session.date} (${orders.length} orders)`);
  for (const o of orders) console.log(`  - ${nameById.get(o.member.toString()) ?? o.member}: ${o.status}`);

  if (!confirm) {
    console.log('\nDry run only. Re-run with --yes to delete these orders.');
    return;
  }
  const res = await Order.deleteMany({ session: session._id });
  console.log(`\nDeleted ${res.deletedCount} orders from ${session.date}.`);
}

run()
  .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
