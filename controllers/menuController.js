import MenuItem from '../models/MenuItem.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** GET /api/menu */
export const listMenu = asyncHandler(async (_req, res) => {
  const items = await MenuItem.find({ isAvailable: true }).sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, items });
});

