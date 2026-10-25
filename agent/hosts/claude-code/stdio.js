#!/usr/bin/env node
'use strict';
// H1 packaging launcher for Claude Code and Codex.
//
// This file does not declare tools, receipts, or failure codes.
// It loads the W2 stdio kernel at agent/mcp-stdio.js in this process.
// Local stdio is the daily server. A remote MCP is not published.
const path = require('path');

const kernel = path.join(__dirname, '..', '..', 'mcp-stdio.js');
require(kernel);
