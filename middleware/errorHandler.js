/** Central error handler — must be last middleware */
export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${status}] ${message}`, err.stack || '');
  }

  res.status(status).json({ success: false, message });
}

/** Wrap async route handlers to forward errors to errorHandler */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Create a typed HTTP error */
export function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

