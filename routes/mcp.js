const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { version } = require('../package.json');
const { resolveMcpAuth } = require('../util/auth');
const { protectedResourceMetadataUrl } = require('./oauth-metadata');
const { isValidUuid } = require('../util/validate');
const { asyncHandler } = require('../util/async-handler');
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

const guarded = (toolName, handler) => async (args) => {
  try {
    return await handler(args);
  } catch (err) {
    return internalError(toolName, err);
  }
};

const readTool = (auth, toolName, key, load, notFoundMessage) => async (args) => {
  const { data, error } = await load(args, agentReads.actorFromAuth(auth));
  if (error) return internalError(toolName, error);
  if (notFoundMessage && !data) return failure('not_found', notFoundMessage);
  return success({ [key]: data });
};

const readById = (auth, toolName, key, load, notFoundMessage) => {
  const read = readTool(auth, toolName, key, ({ id }, actor) => load(id, actor), notFoundMessage);
  return async (args) => {
    if (!isValidUuid(args.id)) return failure('invalid_argument', 'id must be a UUID');
    return read(args);
  };
};

const buildServer = (auth) => {
  const server = new McpServer({ name: 'agent-resources', version });
  const annotations = { readOnlyHint: true };

  server.registerTool('getMe', {
    description: 'Verify the current AgentResources authentication and return the authenticated user and profile.',
    inputSchema: {},
    outputSchema: { user: record, profile: record, token: record.nullable() },
    annotations
  }, guarded('getMe', async () => success(agentReads.buildMe(auth))));

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
  }, guarded('listClasses', readTool(auth, 'listClasses', 'classes', agentReads.listClasses)));

  server.registerTool('getClass', {
    description: 'Retrieve the current details for one Enclave class by UUID, including description, abilities, gear, version metadata, and access state. Locked classes may return teaser-only information.',
    inputSchema: { id: z.string().describe('The class UUID.') },
    outputSchema: { class: record },
    annotations
  }, guarded('getClass', readById(auth, 'getClass', 'class', agentReads.getClass, 'Class not found')));

  server.registerTool('searchCharacters', {
    description: 'Search AgentResources characters visible to the authenticated user.',
    inputSchema: { q: z.string().optional().describe('Text to match against character names; omit to list all.') },
    outputSchema: { characters: z.array(record) },
    annotations
  }, guarded('searchCharacters', readTool(auth, 'searchCharacters', 'characters', ({ q }, actor) => agentReads.searchCharacters(q, actor))));

  server.registerTool('getCharacter', {
    description: 'Retrieve one AgentResources character by UUID.',
    inputSchema: { id: z.string().describe('The character UUID.') },
    outputSchema: { character: record },
    annotations
  }, guarded('getCharacter', readById(auth, 'getCharacter', 'character', agentReads.getCharacter, 'Character not found')));

  return server;
};

const challenge = (req, res, { reason, error }) => {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(req)}"`];
  if (reason === 'invalid') params.push('error="invalid_token"');
  res.set('WWW-Authenticate', `Bearer ${params.join(', ')}`);
  return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: error }, id: null });
};

const requireMcpAuth = asyncHandler(async (req, res, next) => {
  const result = await resolveMcpAuth(req);
  if (!result.ok) return challenge(req, res, result);
  res.locals.mcpAuth = result.auth;
  return next();
});

router.post('/', requireMcpAuth, asyncHandler(async (req, res) => {
  const server = buildServer(res.locals.mcpAuth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));

const methodNotAllowed = (req, res) => res.status(405).json({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed.' },
  id: null
});

router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

module.exports = router;
