require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');

// `hostId` is a SEPARATE column from `creator_id` and the two are not
// interchangeable. The offscreen-mission source picker
// (models/offscreen-mission.js:150-178 getAvailableHostedMissionsForPicker)
// filters `.eq('host_id', profileId)` -- it lists the missions you CONDUITED,
// not the ones you created -- so a mission seeded with `creator_id` alone never
// appears in that picker. A spec relying on the default would silently get an
// empty option list and a select that falls back to "Other", which reads
// exactly like a product defect and is not one. Same shape as the Task 9
// `created_by` trap.
//
// Defaults to null so existing callers (e2e/specs/02-fixtures.spec.js:21, the
// only one) keep the rows they had; pass it explicitly when the mission has to
// be pickable.
const seedMission = async (prefix, creatorProfileId, {
  name = `${prefix}-mission`,
  date = '2026-01-15T18:00:00Z',
  isPublic = true,
  hostId = null
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('missions')
    .insert({
      name,
      date,
      is_public: isPublic,
      creator_id: creatorProfileId,
      host_id: hostId,
      summary: 'Fixture mission',
      statement: 'Fixture statement'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { seedMission };
