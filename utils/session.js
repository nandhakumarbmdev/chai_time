import Session from '../models/Session.js';
import { todayIST } from './time.js';

export const DEFAULT_CUTOFF = '19:00';
export const DEFAULT_BREAK = '15:30';

/** Resolve today's session, creating it if needed; keeps cutoffTime in sync with CUTOFF_TIME */
export async function getOrCreateTodaySession() {
  const date = todayIST();
  const cutoffTime = process.env.CUTOFF_TIME || DEFAULT_CUTOFF;
  const breakTime = process.env.BREAK_TIME || DEFAULT_BREAK;

  let session = await Session.findOne({ date });
  if (!session) {
    return Session.create({ date, cutoffTime, breakTime });
  }
  // A session created before the cutoff changed would otherwise keep the old value all day
  if (session.cutoffTime !== cutoffTime) {
    session.cutoffTime = cutoffTime;
    await session.save();
  }
  return session;
}
