import Member from '../models/Member.js';
import { asyncHandler, httpError } from '../middleware/errorHandler.js';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(60).trim(),
});

/** GET /api/members */
export const listMembers = asyncHandler(async (_req, res) => {
  const members = await Member.find({ active: true }).sort({ name: 1 });
  res.json({ success: true, members });
});

/** POST /api/members */
export const createMember = asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(parsed.error.errors[0].message, 400);

  const { name } = parsed.data;

  // Case-insensitive check
  const existing = await Member.findOne({ name: { $regex: `^${name}$`, $options: 'i' } });
  if (existing) {
    return res.json({ success: true, member: existing, created: false });
  }

  const member = await Member.create({ name });
  res.status(201).json({ success: true, member, created: true });
});

