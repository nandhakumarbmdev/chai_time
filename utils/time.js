import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Kolkata';

/** Returns today's date string "YYYY-MM-DD" in IST */
export function todayIST() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
}

/** Returns yesterday's date string "YYYY-MM-DD" in IST */
export function yesterdayIST() {
  return dayjs().tz(TZ).subtract(1, 'day').format('YYYY-MM-DD');
}

/**
 * Checks whether the current time is past the cutoff for the given session.
 * @param {object} session  - Mongoose Session doc with .date and .cutoffTime
 * @returns {boolean}
 */
export function isPastCutoff(session) {
  const [hh, mm] = session.cutoffTime.split(':').map(Number);
  const cutoff = dayjs.tz(session.date, TZ).hour(hh).minute(mm).second(0);
  return dayjs().isAfter(cutoff);
}

/**
 * Returns milliseconds remaining until cutoff (0 if already past).
 */
export function msToCutoff(session) {
  const [hh, mm] = session.cutoffTime.split(':').map(Number);
  const cutoff = dayjs.tz(session.date, TZ).hour(hh).minute(mm).second(0);
  return Math.max(0, cutoff.valueOf() - Date.now());
}

