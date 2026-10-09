import mongoose from 'mongoose';

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    emoji: { type: String, required: true },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['hot', 'cold', 'herbal'],
      default: 'hot',
    },
    isAvailable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('MenuItem', menuItemSchema);

