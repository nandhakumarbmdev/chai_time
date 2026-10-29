import Session from '../models/Session.js';
import Order from '../models/Order.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';
import { todayIST, isPastCutoff, msToCutoff } from '../utils/time.js';
import { getOrCreateTodaySession } from '../utils/session.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** GET /api/session/today — get or create today's session */
export const getToday = asyncHandler(async (req, res) => {
  const session = await getOrCreateTodaySession();

  const pastCutoff = isPastCutoff(session);
  const msLeft = msToCutoff(session);

  res.json({
    success: true,
    session: {
      _id: session._id,
      date: session.date,
      cutoffTime: session.cutoffTime,
      breakTime: session.breakTime,
      isLocked: pastCutoff,
      pastCutoff,
      msUntilCutoff: msLeft,
    },
  });
});

/** GET /api/session/tally — member statuses + drink counts */
export const getTally = asyncHandler(async (req, res) => {
  const session = await getOrCreateTodaySession();

  // Members and the (tiny) menu are resolved in memory instead of populate round trips
  const [allMembers, orders, menuItems] = await Promise.all([
    Member.find({}).select('name active').lean(),
    Order.find({ session: session._id }).lean(),
    MenuItem.find({}).select('name emoji').lean(),
  ]);

  const members = allMembers
    .filter((m) => m.active)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const memberIds = new Set(allMembers.map((m) => m._id.toString()));
  const menuById = new Map(menuItems.map((i) => [i._id.toString(), i]));

  // Skip orders whose member no longer exists
  const liveOrders = orders
    .filter((o) => memberIds.has(o.member.toString()))
    .map((o) => ({ ...o, menuItem: o.menuItem ? menuById.get(o.menuItem.toString()) ?? null : null }));
  const orderMap = new Map(liveOrders.map((o) => [o.member.toString(), o]));

  const memberList = members.map((m) => {
    const order = orderMap.get(m._id.toString());
    return {
      _id: m._id,
      name: m.name,
      status: order ? order.status : 'pending',
      order: order
        ? {
            menuItem: order.menuItem,
            note: order.note,
          }
        : null,
    };
  });

  // Tally drinks
  const drinkMap = {};
  for (const o of liveOrders) {
    if (o.status !== 'ordered' || !o.menuItem) continue;
    const key = o.menuItem._id.toString();
    if (!drinkMap[key]) {
      drinkMap[key] = {
        menuItem: { _id: o.menuItem._id, name: o.menuItem.name, emoji: o.menuItem.emoji },
        total: 0,
      };
    }
    drinkMap[key].total += 1;
  }

  const counts = {
    total: members.length,
    ordered: memberList.filter((m) => m.status === 'ordered').length,
    skipping: memberList.filter((m) => m.status === 'skipped').length,
    pending: memberList.filter((m) => m.status === 'pending').length,
  };

  res.json({
    success: true,
    members: memberList,
    drinks: Object.values(drinkMap),
    counts,
    sessionId: session._id,
  });
});

/** GET /api/session/history?days=30 — past sessions, newest first, with drink totals and per-person orders */
export const getHistory = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const today = todayIST();

  // Today's session joins history once its ordering deadline has passed
  const todaySession = await Session.findOne({ date: today });
  const includeToday = todaySession ? isPastCutoff(todaySession) : false;

  const sessions = await Session.find({ date: includeToday ? { $lte: today } : { $lt: today } })
    .sort({ date: -1 })
    .limit(days);

  const orders = await Order.find({ session: { $in: sessions.map((s) => s._id) } })
    .populate('member', 'name')
    .populate('menuItem', 'name');

  const bySession = new Map();
  for (const o of orders) {
    if (!o.member) continue; // member since deleted
    const key = o.session.toString();
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(o);
  }

  const history = sessions
    .map((s) => {
      const list = bySession.get(s._id.toString()) || [];
      const drinkMap = {};
      for (const o of list) {
        if (o.status !== 'ordered' || !o.menuItem) continue;
        const key = o.menuItem._id.toString();
        drinkMap[key] ??= { name: o.menuItem.name, total: 0 };
        drinkMap[key].total += 1;
      }
      return {
        date: s.date,
        ordered: list.filter((o) => o.status === 'ordered').length,
        skipped: list.filter((o) => o.status === 'skipped').length,
        drinks: Object.values(drinkMap).sort((a, b) => b.total - a.total),
        people: list
          .map((o) => ({
            name: o.member.name,
            status: o.status,
            drink: o.status === 'ordered' ? o.menuItem?.name ?? null : null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((d) => d.ordered + d.skipped > 0);

  res.json({ success: true, history });
});
