#!/usr/bin/env node
// H2 packaging launcher for dsh.
//
// This file does not declare tools, receipts, or failure codes.
// It loads the W2 stdio kernel at agent/mcp-stdio.js in this process.
// Local stdio is the daily server. A remote MCP is not published.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const kernel = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp-stdio.js');
require(kernel);
