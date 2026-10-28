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

/** The cutoff instant: session.date + session.cutoffTime read as IST wall-clock time, whatever the host TZ */
function cutoffInstant(session) {
  return dayjs.tz(`${session.date} ${session.cutoffTime}`, 'YYYY-MM-DD HH:mm', TZ);
}

/**
 * Checks whether the current time is past the cutoff for the given session.
 * @param {object} session  - Mongoose Session doc with .date and .cutoffTime
 * @param {number} [now]    - epoch ms, defaults to Date.now() (injectable for tests)
 * @returns {boolean}
 */
export function isPastCutoff(session, now = Date.now()) {
  return now > cutoffInstant(session).valueOf();
}

/**
 * Returns milliseconds remaining until cutoff (0 if already past).
 */
export function msToCutoff(session, now = Date.now()) {
  return Math.max(0, cutoffInstant(session).valueOf() - now);
}

