import mongoose from 'mongoose';
import { isPastCutoff } from '../utils/time.js';

const sessionSchema = new mongoose.Schema(
  {
    // YYYY-MM-DD in Asia/Kolkata — unique per day
    date: { type: String, required: true, unique: true },
    // "HH:MM" 24h — taken from env at session creation time
    cutoffTime: { type: String, required: true },
    breakTime: { type: String, required: true },
    isLocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/** Derive whether this session is past cutoff right now */
sessionSchema.virtual('isPastCutoff').get(function () {
  return isPastCutoff(this);
});

export default mongoose.model('Session', sessionSchema);

