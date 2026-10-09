import { z } from 'zod';
import Order from '../models/Order.js';
import Session from '../models/Session.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';
import { todayIST, yesterdayIST } from '../utils/time.js';

const orderSchema = z.object({
  memberId: z.string().min(1),
  menuItemId: z.string().min(1),
  sugarLevel: z.enum(['none', 'less', 'normal', 'extra']).optional().default('normal'),
  note: z.string().max(100).optional().default(''),
});

const skipSchema = z.object({
  memberId: z.string().min(1),
});

/** Resolve today's session, create if not exists */
async function requireSession() {
  const date = todayIST();
  let session = await Session.findOne({ date });
  if (!session) {
    const cutoffTime = process.env.CUTOFF_TIME || '15:15';
    const breakTime = process.env.BREAK_TIME || '15:30';
    session = await Session.create({ date, cutoffTime, breakTime });
  }
  return session;
}

/** POST /api/orders — place or update an order (never blocked, can update anytime) */
export const placeOrder = asyncHandler(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(parsed.error.errors[0].message, 400);

  const { memberId, menuItemId, sugarLevel, note } = parsed.data;
  const session = await requireSession();

  // Validate member and menu item exist
  const [member, menuItem] = await Promise.all([
    Member.findById(memberId),
    MenuItem.findById(menuItemId),
  ]);
  if (!member) throw httpError('Member not found', 404);
  if (!menuItem) throw httpError('Menu item not found', 404);

  const order = await Order.findOneAndUpdate(
    { session: session._id, member: memberId },
    { status: 'ordered', menuItem: menuItemId, sugarLevel: sugarLevel || 'normal', note },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .populate('menuItem', 'name emoji')
    .populate('member', 'name');

  // Broadcast via Socket.IO
  req.app.get('io').emit('order:update', { type: 'ordered', order });

  res.json({ success: true, order });
});

/** POST /api/orders/skip — mark skipping today (can update anytime) */
export const skipOrder = asyncHandler(async (req, res) => {
  const parsed = skipSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(parsed.error.errors[0].message, 400);

  const { memberId } = parsed.data;
  const session = await requireSession();

  const member = await Member.findById(memberId);
  if (!member) throw httpError('Member not found', 404);

  const order = await Order.findOneAndUpdate(
    { session: session._id, member: memberId },
    { status: 'skipped', menuItem: null, sugarLevel: 'normal', note: '' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate('member', 'name');

  req.app.get('io').emit('order:update', { type: 'skipped', order });

  res.json({ success: true, order });
});

/** DELETE /api/orders/my-order — cancel order (back to pending, can update anytime) */
export const cancelOrder = asyncHandler(async (req, res) => {
  const memberId = req.query.memberId;
  if (!memberId) throw httpError('memberId query param required', 400);

  const session = await requireSession();

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
