const { test, expect } = require('bun:test');
const { clientStub } = require('../test/helpers/supabase-query-stub');

test('createNavItem trims the label and url before inserting', async () => {
    const { createNavItem } = require('./nav');
    const { client, builder } = clientStub([]);
    const { error } = await createNavItem(
        { label: ' Characters ', type: 'link', url: ' /characters ', position: 0 },
        client
    );

    expect(error).toBeNull();
    const insertCall = builder.calls.find(call => call[0] === 'insert');
    expect(insertCall[1]).toMatchObject({ label: 'Characters', type: 'link', url: '/characters' });
});

test('updateNavItem trims the label before updating', async () => {
    const { updateNavItem } = require('./nav');
    const { client, builder } = clientStub([]);
    const { error } = await updateNavItem('n1', { label: ' Renamed ' }, client);

    expect(error).toBeNull();
    const updateCall = builder.calls.find(call => call[0] === 'update');
    expect(updateCall[1]).toEqual({ label: 'Renamed' });
});
