const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { version } = require('../package.json');
const { resolveAgentAuth } = require('../util/auth');
const { isValidUuid } = require('../util/validate');
const agentReads = require('../services/agent/service');

const router = express.Router();

const record = z.object({}).passthrough();

const success = (structuredContent) => ({
  structuredContent,
  content: [{ type: 'text', text: JSON.stringify(structuredContent) }]
});

const failure = (code, message) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }]
});

const internalError = (toolName, err) => {
  console.error(`MCP tool ${toolName} failed:`, err);
  return failure('internal', 'Internal error');
};

const withAuth = (req, toolName, handler) => async (args) => {
  let result;
  try {
    result = await resolveAgentAuth(req);
  } catch (err) {
    return internalError(toolName, err);
  }
  if (!result.ok) return failure('unauthenticated', result.error);
  try {
    return await handler(args, result.auth);
  } catch (err) {
    return internalError(toolName, err);
  }
};

const readTool = (toolName, key, load, notFoundMessage) => async (args, auth) => {
  const { data, error } = await load(args, agentReads.actorFromAuth(auth));
  if (error) return internalError(toolName, error);
  if (notFoundMessage && !data) return failure('not_found', notFoundMessage);
  return success({ [key]: data });
};

const readById = (toolName, key, load, notFoundMessage) => {
  const read = readTool(toolName, key, ({ id }, actor) => load(id, actor), notFoundMessage);
  return async (args, auth) => {
    if (!isValidUuid(args.id)) return failure('invalid_argument', 'id must be a UUID');
    return read(args, auth);
  };
};

const buildServer = (req) => {
  const server = new McpServer({ name: 'agent-resources', version });
  const annotations = { readOnlyHint: true };

  server.registerTool('getMe', {
    description: 'Verify the current AgentResources authentication and return the authenticated user and profile.',
    inputSchema: {},
    outputSchema: { user: record, profile: record, token: record.nullable() },
    annotations
  }, withAuth(req, 'getMe', async (args, auth) => success(agentReads.buildMe(auth))));

  server.registerTool('listClasses', {
    description: 'List Enclave classes visible to the authenticated user. Use this to discover the current live class list or filter classes by rules edition, version, status, or player-created status. Results contain summaries; call getClass for full class details.',
    inputSchema: {
      rules_edition: z.string().optional().describe('Only classes for this rules edition.'),
      rules_version: z.string().optional().describe('Only classes for this rules version.'),
      status: z.string().optional().describe('Only classes with this release status.'),
      is_player_created: z.boolean().optional().describe('Only player-created (true) or official (false) classes.')
    },
    outputSchema: { classes: z.array(record) },
    annotations
  }, withAuth(req, 'listClasses', readTool('listClasses', 'classes', agentReads.listClasses)));

  server.registerTool('getClass', {
    description: 'Retrieve the current details for one Enclave class by UUID, including description, abilities, gear, version metadata, and access state. Locked classes may return teaser-only information.',
    inputSchema: { id: z.string().describe('The class UUID.') },
    outputSchema: { class: record },
    annotations
  }, withAuth(req, 'getClass', readById('getClass', 'class', agentReads.getClass, 'Class not found')));

  server.registerTool('searchCharacters', {
    description: 'Search AgentResources characters visible to the authenticated user.',
    inputSchema: { q: z.string().optional().describe('Text to match against character names; omit to list all.') },
    outputSchema: { characters: z.array(record) },
    annotations
  }, withAuth(req, 'searchCharacters', readTool('searchCharacters', 'characters', ({ q }, actor) => agentReads.searchCharacters(q, actor))));

  server.registerTool('getCharacter', {
    description: 'Retrieve one AgentResources character by UUID.',
    inputSchema: { id: z.string().describe('The character UUID.') },
    outputSchema: { character: record },
    annotations
  }, withAuth(req, 'getCharacter', readById('getCharacter', 'character', agentReads.getCharacter, 'Character not found')));

  return server;
};

router.post('/', async (req, res) => {
  const server = buildServer(req);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const methodNotAllowed = (req, res) => res.status(405).json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null
});

router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

module.exports = router;
