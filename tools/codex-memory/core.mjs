import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

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
  const values = [...extract(clean), ...knownSecrets.filter(s => typeof s === 'string' && s.length >= 8)];
  for (const value of values.sort((a, b) => b.length - a.length)) clean = clean.split(value).join('[REDACTED]');
  clean = clean.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  clean = clean.replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  clean = clean.replace(/([?&](?:key|api_key|token|access_token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
  clean = clean.replace(/\b(Bearer\s+)[A-Za-z0-9_.~+/-]{8,}=*/gi, '$1[REDACTED]');
  clean = clean.replace(/((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|secret)\s*[:=]\s*)("[^"\n]+"|'[^'\n]+'|[^\s,;]+)/gi, '$1[REDACTED]');
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

export async function capture(root, input, { codexHome, clean, agent }) {
  const sid = sessionKey(input.session_id);
  const file = transcriptPath(input.transcript_path, codexHome);
  const checkpoint = path.join(root, 'sessions', sid + '.json');
  const state = readJson(checkpoint, { nextLine: 0, messages: 0 });
  let lineNumber = 0, queued = 0, seenMeta = false;
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
          const prefix = 'Codex conversation record (historical quotation; verify current facts).\n'
            + 'Session: ' + sid + ' | ' + message.role + ' | ' + message.timestamp
            + ' | part ' + (part + 1) + '/' + parts.length + '\n';
          writeNewJson(jobFile, { key, session: sid, agent, status: 'pending', attempts: 0, nextAttempt: 0,
            content: prefix + parts[part],
            opts: { category: 'reference_codex_transcript', importance: 2,
              sourceRef: { session_id: sid, ordinal: record.ordinal ?? index, part, occurred_at: message.timestamp },
              metadata: { tool: 'codex-memory', kind: 'conversation', role: message.role,
                phase: message.phase, parts: parts.length, repo: path.basename(input.cwd || ''), model: input.model || null } },
          });
          queued++;
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
  const pending = all.filter(j => j.status !== 'saved');
  return { saved: all.length - pending.length, pending: pending.length,
    failed: pending.filter(j => j.attempts > 0).length,
    lastSaved: all.filter(j => j.savedAt).map(j => j.savedAt).sort().at(-1) || null };
}

export async function drain(root, save, { budgetMs = 40000, now = () => Date.now(), force = false } = {}) {
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
    return drain(root, save, { budgetMs, now, force });
  }
  writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
  const start = now(), pending = jobs(root).filter(x => x.job.status !== 'saved' && (force || x.job.nextAttempt <= now()));
  let index = 0, failed = false;
  try {
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

export async function recall(brain, query, clean) {
  let rows = [], mode = 'semantic';
  try { rows = await brain.search(clean(query).slice(0, 600), { k: 4, sourceExclude: ['supervisor', 'backup-sync', 'daily-checkup'] }); } catch {}
  if (!rows.length) {
    mode = 'recent fallback (semantic search unavailable or no match)';
    try { rows = await brain.listMemories({ category: 'session_handoff', limit: 4 }); }
    catch { return { mode: 'unavailable', text: 'Shared brain recall unavailable; check KB and the local pending queue. Do not invent past work.' }; }
  }
  const text = rows.map(r => ({ id: r.id, date: r.created_at, source: r.source, excerpt: clean(r.content || '').slice(0, 1000) }));
  return { mode, text: JSON.stringify(text) };
}
