// In-memory per-key sliding window. The buckets Map grows with the number of
// unique keys and is only reclaimed on process restart — fine for a single
// Railway instance with a bounded user count; revisit if we scale beyond ~1k
// active tokens.
const createRateLimiter = ({ max, windowMs }) => {
  const buckets = new Map();

  const check = (key) => {
    const now = Date.now();
    const windowStart = now - windowMs;
    const arr = (buckets.get(key) || []).filter((t) => t > windowStart);
    if (arr.length >= max) {
      buckets.set(key, arr);
      return false;
    }
    arr.push(now);
    buckets.set(key, arr);
    return true;
  };

  const middleware = (req, res, next) => {
    const key = res.locals.agentToken?.id || 'anon';
    if (!check(key)) {
      return res.status(429).json({ error: 'Too many requests', code: 'rate_limited' });
    }
    next();
  };

  return { check, middleware };
};

module.exports = { createRateLimiter };
