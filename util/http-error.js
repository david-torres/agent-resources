// util/http-error.js
const FRIENDLY_NOT_FOUND = "We couldn't find that, or you don't have access to it.";
const isProd = () => process.env.NODE_ENV === 'production';

function classifyError(error, fallback = {}) {
  let base;
  switch (error && error.code) {
    case 'PGRST116':
      base = { status: 404, title: 'Not found', message: FRIENDLY_NOT_FOUND };
      break;
    case '42501':
      base = { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND };
      break;
    case '23505':
      base = { status: 409, title: 'Already exists', message: 'That already exists.' };
      break;
    default:
      if (!error) {
        base = { status: 404, title: 'Not found', message: FRIENDLY_NOT_FOUND };
      } else {
        base = {
          status: 500,
          title: 'Something went wrong',
          message: isProd() ? 'An unexpected error occurred. Please try again.' : String(error.message || error),
        };
      }
  }
  return {
    status: fallback.status != null ? fallback.status : base.status,
    title: fallback.title != null ? fallback.title : base.title,
    message: fallback.message != null ? fallback.message : base.message,
  };
}

module.exports = { classifyError, FRIENDLY_NOT_FOUND };
