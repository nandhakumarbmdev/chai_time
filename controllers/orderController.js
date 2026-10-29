import { z } from 'zod';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Session from '../models/Session.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';
import { yesterdayIST, isPastCutoff } from '../utils/time.js';
import { getOrCreateTodaySession } from '../utils/session.js';

const objectId = z.string().min(1).refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

const orderSchema = z.object({
  memberId: objectId,
  menuItemId: objectId,
  sugarLevel: z.enum(['none', 'less', 'normal', 'extra']).optional().default('normal'),
  note: z.string().max(100).optional().default(''),
});

const skipSchema = z.object({
  memberId: objectId,
});

/** Resolve today's session and reject if the ordering deadline has passed */
async function requireOpenSession() {
  const session = await getOrCreateTodaySession();
  if (isPastCutoff(session)) throw httpError('Ordering closed at 7:00 PM', 403);
  return session;
}

/** Upsert one order per (session, member); a concurrent first write can hit the unique index, so retry once */
async function upsertOrder(filter, update) {
  const run = () =>
    Order.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  try {
    return await run();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return run();
  }
}

/** POST /api/orders — place or update an order (until the cutoff) */
export const placeOrder = asyncHandler(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(parsed.error.issues[0].message, 400);

  const { memberId, menuItemId, sugarLevel, note } = parsed.data;

  // Session, member and menu item lookups are independent
  const [session, member, menuItem] = await Promise.all([
    requireOpenSession(),
    Member.findById(memberId).select('name').lean(),
    MenuItem.findById(menuItemId).select('name emoji').lean(),
  ]);
  if (!member) throw httpError('Member not found', 404);
  if (!menuItem) throw httpError('Menu item not found', 404);

  const saved = await upsertOrder(
    { session: session._id, member: memberId },
    { status: 'ordered', menuItem: menuItemId, sugarLevel: sugarLevel || 'normal', note }
  );
  // Already loaded above, so no populate round trips
  const order = { ...saved, menuItem, member };

  // Broadcast via Socket.IO
  req.app.get('io').emit('order:update', { type: 'ordered', order });

  res.json({ success: true, order });
});

/** POST /api/orders/skip — mark skipping today (until the cutoff) */
export const skipOrder = asyncHandler(async (req, res) => {
  const parsed = skipSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(parsed.error.issues[0].message, 400);

  const { memberId } = parsed.data;
  const [session, member] = await Promise.all([
    requireOpenSession(),
    Member.findById(memberId).select('name').lean(),
  ]);
  if (!member) throw httpError('Member not found', 404);

  const saved = await upsertOrder(
    { session: session._id, member: memberId },
    { status: 'skipped', menuItem: null, sugarLevel: 'normal', note: '' }
  );
  const order = { ...saved, member };

  req.app.get('io').emit('order:update', { type: 'skipped', order });

  res.json({ success: true, order });
});

/** DELETE /api/orders/my-order — cancel order (back to pending, until the cutoff) */
export const cancelOrder = asyncHandler(async (req, res) => {
  const memberId = req.query.memberId;
  if (!memberId) throw httpError('memberId query param required', 400);
  if (!mongoose.isValidObjectId(memberId)) throw httpError('Invalid id', 400);

  const session = await requireOpenSession();

  const deleted = await Order.findOneAndDelete({ session: session._id, member: memberId });
  if (!deleted) throw httpError('No order found to cancel', 404);

  req.app.get('io').emit('order:update', { type: 'cancelled', memberId });

  res.json({ success: true });
});

/** GET /api/orders/yesterday?memberId=... — prefill "same as yesterday" */
export const getYesterday = asyncHandler(async (req, res) => {
  const { memberId } = req.query;
  if (!memberId) throw httpError('memberId query param required', 400);

  const yesterday = yesterdayIST();
  const session = await Session.findOne({ date: yesterday });
  if (!session) return res.json({ success: true, order: null });

  const order = await Order.findOne({ session: session._id, member: memberId })
    .populate('menuItem', 'name emoji _id');

  res.json({ success: true, order: order || null });
});
