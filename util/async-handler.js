// Forward a rejected async route handler to Express's error pipeline so a
// thrown AuthorizationError reaches the central handler (app.js) and maps to 403.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
