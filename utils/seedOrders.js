import Order from '../models/Order.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';
import Session from '../models/Session.js';

/** "YYYY-MM-DD" falls on Saturday or Sunday (parsed as UTC so the host timezone doesn't matter) */
const isWeekend = (date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/**
 * Copy each active member's 'ordered' order from the most recent previous weekday session only
 * into the given session, so members only act when they want to change something.
 * Members who didn't order in that session (pending/skipped/cleared) get nothing.
 * Idempotent via the unique {session, member} index.
 */
export async function seedOrdersFromPrevious(session) {
  const [members, items] = await Promise.all([
    Member.find({ active: true }).select('_id').lean(),
    MenuItem.find({ isAvailable: true }).select('_id').lean(),
  ]);
  if (!members.length || !items.length) return 0;

  const availableItems = new Set(items.map((i) => i._id.toString()));
  const activeMembers = members.map((m) => m._id);

  // Previous working day: weekend sessions are ignored, so Monday copies Friday's orders
  const recent = await Session.find({ date: { $lt: session.date } }).sort({ date: -1 }).limit(10).select('_id date').lean();
  const prev = recent.find((s) => !isWeekend(s.date));
  if (!prev) return 0;

  const latest = await Order.find({
    session: prev._id,
    status: 'ordered',
    menuItem: { $ne: null },
    member: { $in: activeMembers },
  })
    .select('member menuItem sugarLevel note')
    .lean();

  const docs = latest
    .filter((o) => availableItems.has(o.menuItem.toString()))
    .map((o) => ({
      session: session._id,
      member: o.member,
      status: 'ordered',
      menuItem: o.menuItem,
      sugarLevel: o.sugarLevel,
      note: o.note,
    }));
  if (!docs.length) return 0;

  try {
    await Order.insertMany(docs, { ordered: false });
  } catch (err) {
    // Duplicates (someone already ordered) are fine; anything else is not
    const dupOnly = err?.writeErrors ? err.writeErrors.every((e) => e.err?.code === 11000) : err?.code === 11000;
    if (!dupOnly) throw err;
  }
  return docs.length;
}
