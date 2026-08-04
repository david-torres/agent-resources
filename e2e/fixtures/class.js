require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');

const seedClass = async (prefix, {
  name = `${prefix}-class`,
  rulesVersion = 'v1',
  isPublic = true,
  abilities = [{ name: 'E2E Ability', description: 'Fixture ability' }],
  gear = []
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ name, rules_version: rulesVersion, is_public: isPublic, gear, abilities })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { seedClass };
