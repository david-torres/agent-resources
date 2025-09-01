function getSystemMessage() {
  if (process.env.SYSTEM_MESSAGE_ENABLED !== 'true') return null;
  const id = process.env.SYSTEM_MESSAGE_ID || 'default';
  const level = process.env.SYSTEM_MESSAGE_LEVEL || 'info';
  const text = process.env.SYSTEM_MESSAGE_TEXT || '';
  if (!text) return null;
  return { id, level, text };
}

module.exports = { getSystemMessage };


