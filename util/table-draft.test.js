const { test, expect } = require('bun:test');
const { parseMembership, resolveDraft } = require('./table-draft');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = Array.from({ length: 10 }, (_, i) => uuid(i + 1));
const INVISIBLE = ID[9];
const PRIVATE_MEMBER = ID[6];

const row = (id, overrides = {}) => ({ id, name: `Character ${id}`, is_public: true, might: 1, ...overrides });

// Rows come back reversed on purpose: .in() promises no ordering.
const loader = async (ids) => ({
  data: ids.filter((id) => id !== INVISIBLE)
    .map((id) => row(id, id === PRIVATE_MEMBER ? { is_public: false } : {}))
    .reverse(),
  error: null,
});

test('duplicate ids dedupe, preserving first-seen order', () => {
  expect(parseMembership({ c: `${ID[0]},${ID[1]},${ID[0]}` }).ids).toEqual([ID[0], ID[1]]);
});

test('non-UUID junk is dropped', () => {
  expect(parseMembership({ c: `not-a-uuid,${ID[0]},, ,<script>` }).ids).toEqual([ID[0]]);
});

test('add appends an id once; remove drops it and keeps the order', () => {
  expect(parseMembership({ c: `${ID[0]},${ID[1]}`, add: ID[1] }).ids).toEqual([ID[0], ID[1]]);
  expect(parseMembership({ c: ID[0], add: ID[1] }).ids).toEqual([ID[0], ID[1]]);
  expect(parseMembership({ c: `${ID[0]},${ID[1]},${ID[2]}`, remove: ID[1] }).ids).toEqual([ID[0], ID[2]]);
  expect(parseMembership({ c: `${ID[0]},${ID[1]}`, remove: ID[5] }).ids).toEqual([ID[0], ID[1]]);
});

test('more than eight ids truncates to eight and reports the drop', () => {
  const { ids, droppedOverCap } = parseMembership({ c: ID.slice(0, 9).join(',') });
  expect(ids.length).toBe(8);
  expect(droppedOverCap).toBe(1);
});

test('adding past the cap drops the addition rather than an existing member', () => {
  const full = ID.slice(0, 8);
  const { ids, droppedOverCap } = parseMembership({ c: full.join(','), add: ID[8] });
  expect(ids).toEqual(full);
  expect(droppedOverCap).toBe(1);
});

test('members follow URL order, not the order the loader returned', async () => {
  const draft = await resolveDraft({ c: `${ID[0]},${ID[1]},${ID[2]}` }, null, loader);
  expect(draft.members.map((m) => m.id)).toEqual([ID[0], ID[1], ID[2]]);
  expect(draft.tableCsv).toBe(`${ID[0]},${ID[1]},${ID[2]}`);
});

test('ids that resolve to nothing are counted and leave the roster', async () => {
  const draft = await resolveDraft({ c: `${ID[0]},${INVISIBLE}` }, null, loader);
  expect(draft.tableCsv).toBe(ID[0]);
  expect(draft.unresolved).toBe(1);
});

test('private members are counted', async () => {
  const draft = await resolveDraft({ c: `${ID[0]},${PRIVATE_MEMBER}` }, null, loader);
  expect(draft.privateCount).toBe(1);
});

test('a loader error is returned, not thrown', async () => {
  const draft = await resolveDraft({ c: ID[0] }, null, async () => ({ data: null, error: { message: 'boom' } }));
  expect(draft.error).toEqual({ message: 'boom' });
});

test('draft members are display-shaped for the shared roster', async () => {
  const rows = [{ id: uuid(1), name: 'Ash', is_public: true, might: 1 }];
  const draft = await resolveDraft({ c: uuid(1) }, null, async () => ({ data: rows, error: null }));
  expect(draft.members[0]).toMatchObject({ memberId: uuid(1), id: uuid(1), isGuest: false, canRemove: true, canViewDetails: true });
});
