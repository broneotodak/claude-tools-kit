import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { TRANSCRIPT_SOURCE, TRANSCRIPT_CATEGORY, TRANSCRIPT_DAYS, SESSION_CHUNK_LIMIT, MESSAGE_CHUNK_LIMIT,
  listScopedHandoffs } from '../../packages/memory/src/continuity.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const sessionKey = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('invalid session id');
  return value;
};
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error('local state unreadable'); }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export function writeNewJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  writeJson(temp, value);
  try { fs.linkSync(temp, file); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { fs.unlinkSync(temp); }
}

export function redact(text, extract, knownSecrets = []) {
  let clean = String(text);
  // Tool output is never captured. Also suppress pasted dotenv content, including
  // innocuous-looking settings whose values may disclose infrastructure.
  clean = clean.replace(/```(?:dotenv|env)\b[^\n]*\n[\s\S]*?```/gi, '[REDACTED ENV FILE]');
  clean = clean.replace(/[^\n]*\.env(?:\.[\w-]+)?[^\n]*\n\s*```[^\n]*\n[\s\S]*?```/gi, '[REDACTED ENV FILE]');
  clean = clean.replace(/^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=.*$/gm, '[REDACTED ENV ASSIGNMENT]');
  const values = [...extract(clean), ...knownSecrets.filter(s => typeof s === 'string' && s.length >= 8)];
  for (const value of values.sort((a, b) => b.length - a.length)) clean = clean.split(value).join('[REDACTED]');
  clean = clean.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  clean = clean.replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  clean = clean.replace(/([?&](?:key|api_key|token|access_token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
  clean = clean.replace(/\b(Bearer\s+)[A-Za-z0-9_.~+/-]{8,}=*/gi, '$1[REDACTED]');
  clean = clean.replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|secret)\s*[:=]\s*)("[^"\n]+"|'[^'\n]+'|[^\s,;]+)/gi, '$1[REDACTED]');
  clean = clean.replace(/(["']?([a-zA-Z_][\w.-]*)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/g,
    (whole, label, key) => /password|passwd|secret|token|apikey|servicerole|authorization/i.test(key.replace(/[^a-z]/gi, ''))
      ? label + '[REDACTED]' : whole);
  return clean;
}

// Only actual visible messages. Never serialize reasoning, tool I/O, developer
// instructions, compaction summaries or the replay history inside compacted.
export function visibleMessage(record) {
  const p = record?.payload;
  if (record.type !== 'response_item' || p?.type !== 'message') return null;
  if (!['user', 'assistant'].includes(p.role)) return null;
  if (p.role === 'assistant' && p.phase && !['commentary', 'final_answer', 'final'].includes(p.phase)) return null;
  const parts = Array.isArray(p.content) ? p.content : [];
  const text = parts.filter(x => ['input_text', 'output_text', 'text'].includes(x.type) && typeof x.text === 'string')
    .map(x => x.text).join('\n');
  if (!text.trim()) return null;
  if (p.role === 'user' && /^\s*(?:<environment_context>|<turn_aborted>|# AGENTS\.md instructions|<INSTRUCTIONS>|<permissions instructions>)/.test(text)) return null;
  return { role: p.role, phase: p.phase || null, text, timestamp: record.timestamp };
}

export function chunks(text, size = 1450) {
  const chars = Array.from(text), result = [];
  for (let i = 0; i < chars.length; i += size) result.push(chars.slice(i, i + size).join(''));
  return result;
}

export function transcriptPath(inputPath, codexHome) {
  const candidate = fs.realpathSync(inputPath);
  const allowed = ['sessions', 'archived_sessions'].some(dir => {
    const base = path.join(fs.realpathSync(codexHome), dir) + path.sep;
    return candidate.startsWith(base);
  });
  if (!allowed || !candidate.endsWith('.jsonl') || !fs.statSync(candidate).isFile()) throw new Error('transcript path not allowed');
  return candidate;
}

export function enqueuePointer(root, input) {
  const sid = sessionKey(input.session_id);
  if (typeof input.transcript_path !== 'string') throw new Error('transcript not available');
  // Small, durable write only: SessionEnd/Interrupt get at most three seconds.
  writeJson(path.join(root, 'requests', sid + '.json'), {
    session_id: sid, transcript_path: input.transcript_path,
    cwd: input.cwd || null, model: input.model || null,
  });
}

export async function capture(root, input, options) {
  const lock = path.join(root, 'capture-locks', sessionKey(input.session_id));
  return withLocalLock(lock, () => captureLocked(root, input, options));
}

export async function withLocalLock(lock, run) {
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = readJson(path.join(lock, 'owner.json'), null);
    if (!owner && Date.now() - fs.statSync(lock).mtimeMs < 3000) return { busy: true };
    if (owner) {
      try { process.kill(owner.pid, 0); return { busy: true }; } catch (err) { if (err.code !== 'ESRCH') return { busy: true }; }
    }
    fs.rmSync(lock, { recursive: true });
    return withLocalLock(lock, run);
  }
  writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
  try { return await run(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function captureLocked(root, input, { codexHome, clean, agent, now = Date.now }) {
  const sid = sessionKey(input.session_id);
  const file = transcriptPath(input.transcript_path, codexHome);
  const checkpoint = path.join(root, 'sessions', sid + '.json');
  const state = readJson(checkpoint, { nextLine: 0, messages: 0 });
  let allocated = jobs(root).filter(({ job }) => job.session === sid && isTranscript(job) && job.status !== 'local-only').length;
  let lineNumber = 0, queued = 0, seenMeta = false, turnContext = {};
  const stat = fs.statSync(file);
  if (state.file === file && state.bytes === stat.size) return { ...state, queued };
  // Process only complete lines; a concurrent transcript append can be partial.
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let hasTrailingNewline = false;
  if (stat.size) {
    const fd = fs.openSync(file, 'r'), tail = Buffer.alloc(1);
    try { fs.readSync(fd, tail, 0, 1, stat.size - 1); hasTrailingNewline = tail[0] === 10; }
    finally { fs.closeSync(fd); }
  }
  try {
    for await (const line of lines) {
      const index = lineNumber++;
      let record;
      try { record = JSON.parse(line); }
      catch { throw new Error('transcript incomplete or format changed; checkpoint retained'); }
      if (record.type === 'session_meta') {
        const id = record.payload?.id || record.payload?.session_id;
        if (id !== sid) throw new Error('transcript session mismatch');
        seenMeta = true;
      }
      if (record.type === 'turn_context') turnContext = record.payload || {};
      if (index < state.nextLine) continue;
      if (!seenMeta) throw new Error('unsupported transcript: missing session metadata');
      const message = visibleMessage(record);
      if (message) {
        const content = clean(message.text);
        const parts = chunks(content);
        for (let part = 0; part < parts.length; part++) {
          const key = ['codex-chat-v1', sid, record.ordinal ?? index, part].join(':');
          const jobFile = path.join(root, 'outbox', hash(key) + '.json');
          if (fs.existsSync(jobFile)) continue;
          const occurred = Date.parse(message.timestamp);
          const reason = !Number.isFinite(occurred) || occurred < now() - TRANSCRIPT_DAYS * 86400000 ? 'expired or invalid timestamp'
            : part >= MESSAGE_CHUNK_LIMIT ? 'message cap' : allocated >= SESSION_CHUNK_LIMIT ? 'session cap' : null;
          if (reason) {
            writeNewJson(jobFile, { key, session: sid, agent, status: 'local-only', reason, kind: 'conversation' });
            continue;
          }
          const prefix = 'Codex conversation record (historical quotation; verify current facts).\n'
            + 'Session: ' + sid + ' | ' + message.role + ' | ' + message.timestamp
            + ' | part ' + (part + 1) + '/' + parts.length + '\n';
          writeNewJson(jobFile, { key, session: sid, agent, status: 'pending', attempts: 0, nextAttempt: 0,
            content: prefix + parts[part],
            opts: { category: TRANSCRIPT_CATEGORY, source: TRANSCRIPT_SOURCE, importance: 2,
              sourceRef: { session_id: sid, ordinal: record.ordinal ?? index, part, occurred_at: message.timestamp },
              metadata: { tool: 'codex-memory', kind: 'conversation', role: message.role,
                writer_agent: agent, retention_days: TRANSCRIPT_DAYS,
                phase: message.phase, parts: parts.length,
                session_directory: path.basename(turnContext.cwd || input.cwd || ''),
                model: turnContext.model || null } },
          });
          queued++; allocated++;
        }
        state.messages++;
      }
      state.nextLine = lineNumber;
    }
    if (!hasTrailingNewline && stat.size) throw new Error('transcript append in progress; checkpoint retained');
    if (lineNumber < state.nextLine) throw new Error('transcript shrank; checkpoint retained');
    state.file = file; state.bytes = stat.size; state.capturedAt = new Date().toISOString();
    writeJson(checkpoint, state);
    return { ...state, queued };
  } finally { lines.close(); stream.destroy(); }
}

export function jobs(root) {
  const dir = path.join(root, 'outbox');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
    const file = path.join(dir, n);
    return { file, job: readJson(file) };
  });
}
export function status(root, sid) {
  const all = jobs(root).map(x => x.job).filter(j => !sid || j.session === sid);
  const pending = all.filter(j => j.status === 'pending');
  return { saved: all.filter(j => j.status === 'saved').length, pending: pending.length,
    localOnly: all.filter(j => j.status === 'local-only').length,
    failed: pending.filter(j => j.attempts > 0).length,
    lastSaved: all.filter(j => j.savedAt).map(j => j.savedAt).sort().at(-1) || null };
}

const isTranscript = job => job.key?.startsWith('codex-chat-v1:')
  || job.opts?.category === TRANSCRIPT_CATEGORY || job.kind === 'conversation';

// Upgrade legacy queued jobs before any network write. Stable writer identity and
// keys preserve remote UUIDs even when the source label changes.
export function enforcePendingPolicy(root, now = Date.now()) {
  const all = jobs(root), used = new Map();
  for (const { job } of all) if (isTranscript(job) && job.status === 'saved') used.set(job.session, (used.get(job.session) || 0) + 1);
  const pending = all.filter(({ job }) => isTranscript(job) && job.status === 'pending')
    .sort((a, b) => String(a.job.opts?.sourceRef?.occurred_at).localeCompare(String(b.job.opts?.sourceRef?.occurred_at)) || a.job.key.localeCompare(b.job.key));
  for (const { file, job } of pending) {
    const occurred = Date.parse(job.opts?.sourceRef?.occurred_at);
    const reason = !Number.isFinite(occurred) || occurred < now - TRANSCRIPT_DAYS * 86400000 ? 'expired or invalid timestamp'
      : job.opts?.sourceRef?.part >= MESSAGE_CHUNK_LIMIT ? 'message cap'
      : (used.get(job.session) || 0) >= SESSION_CHUNK_LIMIT ? 'session cap' : null;
    if (reason) {
      const { content, opts, ...receipt } = job;
      writeJson(file, { ...receipt, status: 'local-only', reason, kind: 'conversation' });
    } else {
      used.set(job.session, (used.get(job.session) || 0) + 1);
      writeJson(file, { ...job, opts: { ...job.opts, source: TRANSCRIPT_SOURCE,
        metadata: { ...job.opts.metadata, writer_agent: job.agent, retention_days: TRANSCRIPT_DAYS } } });
    }
  }
}

export async function drain(root, save, { budgetMs = 40000, now = () => Date.now(), force = false, handoffOnly = false } = {}) {
  const lock = path.join(root, 'sync.lock');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = readJson(path.join(lock, 'owner.json'), null);
    if (!owner) {
      if (Date.now() - fs.statSync(lock).mtimeMs < 3000) return { busy: true };
    } else {
      try { process.kill(owner.pid, 0); return { busy: true }; } catch (err) { if (err.code !== 'ESRCH') return { busy: true }; }
    }
    fs.rmSync(lock, { recursive: true });
    return drain(root, save, { budgetMs, now, force, handoffOnly });
  }
  writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
  try {
    if (!handoffOnly) enforcePendingPolicy(root);
    const start = now(), pending = jobs(root).filter(x => x.job.status === 'pending'
      && (!handoffOnly || x.job.opts?.category === 'session_handoff') && (force || x.job.nextAttempt <= now()));
    let index = 0, failed = false;
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (index < pending.length && now() - start < budgetMs && !failed) {
        const { file, job } = pending[index++];
        try {
          const result = await save(job);
          if (!result?.verified || !result?.embedded || !result.id) throw new Error('unverified write');
          const { content, opts, ...receipt } = job;
          writeJson(file, { ...receipt, status: 'saved', id: result.id, savedAt: new Date().toISOString() });
        } catch {
          // Retain payload for retry; never persist an exception with a URL/key.
          const attempts = job.attempts + 1;
          writeJson(file, { ...job, attempts, nextAttempt: now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts - 1, 7)),
            error: 'Brain write or verification failed; retained locally.' });
          failed = true; // circuit break this invocation; later hooks retry.
        }
      }
    }));
    return status(root);
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

export const RECALL_EXCLUSIONS = Object.freeze(['codex-transcript', 'wa-primary', 'wa-primary-media',
  'nclaw_whatsapp_conversation', 'siti-wa', 'wa-chat-importer', 'siti_group_summarizer',
  'supervisor', 'backup-sync', 'daily-checkup']);

export function latestHandoff(rows, clean) {
  rows = rows.filter(row => !RECALL_EXCLUSIONS.includes(row.source));
  if (!rows.length) return null;
  const newest = [...rows].sort((a, b) => String(b.metadata?.handoff_at || b.created_at).localeCompare(String(a.metadata?.handoff_at || a.created_at)))[0];
  const group = newest.metadata?.handoff_id;
  // Legacy handoffs lack a group ID. Select the contiguous part sequence ending
  // in the newest batch (parts are inserted concurrently, never timestamp-sort).
  const expected = newest.metadata?.parts || Number(newest.content?.match(/\| part \d+\/(\d+)/)?.[1]) || 1;
  let parts = rows.filter(row => group ? row.metadata?.handoff_id === group
    : !row.metadata?.handoff_id && row.source_ref?.session_id === newest.source_ref?.session_id
      && Math.abs(Date.parse(row.created_at) - Date.parse(newest.created_at)) < 120000);
  const seen = new Map();
  for (const row of parts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const part = row.source_ref?.part ?? 0;
    if (!seen.has(part) && part < expected) seen.set(part, row);
  }
  parts = [...seen.values()].sort((a, b) => (a.source_ref?.part || 0) - (b.source_ref?.part || 0));
  const full = parts.map(row => clean(row.content || '')).join('\n\n');
  return { ids: parts.map(row => row.id), source: newest.source, date: newest.metadata?.handoff_at || newest.created_at,
    complete: !!group && parts.length === expected, legacyGrouping: !group,
    excerpt: full.slice(0, 5400), truncated: full.length > 5400 };
}

export async function recall(brain, query, clean, scope = {}) {
  if (scope.repo) {
    try {
      const handoff = latestHandoff(await listScopedHandoffs(brain, scope), clean);
      if (handoff) return { mode: 'project handoff', text: JSON.stringify([handoff]) };
    } catch { /* Semantic search can still work when the scoped read is down. */ }
  }
  let rows = [], mode = 'semantic';
  try { rows = await brain.search(clean(query).slice(0, 600), { k: 8, sourceExclude: [...RECALL_EXCLUSIONS] }); } catch {}
  rows = rows.filter(row => row.category !== TRANSCRIPT_CATEGORY && !RECALL_EXCLUSIONS.includes(row.source)).slice(0, 4);
  if (!rows.length) {
    return { mode: 'unavailable', text: 'No relevant handoff or curated match available. Check KB and the current session local history; do not invent past work.' };
  }
  const text = rows.map(r => ({ id: r.id, date: r.created_at, source: r.source, excerpt: clean(r.content || '').slice(0, 1000) }));
  return { mode, text: JSON.stringify(text) };
}
