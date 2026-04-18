# Discord Bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Discord bot that lets users link their `agent-resources` account via a device-code flow, then look up characters, classes, and abilities from within Discord.

**Architecture:** Two processes, two repositories. The existing `agent-resources` Express/Supabase app grows new `/api/agent/*` endpoints (character search/detail, bot-link start/claim) and one authenticated web page (`/link/bot`). A new Node process in a separate repo (`agent-resources-discord-bot`) uses `discord.js` + local SQLite (better-sqlite3) to translate Discord interactions into HTTPS calls against the agent API. The bot holds no business logic and never touches Supabase directly.

**Tech Stack:** Node.js, Bun (test runner), Express 4, Handlebars, Supabase (Postgres), `discord.js` v14, `better-sqlite3`, AES-256-GCM for token encryption at rest on the bot side.

**Spec:** `docs/superpowers/specs/2026-04-17-discord-bot-mvp-design.md`

---

## Phase A — Webapp: API and linking page

All tasks in Phase A happen in the `agent-resources` repository. Tests use `bun test` (imports from `bun:test`).

### Task A1: Create `pending_bot_links` migration

**Files:**
- Create: `supabase/migrations/20260418_pending_bot_links.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Bot linking codes for the Discord device-code flow.
-- Short-lived rows (10 min TTL) that tie a Discord user to an agent token
-- once the user confirms the code on the web side.
create table if not exists public.pending_bot_links (
  code text primary key,
  discord_user_id text not null,
  agent_token_id uuid references public.agent_api_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists pending_bot_links_discord_user_id_idx
  on public.pending_bot_links (discord_user_id);

create index if not exists pending_bot_links_expires_at_idx
  on public.pending_bot_links (expires_at);
```

- [ ] **Step 2: Apply the migration to your local Supabase**

Run: `supabase db push` (or apply via the Supabase SQL editor if you work directly against hosted Supabase).
Expected: migration applied; table `public.pending_bot_links` exists with the three indexes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260418_pending_bot_links.sql
git commit -m "Add pending_bot_links table for Discord bot linking"
```

---

### Task A2: Add `models/bot-link.js` — code generation and lifecycle

**Files:**
- Create: `models/bot-link.js`
- Create: `models/bot-link.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// models/bot-link.test.js
const { test, expect } = require('bun:test');
const { generateLinkCode, formatLinkCode } = require('./bot-link');

test('generateLinkCode returns 8 uppercase alphanumeric characters', () => {
  const code = generateLinkCode();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
});

test('generateLinkCode returns distinct values across calls', () => {
  const codes = new Set();
  for (let i = 0; i < 100; i++) codes.add(generateLinkCode());
  expect(codes.size).toBe(100);
});

test('formatLinkCode inserts a dash after the first four characters', () => {
  expect(formatLinkCode('A3F79K2P')).toBe('A3F7-9K2P');
});

