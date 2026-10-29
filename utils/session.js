import Session from '../models/Session.js';
import { todayIST } from './time.js';

export const DEFAULT_CUTOFF = '19:00';
export const DEFAULT_BREAK = '15:30';

const validHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');

// Today's session never changes during the day apart from cutoffTime, so keep it in memory
let cached = null;

/** Resolve today's session, creating it if needed; keeps cutoffTime in sync with CUTOFF_TIME */
export async function getOrCreateTodaySession() {
  const date = todayIST();
  const cutoffTime = validHHMM(process.env.CUTOFF_TIME) ? process.env.CUTOFF_TIME : DEFAULT_CUTOFF;
  const breakTime = validHHMM(process.env.BREAK_TIME) ? process.env.BREAK_TIME : DEFAULT_BREAK;

  if (cached && cached.date === date && cached.cutoffTime === cutoffTime) return cached;

  let session = await Session.findOne({ date });
  if (!session) {
    try {
      session = await Session.create({ date, cutoffTime, breakTime });
    } catch (err) {
      // A concurrent first request of the day created it (unique index on date)
      if (err?.code !== 11000) throw err;
      session = await Session.findOne({ date });
    }
  }
  // A session created before the cutoff changed would otherwise keep the old value all day
  if (session.cutoffTime !== cutoffTime) {
    session.cutoffTime = cutoffTime;
    await session.save();
  }
  cached = session;
  return session;
}
