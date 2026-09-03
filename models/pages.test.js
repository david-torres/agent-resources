const { test, expect } = require('bun:test');
const { clientStub } = require('../test/helpers/supabase-query-stub');

test('getRecentNews returns only published news, newest first', async () => {
    const { getRecentNews } = require('./pages');
    const { client, builder } = clientStub([{ id: 'n1' }]);
    const { data, error } = await getRecentNews({ limit: 2 }, client);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'n1' }]);
    expect(builder.calls).toContainEqual(['from', 'pages']);
    expect(builder.calls).toContainEqual(['eq', 'is_news', true]);
    expect(builder.calls).toContainEqual(['eq', 'is_published', true]);
    expect(builder.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(builder.calls).toContainEqual(['limit', 2]);
});

test('getAllNews returns every published news post, newest first, with no limit', async () => {
    const { getAllNews } = require('./pages');
    const { client, builder } = clientStub([{ id: 'n1' }, { id: 'n2' }]);
    const { data, error } = await getAllNews(client);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'n1' }, { id: 'n2' }]);
    expect(builder.calls).toContainEqual(['from', 'pages']);
    expect(builder.calls).toContainEqual(['eq', 'is_news', true]);
    expect(builder.calls).toContainEqual(['eq', 'is_published', true]);
    expect(builder.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(builder.calls.some(call => call[0] === 'limit')).toBe(false);
});

test('createPage trims the title and slug before inserting', async () => {
    const { createPage } = require('./pages');
    const { client, builder } = clientStub([]);
    const { error } = await createPage({ title: ' My Title ', slug: ' my-title ' }, client);

    expect(error).toBeNull();
    const insertCall = builder.calls.find(call => call[0] === 'insert');
    expect(insertCall[1]).toMatchObject({ title: 'My Title', slug: 'my-title' });
});

test('updatePage trims the title before updating', async () => {
    const { updatePage } = require('./pages');
    const { client, builder } = clientStub([]);
    const { error } = await updatePage('p1', { title: ' New Title ', slug: 'new-title' }, client);

    expect(error).toBeNull();
    const updateCall = builder.calls.find(call => call[0] === 'update');
    expect(updateCall[1]).toMatchObject({ title: 'New Title', slug: 'new-title' });
});