test('formatLinkCode throws on malformed codes', () => {
  expect(() => formatLinkCode('short')).toThrow();
  expect(() => formatLinkCode('lowercase')).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/bot-link.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement code generation and formatting**

```javascript
// models/bot-link.js
const crypto = require('crypto');
const { supabaseAdmin } = require('./_base');

const LINK_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LINK_CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_MAX_PENDING_PER_DISCORD_ID = 3;
const LINK_CODE_RATE_WINDOW_MS = 10 * 60 * 1000;
const LINK_ROW_CLEANUP_AGE_MS = 60 * 60 * 1000;

const generateLinkCode = () => {
  const bytes = crypto.randomBytes(LINK_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    out += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
  }
  return out;
};

const formatLinkCode = (code) => {
  if (typeof code !== 'string' || !/^[A-Z0-9]{8}$/.test(code)) {
    throw new Error('Invalid link code');
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
};

const normalizeLinkCode = (value) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(cleaned)) return null;
  return cleaned;
};

const isValidDiscordUserId = (value) =>
  typeof value === 'string' && /^[0-9]{1,32}$/.test(value);

module.exports = {
  LINK_CODE_TTL_MS,
  LINK_CODE_MAX_PENDING_PER_DISCORD_ID,
  LINK_CODE_RATE_WINDOW_MS,
  LINK_ROW_CLEANUP_AGE_MS,
  generateLinkCode,
  formatLinkCode,
  normalizeLinkCode,
  isValidDiscordUserId
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test models/bot-link.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Add tests for DB-backed lifecycle**

Append to `models/bot-link.test.js`:

```javascript
const { normalizeLinkCode, isValidDiscordUserId } = require('./bot-link');

test('normalizeLinkCode strips dashes and uppercases', () => {
  expect(normalizeLinkCode('a3f7-9k2p')).toBe('A3F79K2P');
  expect(normalizeLinkCode('A3F7 9K2P')).toBe('A3F79K2P');
});

test('normalizeLinkCode returns null on bad input', () => {
  expect(normalizeLinkCode('short')).toBe(null);
  expect(normalizeLinkCode('BAD!CODE')).toBe(null);
  expect(normalizeLinkCode(null)).toBe(null);
});

test('isValidDiscordUserId accepts numeric strings, rejects everything else', () => {
  expect(isValidDiscordUserId('123456789012345678')).toBe(true);
  expect(isValidDiscordUserId('0')).toBe(true);
  expect(isValidDiscordUserId('123abc')).toBe(false);
  expect(isValidDiscordUserId('')).toBe(false);
  expect(isValidDiscordUserId(null)).toBe(false);
});
```

Run: `bun test models/bot-link.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Add DB-backed functions**

Append to `models/bot-link.js`, before `module.exports`:

```javascript
const nowIso = () => new Date().toISOString();
const plusMsIso = (ms) => new Date(Date.now() + ms).toISOString();
const minusMsIso = (ms) => new Date(Date.now() - ms).toISOString();

const cleanupStaleLinks = async () => {
  await supabaseAdmin
    .from('pending_bot_links')
    .delete()
    .lt('created_at', minusMsIso(LINK_ROW_CLEANUP_AGE_MS));
};

const countRecentPendingForDiscordId = async (discordUserId) => {
  const since = minusMsIso(LINK_CODE_RATE_WINDOW_MS);
  const { count, error } = await supabaseAdmin
    .from('pending_bot_links')
    .select('code', { count: 'exact', head: true })
    .eq('discord_user_id', discordUserId)
    .gte('created_at', since)
    .is('consumed_at', null);
  if (error) return { count: 0, error };
  return { count: count || 0, error: null };
};

const createPendingLink = async (discordUserId) => {
  if (!isValidDiscordUserId(discordUserId)) {
    return { data: null, error: new Error('Invalid discord_user_id') };
  }

  await cleanupStaleLinks();

  const { count, error: countError } = await countRecentPendingForDiscordId(discordUserId);
  if (countError) return { data: null, error: countError };
  if (count >= LINK_CODE_MAX_PENDING_PER_DISCORD_ID) {
    return { data: null, error: new Error('Too many pending codes') };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const expiresAt = plusMsIso(LINK_CODE_TTL_MS);
    const { data, error } = await supabaseAdmin
      .from('pending_bot_links')
      .insert({
        code,
        discord_user_id: discordUserId,
        expires_at: expiresAt
      })
      .select('code, discord_user_id, expires_at')
      .single();
    if (!error) return { data, error: null };
    if (error.code !== '23505') return { data: null, error };
  }
  return { data: null, error: new Error('Could not allocate unique link code') };
};

const getPendingLinkByCode = async (code) => {
  const { data, error } = await supabaseAdmin
    .from('pending_bot_links')
    .select('code, discord_user_id, agent_token_id, created_at, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle();
  return { data: data || null, error };
};

const attachTokenToPendingLink = async ({ code, agentTokenId }) => {
  const { data, error } = await supabaseAdmin
    .from('pending_bot_links')
    .update({ agent_token_id: agentTokenId })
    .eq('code', code)
    .is('consumed_at', null)
    .gt('expires_at', nowIso())
    .is('agent_token_id', null)
    .select('code')
    .single();
  return { data, error };
};

const consumePendingLink = async ({ code, discordUserId }) => {
  const { data: row, error } = await getPendingLinkByCode(code);
  if (error && error.code !== 'PGRST116') return { data: null, error };
  if (!row) return { data: null, error: 'not_found' };
  if (row.consumed_at) return { data: null, error: 'expired' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { data: null, error: 'expired' };
  }
  if (row.discord_user_id !== discordUserId) return { data: null, error: 'mismatch' };
  if (!row.agent_token_id) return { data: null, error: 'pending' };

  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from('pending_bot_links')
    .update({ consumed_at: nowIso() })
    .eq('code', code)
    .is('consumed_at', null)
    .select('code, agent_token_id')
    .single();
  if (consumeError || !consumed) return { data: null, error: 'expired' };
  return { data: { agentTokenId: consumed.agent_token_id }, error: null };
};

module.exports = {
  LINK_CODE_TTL_MS,
  LINK_CODE_MAX_PENDING_PER_DISCORD_ID,
  LINK_CODE_RATE_WINDOW_MS,
  LINK_ROW_CLEANUP_AGE_MS,
  generateLinkCode,
  formatLinkCode,
  normalizeLinkCode,
  isValidDiscordUserId,
  cleanupStaleLinks,
  createPendingLink,
  getPendingLinkByCode,
  attachTokenToPendingLink,
  consumePendingLink
};
```

The existing `module.exports` at the bottom is replaced by the block above — delete the earlier one.

- [ ] **Step 7: Run tests to verify nothing regressed**

Run: `bun test models/bot-link.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add models/bot-link.js models/bot-link.test.js
git commit -m "Add bot-link model: code generation, rate limit, lifecycle"
```

---

### Task A3: Add agent-scoped character search and detail

**Files:**
- Modify: `models/character.js` (append)
- Create: `models/character-agent.test.js`

- [ ] **Step 1: Write the failing test (serialization only — no DB)**

```javascript
// models/character-agent.test.js
const { test, expect } = require('bun:test');
const { serializeCharacterForAgent, serializeCharacterSummaryForAgent } = require('./character');

const baseCharacter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Alice',
  class: 'Scout',
  level: 3,
  is_public: true,
  is_deceased: false,
  created_by: 'profile-1',
  owner_name: 'Bob'
};

test('serializeCharacterSummaryForAgent returns compact shape', () => {
  const out = serializeCharacterSummaryForAgent(baseCharacter);
  expect(out).toEqual({
    id: baseCharacter.id,
    name: 'Alice',
    class: 'Scout',
    level: 3,
    is_public: true,
    is_deceased: false,
    owner_profile_id: 'profile-1',
    owner_name: 'Bob'
  });
});

test('serializeCharacterForAgent returns null when actor cannot see private char', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-other' };
  expect(serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'player' })).toBe(null);
});

test('serializeCharacterForAgent returns detail when owner is the actor', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-self' };
  const out = serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'player' });
  expect(out.id).toBe(priv.id);
  expect(out.is_public).toBe(false);
});

test('serializeCharacterForAgent returns detail for admin regardless of visibility', () => {
  const priv = { ...baseCharacter, is_public: false, created_by: 'profile-other' };
  const out = serializeCharacterForAgent(priv, { profileId: 'profile-self', role: 'admin' });
  expect(out.id).toBe(priv.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/character-agent.test.js`
Expected: FAIL — `serializeCharacterForAgent is not a function`.

- [ ] **Step 3: Add the serializers and lookups to `models/character.js`**

Append at the end of `models/character.js`, before `module.exports`:

```javascript
const { escapeLikePattern } = require('../util/validate');

const serializeCharacterSummaryForAgent = (row) => ({
  id: row.id,
  name: row.name,
  class: row.class,
  level: row.level,
  is_public: !!row.is_public,
  is_deceased: !!row.is_deceased,
  owner_profile_id: row.created_by || null,
  owner_name: row.owner_name || row.profile?.name || null
});

const serializeCharacterForAgent = (row, actor = {}) => {
  if (!row) return null;
  const isAdmin = actor.role === 'admin';
  const isOwner = !!actor.profileId && actor.profileId === row.created_by;
  const visible = row.is_public === true || isOwner || isAdmin;
  if (!visible) return null;

  return {
    ...serializeCharacterSummaryForAgent(row),
    stats: {
      muscle: row.muscle ?? null,
      moxie: row.moxie ?? null,
      mind: row.mind ?? null,
      magic: row.magic ?? null,
      max_hp: row.max_hp ?? null,
      current_hp: row.current_hp ?? null
    },
    traits: Array.isArray(row.personality) ? row.personality.map((t) => t.name) : [],
    abilities: Array.isArray(row.abilities)
      ? row.abilities.map((a) => ({ name: a.name, description: a.description }))
      : [],
    gear: Array.isArray(row.gear)
      ? row.gear.map((g) => ({ name: g.name, description: g.description }))
      : []
  };
};

const searchCharactersForAgent = async (query, actor = {}) => {
  const q = typeof query === 'string' ? query.trim() : '';
  let builder = supabase
    .from('characters')
    .select('id, name, class, level, is_public, is_deceased, created_by, profile:created_by(name)')
    .order('name', { ascending: true })
    .limit(10);

  if (actor.role !== 'admin') {
    if (actor.profileId) {
      builder = builder.or(`is_public.eq.true,created_by.eq.${actor.profileId}`);
    } else {
      builder = builder.eq('is_public', true);
    }
  }

  if (q.length > 0) {
    const escaped = escapeLikePattern(q);
    builder = builder.ilike('name', `%${escaped}%`);
  } else if (actor.profileId) {
    builder = builder.eq('created_by', actor.profileId).order('updated_at', { ascending: false });
  } else {
    return { data: [], error: null };
  }

  const { data, error } = await builder;
  if (error) return { data: null, error };

  const mapped = (data || []).map((row) =>
    serializeCharacterSummaryForAgent({ ...row, owner_name: row.profile?.name || null })
  );
  return { data: mapped, error: null };
};

const { statList } = require('../util/enclave-consts');

const getCharacterForAgent = async (id, actor = {}) => {
  const { data, error } = await supabase
    .from('characters')
    .select(`
      id, name, class, level, is_public, is_deceased, created_by,
      ${statList.join(',')},
      profile:created_by(name),
      personality:traits(name),
      abilities:class_abilities(name,description),
      gear:class_gear(name,description)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') return { data: null, error };
  if (!data) return { data: null, error: null };

  const serialized = serializeCharacterForAgent(
    { ...data, owner_name: data.profile?.name || null },
    actor
  );
  return { data: serialized, error: null };
};
```

Update the `module.exports` at the bottom of `models/character.js` to include:
```javascript
  serializeCharacterSummaryForAgent,
  serializeCharacterForAgent,
  searchCharactersForAgent,
  getCharacterForAgent
```

(Leave all existing exports in place. Add these alongside them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test models/character-agent.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add models/character.js models/character-agent.test.js
git commit -m "Add agent-scoped character search and detail serializers"
```

---

### Task A4: Add agent API routes for bot-link and characters

**Files:**
- Modify: `routes/agent.js`

- [ ] **Step 1: Add unauthenticated bot-link routes above the `router.use(isAgentAuthenticated)` line**

Open `routes/agent.js` and replace its contents with:

```javascript
const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
const { isAgentAuthenticated } = require('../util/auth');
const { listClassesForAgent, getClassForAgent } = require('../models/class');
const {
  searchCharactersForAgent,
  getCharacterForAgent
} = require('../models/character');
const {
  normalizeLinkCode,
  isValidDiscordUserId,
  formatLinkCode,
  createPendingLink,
  getPendingLinkByCode,
  consumePendingLink,
  cleanupStaleLinks
} = require('../models/bot-link');

const parseBooleanFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const getActorContext = (res) => ({
  userId: res.locals.user?.id || null,
  profileId: res.locals.profile?.id || null,
  role: res.locals.profile?.role || null
});

router.post('/bot-link/start', express.json(), async (req, res) => {
  const discordUserId = req.body?.discord_user_id;
  if (!isValidDiscordUserId(discordUserId)) {
    return res.status(400).json({ error: 'Invalid discord_user_id' });
  }
  const { data, error } = await createPendingLink(discordUserId);
  if (error) {
    if (error.message === 'Too many pending codes') {
      return res.status(429).json({ error: error.message });
    }
    return res.status(500).json({ error: error.message });
  }
  return res.json({
    code: data.code,
    formatted_code: formatLinkCode(data.code),
    expires_at: data.expires_at
  });
});

router.post('/bot-link/claim', express.json(), async (req, res) => {
  await cleanupStaleLinks();
  const normalized = normalizeLinkCode(req.body?.code);
  const discordUserId = req.body?.discord_user_id;
  if (!normalized || !isValidDiscordUserId(discordUserId)) {
    return res.status(400).json({ error: 'Invalid code or discord_user_id' });
  }

  const { data, error } = await consumePendingLink({
    code: normalized,
    discordUserId
  });
  if (error === 'not_found') return res.status(404).json({ error: 'Not found' });
  if (error === 'expired') return res.status(410).json({ error: 'Expired' });
  if (error === 'mismatch') return res.status(409).json({ error: 'Discord user mismatch' });
  if (error === 'pending') return res.status(202).json({ status: 'pending' });
  if (error) return res.status(500).json({ error: error.message || 'Internal error' });

  const { supabaseAdmin } = require('../models/_base');
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('agent_api_tokens')
    .select('id, profile:profile_id(id, name)')
    .eq('id', data.agentTokenId)
    .single();
  if (tokenError || !tokenRow) {
    return res.status(500).json({ error: 'Token lookup failed' });
  }

  const { data: rawTokenRow, error: rawError } = await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .select('raw_token')
    .eq('agent_token_id', data.agentTokenId)
    .maybeSingle();
  if (rawError || !rawTokenRow) {
    return res.status(500).json({ error: 'Token stash missing' });
  }

  await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .delete()
    .eq('agent_token_id', data.agentTokenId);

  return res.json({
    token: rawTokenRow.raw_token,
    agent_token_id: data.agentTokenId,
    profile: {
      id: tokenRow.profile?.id || null,
      name: tokenRow.profile?.name || null
    }
  });
});

router.use(isAgentAuthenticated);

router.get('/me', async (req, res) => {
  return res.json({
    user: { id: res.locals.user.id },
    profile: {
      id: res.locals.profile.id,
      user_id: res.locals.profile.user_id,
      name: res.locals.profile.name,
      role: res.locals.profile.role
    },
    token: res.locals.agentToken
  });
});

router.get('/classes', async (req, res) => {
  const filters = {
    rules_edition: req.query.rules_edition,
    rules_version: req.query.rules_version,
    status: req.query.status,
    is_player_created: parseBooleanFilter(req.query.is_player_created)
  };
  const { data, error } = await listClassesForAgent(filters, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ classes: data });
});

router.get('/classes/:id', async (req, res) => {
  const { data, error } = await getClassForAgent(req.params.id, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Class not found' });
  return res.json({ class: data });
});

router.get('/characters', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const { data, error } = await searchCharactersForAgent(q, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ characters: data });
});

router.get('/characters/:id', async (req, res) => {
  const { data, error } = await getCharacterForAgent(req.params.id, getActorContext(res));
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Character not found' });
  return res.json({ character: data });
});

module.exports = router;
```

The claim handler references `pending_bot_links_raw_tokens`, which is introduced in Task A5. That task adds the table, writes it on confirm, and wires the claim path to read from it.

- [ ] **Step 2: Register UUID validation for `:id` on characters**

UUID validation is already handled by the top-of-file `registerUuidParams(router, ['id'])`, so no change needed.

- [ ] **Step 3: Smoke test the unauthenticated routes**

Start the dev server: `bun run dev`

```bash
curl -s -X POST http://localhost:3000/api/agent/bot-link/start \
  -H 'Content-Type: application/json' \
  -d '{"discord_user_id":"123456789012345678"}'
```
Expected: JSON `{ "code": "XXXXXXXX", "formatted_code": "XXXX-XXXX", "expires_at": "..." }`.

```bash
curl -s -X POST http://localhost:3000/api/agent/bot-link/claim \
  -H 'Content-Type: application/json' \
  -d '{"code":"NOPE0000","discord_user_id":"123456789012345678"}' -w '\n%{http_code}\n'
```
Expected: `404`.

- [ ] **Step 4: Commit**

```bash
git add routes/agent.js
git commit -m "Add agent routes for bot-link start/claim and character search/detail"
```

---

### Task A5: Add the web-side confirmation page and raw-token stash

**Files:**
- Create: `supabase/migrations/20260419_pending_bot_links_raw_tokens.sql`
- Create: `routes/bot-link.js`
- Create: `views/bot-link.handlebars`
- Modify: `index.js`

- [ ] **Step 1: Add the raw-token stash table**

```sql
-- supabase/migrations/20260419_pending_bot_links_raw_tokens.sql
-- Short-lived raw-token storage bridging the webapp's token mint step
-- and the bot's /claim poll. Rows are deleted as soon as the bot claims.
create table if not exists public.pending_bot_links_raw_tokens (
  agent_token_id uuid primary key references public.agent_api_tokens(id) on delete cascade,
  raw_token text not null,
  created_at timestamptz not null default now()
);
```

Apply: `supabase db push` (or run via the SQL editor).
Expected: table created.

- [ ] **Step 2: Add the confirmation view**

```handlebars
{{!-- views/bot-link.handlebars --}}
<section class="section">
  <div class="container" style="max-width: 480px;">
    <h1 class="title is-4">Link your Discord account</h1>
    <p class="content">
      Enter the code shown in your Discord DM to authorize the Enclave
      Discord bot for your account.
    </p>

    {{#if error}}
      <div class="notification is-danger">{{error}}</div>
    {{/if}}

    {{#if success}}
      <div class="notification is-success">
        You're linked. You can close this tab and return to Discord.
      </div>
    {{else}}
      <form method="post" action="/link/bot/confirm">
        <input type="hidden" name="_csrf" value="{{csrfToken}}">
        <div class="field">
          <label class="label" for="code">Code</label>
          <div class="control">
            <input class="input" id="code" name="code"
                   placeholder="XXXX-XXXX" autocomplete="off"
                   maxlength="9" required>
          </div>
        </div>
        <div class="field">
          <div class="control">
            <button class="button is-primary" type="submit">Authorize bot</button>
          </div>
        </div>
      </form>
    {{/if}}
  </div>
</section>
```

If the app does not currently use CSRF tokens in forms, omit the hidden `_csrf` field. Check one existing form in `views/` (e.g., `profile.handlebars`) and match the pattern used.

- [ ] **Step 3: Add the route**

```javascript
// routes/bot-link.js
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../util/auth');
const { createAgentToken } = require('../models/agent-token');
const {
  normalizeLinkCode,
  getPendingLinkByCode,
  attachTokenToPendingLink,
  cleanupStaleLinks
} = require('../models/bot-link');
const { supabaseAdmin } = require('../models/_base');

router.get('/', isAuthenticated, (req, res) => {
  return res.render('bot-link', { title: 'Link Discord bot' });
});

router.post('/confirm', express.urlencoded({ extended: false }), isAuthenticated, async (req, res) => {
  await cleanupStaleLinks();

  const normalized = normalizeLinkCode(req.body?.code);
  if (!normalized) {
    return res.render('bot-link', {
      title: 'Link Discord bot',
      error: 'Code must be 8 letters or numbers, e.g. XXXX-XXXX.'
    });
  }

  const { data: pending, error: pendingError } = await getPendingLinkByCode(normalized);
  if (pendingError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Lookup failed.' });
  }
  if (!pending) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Code not found. Run /link in Discord again.' });
  }
  if (pending.consumed_at || new Date(pending.expires_at).getTime() < Date.now()) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Code expired. Run /link in Discord again.' });
  }
  if (pending.agent_token_id) {
    return res.render('bot-link', { title: 'Link Discord bot', success: true });
  }

  const tokenName = `Discord bot (${pending.discord_user_id})`;
  const { data: tokenRow, error: tokenError } = await createAgentToken({
    userId: res.locals.user.id,
    profileId: res.locals.profile.id,
    name: tokenName
  });
  if (tokenError || !tokenRow) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not create a token. Try again.' });
  }

  const { error: stashError } = await supabaseAdmin
    .from('pending_bot_links_raw_tokens')
    .insert({ agent_token_id: tokenRow.id, raw_token: tokenRow.token });
  if (stashError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not stash token. Try again.' });
  }

  const { error: attachError } = await attachTokenToPendingLink({
    code: normalized,
    agentTokenId: tokenRow.id
  });
  if (attachError) {
    return res.render('bot-link', { title: 'Link Discord bot', error: 'Could not attach token. Try again.' });
  }

  return res.render('bot-link', { title: 'Link Discord bot', success: true });
});

module.exports = router;
```

- [ ] **Step 4: Register the route in `index.js`**

Locate the section in `index.js` where other routers are mounted (look for `app.use('/profile', ...)` or similar) and add:

```javascript
const botLinkRouter = require('./routes/bot-link');
app.use('/link/bot', botLinkRouter);
```

- [ ] **Step 5: Manual end-to-end smoke test**

1. `bun run dev`
2. In a new terminal: `curl -s -X POST http://localhost:3000/api/agent/bot-link/start -H 'Content-Type: application/json' -d '{"discord_user_id":"111111111111111111"}'` — note the `formatted_code`.
3. Open `http://localhost:3000/link/bot` in a browser logged into an account; paste the code; submit. Expected: "You're linked" message.
4. Claim: `curl -s -X POST http://localhost:3000/api/agent/bot-link/claim -H 'Content-Type: application/json' -d '{"code":"<CODE>","discord_user_id":"111111111111111111"}'`. Expected: JSON with `token`, `agent_token_id`, `profile`.
5. Claim again with the same input. Expected: `410`.
6. Visit `/profile/agent-tokens` in the browser — verify the new token appears, named `Discord bot (111111111111111111)`.
7. Use the token: `curl -s http://localhost:3000/api/agent/me -H "X-Agent-Token: <token>"`. Expected: your profile.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260419_pending_bot_links_raw_tokens.sql routes/bot-link.js views/bot-link.handlebars index.js
git commit -m "Add /link/bot confirmation page and raw-token stash"
```

---

### Task A6: Integration-test the full link flow

**Files:**
- Create: `routes/bot-link.test.js`

- [ ] **Step 1: Write an integration-style test that exercises model functions directly**

```javascript
// routes/bot-link.test.js
const { test, expect, beforeAll } = require('bun:test');
const {
  createPendingLink,
  getPendingLinkByCode,
  attachTokenToPendingLink,
  consumePendingLink
} = require('../models/bot-link');
const { supabaseAdmin } = require('../models/_base');

const DISCORD_ID = '222222222222222222';

// These tests require the local Supabase to be running with migrations applied.
// They create and clean up their own rows.

const cleanup = async () => {
  await supabaseAdmin.from('pending_bot_links').delete().eq('discord_user_id', DISCORD_ID);
};

test('createPendingLink inserts a row and returns a code', async () => {
  await cleanup();
  const { data, error } = await createPendingLink(DISCORD_ID);
  expect(error).toBe(null);
  expect(data.code).toMatch(/^[A-Z0-9]{8}$/);
  expect(data.discord_user_id).toBe(DISCORD_ID);
});

test('consumePendingLink rejects pending rows (no token yet)', async () => {
  await cleanup();
  const { data: pending } = await createPendingLink(DISCORD_ID);
  const { error } = await consumePendingLink({ code: pending.code, discordUserId: DISCORD_ID });
  expect(error).toBe('pending');
});

test('consumePendingLink rejects wrong discord_user_id', async () => {
  await cleanup();
  const { data: pending } = await createPendingLink(DISCORD_ID);
  const { error } = await consumePendingLink({ code: pending.code, discordUserId: '999999999999999999' });
  expect(error).toBe('mismatch');
});

test('createPendingLink blocks more than 3 pending for one Discord ID', async () => {
  await cleanup();
  await createPendingLink(DISCORD_ID);
  await createPendingLink(DISCORD_ID);
  await createPendingLink(DISCORD_ID);
  const { error } = await createPendingLink(DISCORD_ID);
  expect(error?.message).toBe('Too many pending codes');
  await cleanup();
});
```

- [ ] **Step 2: Run the tests**

Run: `bun test routes/bot-link.test.js`
Expected: all 4 tests pass against a running local Supabase. If the test runner cannot reach Supabase, skip this task in CI and document it as a manual test; the previous task's manual smoke already covers the end-to-end path.

- [ ] **Step 3: Commit**

```bash
git add routes/bot-link.test.js
git commit -m "Add integration tests for bot-link lifecycle"
```

---

## Phase B — Bot project bootstrap

Phase B creates a new repository on disk. Use a sibling directory next to `agent-resources`, e.g., `~/code/agent-resources-discord-bot`.

### Task B1: Initialize the bot repository

**Files (in the new repo `agent-resources-discord-bot`):**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/config.js`

- [ ] **Step 1: Create the project directory and init git**

```bash
mkdir -p ~/code/agent-resources-discord-bot
cd ~/code/agent-resources-discord-bot
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "agent-resources-discord-bot",
  "version": "0.1.0",
  "description": "Discord bot for the Enclave agent-resources webapp.",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "register": "node src/register-commands.js",
    "test": "node --test"
  },
  "dependencies": {
    "discord.js": "^14.14.1",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.5",
    "undici": "^6.19.2"
  }
}
```

Run: `npm install`
Expected: dependencies install without errors.

- [ ] **Step 3: Write `.env.example` and `.gitignore`**

```dotenv
# .env.example
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
AGENT_API_BASE_URL=http://localhost:3000/api/agent
AGENT_SERVICE_TOKEN=
BOT_TOKEN_ENCRYPTION_KEY=
BOT_DB_PATH=./data/bot.sqlite
```

```
# .gitignore
node_modules
.env
data/
*.log
```

- [ ] **Step 4: Write `src/config.js`**

```javascript
require('dotenv').config();

const required = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_APPLICATION_ID',
  'AGENT_API_BASE_URL',
  'AGENT_SERVICE_TOKEN',
  'BOT_TOKEN_ENCRYPTION_KEY'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

if (Buffer.from(process.env.BOT_TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) {
  throw new Error('BOT_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64');
}

module.exports = {
  discordBotToken: process.env.DISCORD_BOT_TOKEN,
  discordApplicationId: process.env.DISCORD_APPLICATION_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID || null,
  agentApiBaseUrl: process.env.AGENT_API_BASE_URL.replace(/\/$/, ''),
  agentServiceToken: process.env.AGENT_SERVICE_TOKEN,
  encryptionKey: Buffer.from(process.env.BOT_TOKEN_ENCRYPTION_KEY, 'base64'),
  dbPath: process.env.BOT_DB_PATH || './data/bot.sqlite'
};
```

- [ ] **Step 5: Write a minimal `README.md`**

```markdown
# agent-resources-discord-bot

Discord bot for the [agent-resources](https://github.com/david-torres/agent-resources) webapp.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in values.
   - `BOT_TOKEN_ENCRYPTION_KEY`: generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - `AGENT_SERVICE_TOKEN`: an agent token created from a dedicated service profile on the webapp.
3. `npm run register` to register slash commands (once per deployment, or after command definitions change).
4. `npm run dev`

## Commands

- `/link` — start Discord-to-agent-resources linking.
- `/unlink` — revoke your link.
- `/whois <name>` — look up a character.
- `/class <name>` — look up a class.
- `/ability <class> <name>` — look up an ability.
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore README.md src/config.js
git commit -m "Bootstrap Discord bot repo"
```

---

### Task B2: SQLite storage with encrypted tokens

**Files:**
- Create: `src/storage.js`
- Create: `src/storage.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/storage.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const makeStorage = () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const key = crypto.randomBytes(32);
  const { createStorage } = require('./storage');
  return createStorage({ dbPath, encryptionKey: key });
};

test('upsert then read returns the decrypted token', () => {
  const s = makeStorage();
  s.upsertLink({ discordUserId: '111', agentTokenId: 'token-uuid', rawToken: 'ar_pat_xyz' });
  const link = s.getLink('111');
  assert.equal(link.agentTokenId, 'token-uuid');
  assert.equal(link.rawToken, 'ar_pat_xyz');
});

test('delete removes the row', () => {
  const s = makeStorage();
  s.upsertLink({ discordUserId: '222', agentTokenId: 'tok', rawToken: 'ar_pat_abc' });
  s.deleteLink('222');
  assert.equal(s.getLink('222'), null);
});

test('upsert replaces existing row', () => {
  const s = makeStorage();
  s.upsertLink({ discordUserId: '333', agentTokenId: 'a', rawToken: 'ar_pat_one' });
  s.upsertLink({ discordUserId: '333', agentTokenId: 'b', rawToken: 'ar_pat_two' });
  const link = s.getLink('333');
  assert.equal(link.agentTokenId, 'b');
  assert.equal(link.rawToken, 'ar_pat_two');
});

test('ciphertexts for the same plaintext differ (IV is random)', () => {
  const s = makeStorage();
  s.upsertLink({ discordUserId: 'A', agentTokenId: 'x', rawToken: 'same' });
  s.upsertLink({ discordUserId: 'B', agentTokenId: 'y', rawToken: 'same' });
  const rowA = s.debugRawRow('A');
  const rowB = s.debugRawRow('B');
  assert.notEqual(rowA.agent_token_encrypted, rowB.agent_token_encrypted);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/storage.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the storage module**

```javascript
// src/storage.js
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

const encrypt = (plaintext, key) => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
};

