// The route-facing game table service, wired to the service-role client for
// link-served reads and LFG roster sync (see services/game-tables/service.js).
const { supabaseAdmin } = require('./_base');
const repository = require('../services/game-tables/repository');
const { GameTableService } = require('../services/game-tables/service');

const gameTables = new GameTableService(repository, { systemClient: supabaseAdmin });

module.exports = { gameTables };
