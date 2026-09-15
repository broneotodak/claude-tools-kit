#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJson } from './core.mjs';
const home = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const hooksFile = path.join(home, 'hooks.json'), hooks = readJson(hooksFile, null);
if (hooks?.hooks) {
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    hooks.hooks[event] = groups.map(group => ({ ...group,
      hooks: group.hooks.filter(h => !h.statusMessage?.startsWith('CTK Brain:')) })).filter(group => group.hooks.length);
  }
  writeJson(hooksFile, hooks);
}
const agentsFile = path.join(home, 'AGENTS.md');
if (fs.existsSync(agentsFile)) {
  const text = fs.readFileSync(agentsFile, 'utf8');
  const start = text.indexOf('<!-- CTK CODEX CONTINUITY BEGIN -->');
  const endMarker = '<!-- CTK CODEX CONTINUITY END -->', end = text.indexOf(endMarker);
  if (start >= 0 && end >= start) fs.writeFileSync(agentsFile, text.slice(0, start) + text.slice(end + endMarker.length), { mode: 0o600 });
}
console.log('CTK Codex hooks/instructions removed. Local pending data and existing brain memories retained. Restart Codex to reload.');