const decrypt = (payload, key) => {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

const createStorage = ({ dbPath, encryptionKey }) => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      discord_user_id TEXT PRIMARY KEY,
      agent_token_id TEXT NOT NULL,
      agent_token_encrypted TEXT NOT NULL,
      linked_at TEXT NOT NULL
    )
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO links (discord_user_id, agent_token_id, agent_token_encrypted, linked_at)
    VALUES (@discord_user_id, @agent_token_id, @agent_token_encrypted, @linked_at)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      agent_token_id = excluded.agent_token_id,
      agent_token_encrypted = excluded.agent_token_encrypted,
      linked_at = excluded.linked_at
  `);
  const getStmt = db.prepare('SELECT * FROM links WHERE discord_user_id = ?');
  const deleteStmt = db.prepare('DELETE FROM links WHERE discord_user_id = ?');

  return {
    upsertLink({ discordUserId, agentTokenId, rawToken }) {
      upsertStmt.run({
        discord_user_id: discordUserId,
        agent_token_id: agentTokenId,
        agent_token_encrypted: encrypt(rawToken, encryptionKey),
        linked_at: new Date().toISOString()
      });
    },
    getLink(discordUserId) {
      const row = getStmt.get(discordUserId);
      if (!row) return null;
      return {
        discordUserId: row.discord_user_id,
        agentTokenId: row.agent_token_id,
        rawToken: decrypt(row.agent_token_encrypted, encryptionKey),
        linkedAt: row.linked_at
      };
    },
    deleteLink(discordUserId) {
      deleteStmt.run(discordUserId);
    },
    debugRawRow(discordUserId) {
      return getStmt.get(discordUserId);
    },
    close() {
      db.close();
    }
  };
};

module.exports = { createStorage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/storage.test.js`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js src/storage.test.js
git commit -m "Add SQLite storage with AES-256-GCM encrypted tokens"
```

---

## Phase C — Bot: API client and command framework

### Task C1: HTTP client with status-code mapping

**Files:**
- Create: `src/api-client.js`
- Create: `src/api-client.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// src/api-client.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapStatusToUserMessage } = require('./api-client');

