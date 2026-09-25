const express = require('express');
const { resolveBaseUrl } = require('../util/site-url');
const { oauthIssuer } = require('../util/oauth-token');

const router = express.Router();

const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
const MCP_PATH = '/api/mcp';

const protectedResourceMetadataUrl = (req) => `${resolveBaseUrl(req)}${RESOURCE_METADATA_PATH}${MCP_PATH}`;

router.get([RESOURCE_METADATA_PATH, `${RESOURCE_METADATA_PATH}${MCP_PATH}`], (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    resource: `${resolveBaseUrl(req)}${MCP_PATH}`,
    authorization_servers: [oauthIssuer()],
    scopes_supported: ['openid', 'email', 'profile'],
    bearer_methods_supported: ['header'],
    resource_name: 'AgentResources'
  });
});

module.exports = { router, protectedResourceMetadataUrl };
