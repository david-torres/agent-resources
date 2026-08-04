require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');

const seedMission = async (prefix, creatorProfileId, {
  name = `${prefix}-mission`,
  date = '2026-01-15T18:00:00Z',
  isPublic = true
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('missions')
    .insert({
      name,
      date,
      is_public: isPublic,
      creator_id: creatorProfileId,
      summary: 'Fixture mission',
      statement: 'Fixture statement'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { seedMission };