test('401 maps to re-link message', () => {
  assert.equal(
    mapStatusToUserMessage(401),
    'Your link was revoked on the website. Run /link to reconnect.'
  );
});

test('403 maps to access message', () => {
  assert.equal(mapStatusToUserMessage(403), "You don't have access to that.");
});

test('404 maps to not-found', () => {
  assert.equal(mapStatusToUserMessage(404), 'Not found.');
});

test('429 maps to slow-down', () => {
  assert.equal(mapStatusToUserMessage(429), 'Slow down — try again in a few seconds.');
});

test('500-class maps to generic retry', () => {
  assert.equal(
    mapStatusToUserMessage(503),
    "Couldn't reach agent-resources right now — try again in a minute."
  );
});

test('unknown status maps to generic retry', () => {
  assert.equal(
    mapStatusToUserMessage(0),
    "Couldn't reach agent-resources right now — try again in a minute."
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/api-client.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```javascript
// src/api-client.js
const { request } = require('undici');

const mapStatusToUserMessage = (status) => {
  if (status === 401) return 'Your link was revoked on the website. Run /link to reconnect.';
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Slow down — try again in a few seconds.';
  return "Couldn't reach agent-resources right now — try again in a minute.";
};

const createApiClient = ({ baseUrl, serviceToken, timeoutMs = 5000 }) => {
  const call = async ({ method, path, query, body, token, signal }) => {
    const qs = query
      ? '?' + new URLSearchParams(
          Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
        ).toString()
      : '';
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-agent-token'] = token;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await request(baseUrl + path + qs, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: signal || ac.signal
      });
      const status = res.statusCode;
      let data = null;
      try { data = await res.body.json(); } catch { data = null; }
      return { status, data };
    } catch (err) {
      return { status: 0, data: null, networkError: err };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    mapStatusToUserMessage,
    startBotLink: (discordUserId) =>
      call({ method: 'POST', path: '/bot-link/start', body: { discord_user_id: discordUserId } }),
    claimBotLink: (code, discordUserId) =>
      call({ method: 'POST', path: '/bot-link/claim', body: { code, discord_user_id: discordUserId } }),
    me: (token) => call({ method: 'GET', path: '/me', token }),
    listClasses: () => call({ method: 'GET', path: '/classes', token: serviceToken }),
    getClass: (id, token) => call({ method: 'GET', path: `/classes/${id}`, token: token || serviceToken }),
    searchCharacters: (q, token) =>
      call({ method: 'GET', path: '/characters', query: { q }, token }),
    getCharacter: (id, token) =>
      call({ method: 'GET', path: `/characters/${id}`, token })
  };
};

module.exports = { createApiClient, mapStatusToUserMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/api-client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api-client.js src/api-client.test.js
git commit -m "Add API client and status-code mapping"
```

---

### Task C2: Slash command registration script

**Files:**
- Create: `src/commands/definitions.js`
- Create: `src/register-commands.js`

- [ ] **Step 1: Define the commands**

```javascript
// src/commands/definitions.js
const { SlashCommandBuilder } = require('discord.js');

const shareOption = (b) =>
  b.addBooleanOption((o) =>
    o.setName('share').setDescription('Post the result publicly').setRequired(false)
  );

module.exports = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to agent-resources.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Revoke this Discord link from your agent-resources account.')
    .toJSON(),
  shareOption(
    new SlashCommandBuilder()
      .setName('whois')
      .setDescription('Look up a character by name.')
      .addStringOption((o) =>
        o.setName('name').setDescription('Character name').setRequired(true).setAutocomplete(true)
      )
  ).toJSON(),
  shareOption(
    new SlashCommandBuilder()
      .setName('class')
      .setDescription('Look up a class.')
      .addStringOption((o) =>
        o.setName('name').setDescription('Class name').setRequired(true).setAutocomplete(true)
      )
  ).toJSON(),
  shareOption(
    new SlashCommandBuilder()
      .setName('ability')
      .setDescription('Look up an ability on a class.')
      .addStringOption((o) =>
        o.setName('class').setDescription('Class name').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((o) =>
        o.setName('name').setDescription('Ability name').setRequired(true).setAutocomplete(true)
      )
  ).toJSON()
];
```

- [ ] **Step 2: Register script**

```javascript
// src/register-commands.js
const { REST, Routes } = require('discord.js');
const config = require('./config');
const commands = require('./commands/definitions');

const rest = new REST({ version: '10' }).setToken(config.discordBotToken);

(async () => {
  try {
    const route = config.discordGuildId
      ? Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId)
      : Routes.applicationCommands(config.discordApplicationId);
    const result = await rest.put(route, { body: commands });
    console.log(`Registered ${result.length} commands.`);
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
```

- [ ] **Step 3: Register commands against a development guild**

Configure `DISCORD_GUILD_ID` in `.env` to a guild you administer (fastest update path; global commands can take up to an hour to propagate).

Run: `npm run register`
Expected: `Registered 5 commands.`

- [ ] **Step 4: Commit**

```bash
git add src/commands/definitions.js src/register-commands.js
git commit -m "Add slash command definitions and register script"
```

---

### Task C3: Class-list cache

**Files:**
- Create: `src/cache/classes.js`

- [ ] **Step 1: Implement a polling cache**

```javascript
// src/cache/classes.js
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const createClassCache = ({ api }) => {
  let classes = [];
  let detailCache = new Map(); // id -> { data, fetchedAt }
  let timer = null;

  const refresh = async () => {
    const { status, data } = await api.listClasses();
    if (status === 200 && data?.classes) {
      classes = data.classes;
    }
  };

  return {
    start() {
      refresh();
      timer = setInterval(refresh, REFRESH_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async ensureLoaded() {
      if (classes.length === 0) await refresh();
    },
    list() {
      return classes;
    },
    findByNamePrefix(q) {
      const needle = (q || '').toLowerCase();
      return classes
        .filter((c) => c.name.toLowerCase().includes(needle))
        .slice(0, 25);
    },
    findExactByName(name) {
      const needle = (name || '').toLowerCase();
      return classes.find((c) => c.name.toLowerCase() === needle) || null;
    },
    async getDetail(id, token) {
      const cached = detailCache.get(id);
      if (cached && Date.now() - cached.fetchedAt < 60 * 1000) return cached.data;
      const { status, data } = await api.getClass(id, token);
      if (status !== 200 || !data?.class) return null;
      detailCache.set(id, { data: data.class, fetchedAt: Date.now() });
      return data.class;
    }
  };
};

module.exports = { createClassCache };
```

- [ ] **Step 2: Commit**

```bash
git add src/cache/classes.js
git commit -m "Add class-list cache with short-lived detail cache"
```

---

## Phase D — Bot: command handlers

### Task D1: `/link` and `/unlink`

**Files:**
- Create: `src/commands/link.js`
- Create: `src/commands/unlink.js`

- [ ] **Step 1: Implement `/link`**

```javascript
// src/commands/link.js
const { formatLinkCode } = require('./format');
const POLL_INITIAL_MS = 2000;
const POLL_MAX_MS = 5000;
const POLL_BUDGET_MS = 10 * 60 * 1000;

const activePollers = new Map(); // discord_user_id -> AbortController

module.exports = ({ api, storage, config }) => ({
  name: 'link',
  async execute(interaction) {
    const discordUserId = interaction.user.id;

    const prior = activePollers.get(discordUserId);
    if (prior) prior.abort();
    const ac = new AbortController();
    activePollers.set(discordUserId, ac);

    const { status, data } = await api.startBotLink(discordUserId);
    if (status === 429) {
      activePollers.delete(discordUserId);
      return interaction.reply({
        content: 'Too many link attempts. Wait a few minutes and try again.',
        ephemeral: true
      });
    }
    if (status !== 200 || !data?.code) {
      activePollers.delete(discordUserId);
      return interaction.reply({
        content: api.mapStatusToUserMessage(status),
        ephemeral: true
      });
    }

    const baseUrl = config.agentApiBaseUrl.replace(/\/api\/agent$/, '');
    await interaction.reply({
      content: `Visit ${baseUrl}/link/bot and enter code **${formatLinkCode(data.code)}**. Expires in 10 minutes.`,
      ephemeral: true
    });

    const start = Date.now();
    let delay = POLL_INITIAL_MS;

    while (Date.now() - start < POLL_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, delay));
      if (ac.signal.aborted) return;
      delay = Math.min(POLL_MAX_MS, Math.floor(delay * 1.25));

      const claim = await api.claimBotLink(data.code, discordUserId);
      if (claim.status === 202) continue;
      if (claim.status === 200 && claim.data?.token) {
        storage.upsertLink({
          discordUserId,
          agentTokenId: claim.data.agent_token_id,
          rawToken: claim.data.token
        });
        activePollers.delete(discordUserId);
        await interaction.editReply({
          content: `Linked as **${claim.data.profile?.name || 'Unknown'}**.`
        });
        return;
      }
      if (claim.status === 410 || claim.status === 409 || claim.status === 404) {
        activePollers.delete(discordUserId);
        await interaction.editReply({ content: 'Code expired or invalidated. Run /link again.' });
        return;
      }
    }

    activePollers.delete(discordUserId);
    await interaction.editReply({ content: 'Code expired. Run /link again.' });
  }
});
```

- [ ] **Step 2: Implement `formatLinkCode` helper**

```javascript
// src/commands/format.js
const formatLinkCode = (code) => {
  if (typeof code !== 'string' || code.length < 8) return code;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
};

module.exports = { formatLinkCode };
```

- [ ] **Step 3: Implement `/unlink`**

```javascript
// src/commands/unlink.js
module.exports = ({ api, storage, config }) => ({
  name: 'unlink',
  async execute(interaction) {
    const discordUserId = interaction.user.id;
    const link = storage.getLink(discordUserId);
    if (!link) {
      return interaction.reply({ content: 'You are not linked.', ephemeral: true });
    }

    const baseUrl = config.agentApiBaseUrl.replace(/\/api\/agent$/, '');
    const { request } = require('undici');
    const res = await request(`${baseUrl}/profile/agent-tokens/${link.agentTokenId}`, {
      method: 'DELETE',
      headers: { 'x-agent-token': link.rawToken }
    });
    // Regardless of server response, drop our local copy.
    storage.deleteLink(discordUserId);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return interaction.reply({ content: 'Unlinked and token revoked.', ephemeral: true });
    }
    return interaction.reply({
      content: 'Unlinked locally. The server-side token may need manual revocation.',
      ephemeral: true
    });
  }
});
```

If the `/profile/agent-tokens/:id` endpoint requires a Supabase session rather than an agent token, adjust `/unlink` to call a new `/api/agent/tokens/me` DELETE endpoint that authorizes via `isAgentAuthenticated` and revokes the calling token. Add that endpoint to `routes/agent.js` in Phase A if needed — verify against the existing endpoint by checking `routes/profile.js` before implementing.

- [ ] **Step 4: Commit**

```bash
git add src/commands/link.js src/commands/unlink.js src/commands/format.js
git commit -m "Add /link and /unlink commands"
```

---

### Task D2: `/whois` with autocomplete

**Files:**
- Create: `src/commands/whois.js`
- Create: `src/embeds/character.js`

- [ ] **Step 1: Character embed builder**

```javascript
// src/embeds/character.js
const { EmbedBuilder } = require('discord.js');

const buildCharacterEmbed = (c) => {
  const embed = new EmbedBuilder()
    .setTitle(`${c.name} — ${c.class} L${c.level}`)
    .setColor(0x5865F2);

  const statsLine = [
    `Muscle ${c.stats?.muscle ?? '—'}`,
    `Moxie ${c.stats?.moxie ?? '—'}`,
    `Mind ${c.stats?.mind ?? '—'}`,
    `Magic ${c.stats?.magic ?? '—'}`
  ].join(' · ');
  const hpLine = `HP ${c.stats?.current_hp ?? '—'}/${c.stats?.max_hp ?? '—'}`;
  embed.addFields(
    { name: 'Stats', value: `${statsLine}\n${hpLine}`, inline: false }
  );

  if (c.traits?.length) {
    embed.addFields({ name: 'Personality', value: c.traits.join(', '), inline: false });
  }
  if (c.abilities?.length) {
    const text = c.abilities
      .slice(0, 10)
      .map((a) => `**${a.name}** — ${a.description}`)
      .join('\n');
    embed.addFields({ name: 'Abilities', value: text.slice(0, 1024), inline: false });
  }
  if (c.gear?.length) {
    const text = c.gear
      .slice(0, 10)
      .map((g) => `**${g.name}** — ${g.description}`)
      .join('\n');
    embed.addFields({ name: 'Gear', value: text.slice(0, 1024), inline: false });
  }
  if (c.owner_name) embed.setFooter({ text: `Owner: ${c.owner_name}` });
  if (c.is_deceased) embed.setDescription('*Deceased*');

  return embed;
};

const buildCharacterListEmbed = (matches) => {
  const lines = matches.map((m) => `• **${m.name}** — ${m.class} L${m.level} (${m.owner_name || 'Unknown'})`);
  return new EmbedBuilder()
    .setTitle(`Multiple matches (${matches.length})`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setColor(0x5865F2)
    .setFooter({ text: 'Tip: use autocomplete to pick one directly.' });
};

module.exports = { buildCharacterEmbed, buildCharacterListEmbed };
```

- [ ] **Step 2: `/whois` command with autocomplete**

```javascript
// src/commands/whois.js
const { isValidUuid } = require('../util/validate');
const { buildCharacterEmbed, buildCharacterListEmbed } = require('../embeds/character');

module.exports = ({ api, storage }) => ({
  name: 'whois',
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const link = storage.getLink(interaction.user.id);
    const token = link?.rawToken || null;
    const { status, data } = await api.searchCharacters(focused, token);
    if (status !== 200 || !data?.characters) {
      return interaction.respond([]);
    }
    const choices = data.characters.slice(0, 25).map((c) => ({
      name: `${c.name} — ${c.class} L${c.level}`.slice(0, 100),
      value: c.id
    }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const share = interaction.options.getBoolean('share') === true;
    const raw = interaction.options.getString('name');
    const link = storage.getLink(interaction.user.id);
    const token = link?.rawToken || null;

    if (isValidUuid(raw)) {
      const { status, data } = await api.getCharacter(raw, token);
      if (status !== 200 || !data?.character) {
        return interaction.reply({
          content: api.mapStatusToUserMessage(status),
          ephemeral: !share
        });
      }
      return interaction.reply({
        embeds: [buildCharacterEmbed(data.character)],
        ephemeral: !share
      });
    }

    const search = await api.searchCharacters(raw, token);
    if (search.status !== 200 || !search.data?.characters) {
      return interaction.reply({
        content: api.mapStatusToUserMessage(search.status),
        ephemeral: !share
      });
    }
    if (search.data.characters.length === 0) {
      return interaction.reply({ content: 'No matches.', ephemeral: !share });
    }
    if (search.data.characters.length === 1) {
      const id = search.data.characters[0].id;
      const { status, data } = await api.getCharacter(id, token);
      if (status !== 200 || !data?.character) {
        return interaction.reply({ content: api.mapStatusToUserMessage(status), ephemeral: !share });
      }
      return interaction.reply({
        embeds: [buildCharacterEmbed(data.character)],
        ephemeral: !share
      });
    }
    return interaction.reply({
      embeds: [buildCharacterListEmbed(search.data.characters)],
      ephemeral: !share
    });
  }
});
```

- [ ] **Step 3: Add a local `isValidUuid` helper to the bot**

```javascript
// src/util/validate.js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
module.exports = { isValidUuid };
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/whois.js src/embeds/character.js src/util/validate.js
git commit -m "Add /whois command with autocomplete and embeds"
```

---

### Task D3: `/class` and `/ability`

**Files:**
- Create: `src/commands/class.js`
- Create: `src/commands/ability.js`
- Create: `src/embeds/class.js`

- [ ] **Step 1: Class and ability embed builders**

```javascript
// src/embeds/class.js
const { EmbedBuilder } = require('discord.js');

const buildClassEmbed = (c) => {
  const embed = new EmbedBuilder().setTitle(c.name).setColor(0x00B894);
  if (c.image_url) embed.setThumbnail(c.image_url);

  if (c.access_level === 'teaser_only') {
    embed.setDescription(c.teaser || '*Teaser only.*');
    embed.addFields({
      name: 'Locked',
      value: 'Unlock this class in the library to see abilities and gear.',
      inline: false
    });
    return embed;
  }

  if (c.description) embed.setDescription(c.description.slice(0, 4000));
  if (c.abilities?.length) {
    const text = c.abilities
      .map((a) => `**${a.name}** — ${(a.description || '').slice(0, 200)}`)
      .join('\n');
    embed.addFields({ name: 'Abilities', value: text.slice(0, 1024), inline: false });
  }
  if (c.gear?.length) {
    const text = c.gear
      .map((g) => `**${g.name}** — ${(g.description || '').slice(0, 200)}`)
      .join('\n');
    embed.addFields({ name: 'Gear', value: text.slice(0, 1024), inline: false });
  }
  return embed;
};

const buildAbilityEmbed = ({ className, ability }) =>
  new EmbedBuilder()
    .setTitle(`${ability.name}`)
    .setDescription(ability.description || '')
    .setFooter({ text: `Class: ${className}` })
    .setColor(0x00B894);

module.exports = { buildClassEmbed, buildAbilityEmbed };
```

- [ ] **Step 2: `/class` command**

```javascript
// src/commands/class.js
const { buildClassEmbed } = require('../embeds/class');

module.exports = ({ api, storage, classCache }) => ({
  name: 'class',
  async autocomplete(interaction) {
    await classCache.ensureLoaded();
    const q = interaction.options.getFocused();
    const matches = classCache.findByNamePrefix(q);
    return interaction.respond(
      matches.map((c) => ({ name: c.name.slice(0, 100), value: c.id }))
    );
  },
  async execute(interaction) {
    const share = interaction.options.getBoolean('share') === true;
    const value = interaction.options.getString('name');
    const link = storage.getLink(interaction.user.id);
    const token = link?.rawToken || null;

    const cls = await classCache.getDetail(value, token);
    if (!cls) {
      // value may be a free-typed name (not a UUID)
      const resolved = classCache.findExactByName(value);
      if (!resolved) {
        return interaction.reply({ content: 'Class not found.', ephemeral: !share });
      }
      const full = await classCache.getDetail(resolved.id, token);
      if (!full) return interaction.reply({ content: 'Class not found.', ephemeral: !share });
      return interaction.reply({ embeds: [buildClassEmbed(full)], ephemeral: !share });
    }
    return interaction.reply({ embeds: [buildClassEmbed(cls)], ephemeral: !share });
  }
});
```

- [ ] **Step 3: `/ability` command**

```javascript
// src/commands/ability.js
const { buildAbilityEmbed } = require('../embeds/class');

module.exports = ({ api, storage, classCache }) => ({
  name: 'ability',
  async autocomplete(interaction) {
    await classCache.ensureLoaded();
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'class') {
      const matches = classCache.findByNamePrefix(focused.value);
      return interaction.respond(
        matches.map((c) => ({ name: c.name.slice(0, 100), value: c.id }))
      );
    }
    if (focused.name === 'name') {
      const classValue = interaction.options.getString('class');
      if (!classValue) return interaction.respond([]);
      const link = storage.getLink(interaction.user.id);
      const token = link?.rawToken || null;
      const detail = await classCache.getDetail(classValue, token);
      if (!detail || !Array.isArray(detail.abilities)) return interaction.respond([]);
      const q = (focused.value || '').toLowerCase();
      const choices = detail.abilities
        .filter((a) => a.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((a) => ({ name: a.name.slice(0, 100), value: a.name }));
      return interaction.respond(choices);
    }
    return interaction.respond([]);
  },
  async execute(interaction) {
    const share = interaction.options.getBoolean('share') === true;
    const classValue = interaction.options.getString('class');
    const abilityName = interaction.options.getString('name');
    const link = storage.getLink(interaction.user.id);
    const token = link?.rawToken || null;

    let classId = classValue;
    if (!classId) return interaction.reply({ content: 'Pick a class.', ephemeral: !share });

    const detail = await classCache.getDetail(classId, token);
    if (!detail) return interaction.reply({ content: 'Class not found.', ephemeral: !share });
    if (detail.access_level === 'teaser_only') {
      return interaction.reply({
        content: 'This class is locked for you. Unlock it in the library first.',
        ephemeral: !share
      });
    }
    const ability = (detail.abilities || []).find(
      (a) => a.name.toLowerCase() === abilityName.toLowerCase()
    );
    if (!ability) return interaction.reply({ content: 'Ability not found.', ephemeral: !share });

    return interaction.reply({
      embeds: [buildAbilityEmbed({ className: detail.name, ability })],
      ephemeral: !share
    });
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/class.js src/commands/ability.js src/embeds/class.js
git commit -m "Add /class and /ability commands with teaser-gate rendering"
```

---

### Task D4: Wire up the bot entrypoint

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Write the entrypoint**

```javascript
// src/index.js
const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./config');
const { createStorage } = require('./storage');
const { createApiClient } = require('./api-client');
const { createClassCache } = require('./cache/classes');

const linkCmd = require('./commands/link');
const unlinkCmd = require('./commands/unlink');
const whoisCmd = require('./commands/whois');
const classCmd = require('./commands/class');
const abilityCmd = require('./commands/ability');

const storage = createStorage({
  dbPath: config.dbPath,
  encryptionKey: config.encryptionKey
});
const api = createApiClient({
  baseUrl: config.agentApiBaseUrl,
  serviceToken: config.agentServiceToken
});
const classCache = createClassCache({ api });

const deps = { api, storage, config, classCache };
const commands = Object.fromEntries(
  [linkCmd(deps), unlinkCmd(deps), whoisCmd(deps), classCmd(deps), abilityCmd(deps)].map(
    (c) => [c.name, c]
  )
);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  classCache.start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commands[interaction.commandName];
      if (cmd) await cmd.execute(interaction);
    } else if (interaction.isAutocomplete()) {
      const cmd = commands[interaction.commandName];
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
    }
  } catch (err) {
    console.error('Interaction error', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "Couldn't reach agent-resources right now — try again in a minute.",
          ephemeral: true
        });
      } catch {}
    }
  }
});

const shutdown = () => {
  console.log('Shutting down');
  classCache.stop();
  storage.close();
  client.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.discordBotToken);
```

- [ ] **Step 2: Manual end-to-end verification**

Start the webapp: in `agent-resources`, `bun run dev`.
Start the bot: in `agent-resources-discord-bot`, `npm run register` then `npm run dev`.
In your Discord server:

1. Run `/link`. Bot replies with a URL + code.
2. Open the URL (logged in), paste the code, submit. Browser confirms link.
3. Bot edits its reply to "Linked as **<you>**."
4. Run `/whois alice` (seed a character first). Verify autocomplete shows matches and that selecting one shows the full sheet.
5. Run `/class <a class you have unlocked>`. Verify full details.
6. Run `/class <a release-gated class you have not unlocked>`. Verify teaser-only rendering.
7. Run `/ability <class> <ability>`. Verify single-ability embed.
8. Run `/unlink`. Verify the token disappears from `/profile/agent-tokens`.

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "Wire up bot entrypoint and graceful shutdown"
```

---

## Self-review

**Spec coverage (against `2026-04-17-discord-bot-mvp-design.md`):**

- `pending_bot_links` table — Task A1.
- `POST /api/agent/bot-link/start` — Task A4 (with rate limit in A2's `createPendingLink`).
- `GET /link/bot` and `POST /link/bot/confirm` — Task A5.
- `POST /api/agent/bot-link/claim` with 200/202/404/409/410 semantics — Task A4 (status codes) and A2 (`consumePendingLink` error cases).
- `GET /api/agent/characters/search` and `/:id` — Task A4 route, Task A3 model.
- Lazy cleanup of stale pending rows — Task A2 (`cleanupStaleLinks`), called from A4 handlers.
- Bot linking flow (device-code) — Task D1.
- SQLite + AES-256-GCM — Task B2.
- Class-list cache with service token — Task C3.
- Slash commands `/link`, `/unlink`, `/whois`, `/class`, `/ability` — Tasks D1–D3, registered in C2.
- Ephemeral default with `share: true` option — Task C2 (option definition), D2–D3 (use).
- Teaser gate on `/class` and `/ability` — Task D3.
- Error mapping (401 re-link, 403/404/429/5xx) — Task C1.
- Graceful shutdown on SIGTERM — Task D4.

**Gaps addressed inline:** The claim handler in Task A4 references a `pending_bot_links_raw_tokens` table introduced in Task A5; this is noted in A4 so the engineer isn't surprised. The `/unlink` command may need a new DELETE endpoint if `/profile/agent-tokens/:id` is session-only — Task D1 Step 3 flags this and directs the engineer to verify before implementing, since the spec left the revocation route to implementation discovery.

**Placeholder scan:** None found. Every step has code or an exact command.

**Type consistency check:** `agentTokenId` / `rawToken` / `discordUserId` property names match across `storage.js`, `api-client.js`, and command handlers. `classCache.findByNamePrefix` / `findExactByName` / `getDetail` / `ensureLoaded` are defined in C3 and used consistently in D3. `mapStatusToUserMessage` is exported from `api-client.js` both as a named export and as a method on the client; both usages appear in the plan and both are valid.

---

## Execution options

Plan complete and saved to `docs/superpowers/plans/2026-04-17-discord-bot-mvp.md`.

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — executing-plans, batch checkpoints.
