// agent/grants.js — local grants file for the stdio server. Not imported by the App.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const model = require('./grants-model');

function homeDir() {
  if (process.env.MT_AGENT_HOME) return process.env.MT_AGENT_HOME;
  return path.join(os.homedir(), '.belliedmonkey', 'agent');
}

function grantsFile() {
  return path.join(homeDir(), 'grants.json');
}

function loadGrants(file) {
  const p = file || grantsFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const device = parsed && parsed.device && typeof parsed.device === 'object' ? parsed.device : {};
    const assistants = parsed && parsed.assistants && typeof parsed.assistants === 'object' ? parsed.assistants : {};
    return { device: Object.assign({}, device), assistants: Object.assign({}, assistants) };
  } catch (_) {
    return model.emptyGrants();
  }
}

function saveGrants(grants, file) {
  const p = file || grantsFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = JSON.stringify({
    device: grants.device || {},
    assistants: grants.assistants || {},
  });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, p);
}

module.exports = Object.assign({ homeDir, grantsFile, loadGrants, saveGrants }, model);
