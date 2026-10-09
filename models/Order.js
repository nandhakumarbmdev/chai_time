import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
    },
    status: {
      type: String,
      enum: ['ordered', 'skipped'],
      required: true,
    },
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      default: null,
    },
    sugarLevel: {
      type: String,
      enum: ['none', 'less', 'normal', 'extra'],
      default: 'normal',
    },
    note: { type: String, trim: true, maxlength: 100, default: '' },
  },
  { timestamps: true }
);

// One order per member per session
orderSchema.index({ session: 1, member: 1 }, { unique: true });

export default mongoose.model('Order', orderSchema);

