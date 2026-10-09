import mongoose from 'mongoose';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

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
  const [hh, mm] = this.cutoffTime.split(':').map(Number);
  const cutoff = dayjs.tz(this.date, TZ).hour(hh).minute(mm).second(0);
  return dayjs().isAfter(cutoff);
});

export default mongoose.model('Session', sessionSchema);

