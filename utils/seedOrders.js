import Order from '../models/Order.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';
import Session from '../models/Session.js';

/**
 * Copy each active member's most recent 'ordered' order (from any earlier session)
 * into the given session, so members only act when they want to change something.
 * Skipped days are ignored. Idempotent via the unique {session, member} index.
 */
export async function seedOrdersFromPrevious(session) {
  const [members, items] = await Promise.all([
    Member.find({ active: true }).select('_id').lean(),
    MenuItem.find({ isAvailable: true }).select('_id').lean(),
  ]);
  if (!members.length || !items.length) return 0;

  const availableItems = new Set(items.map((i) => i._id.toString()));
  const activeMembers = members.map((m) => m._id);

  const latest = await Order.aggregate([
    { $match: { status: 'ordered', menuItem: { $ne: null }, member: { $in: activeMembers }, session: { $ne: session._id } } },
    { $lookup: { from: Session.collection.name, localField: 'session', foreignField: '_id', as: 's' } },
    { $unwind: '$s' },
    { $match: { 's.date': { $lt: session.date } } },
    { $sort: { 's.date': -1 } },
    { $group: { _id: '$member', menuItem: { $first: '$menuItem' }, sugarLevel: { $first: '$sugarLevel' }, note: { $first: '$note' } } },
  ]);

  const docs = latest
    .filter((o) => availableItems.has(o.menuItem.toString()))
    .map((o) => ({
      session: session._id,
      member: o._id,
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
