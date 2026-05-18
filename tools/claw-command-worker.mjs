#!/usr/bin/env node
// claw-command-worker.mjs
// Long-running launchd service. Drains `agent_commands` rows where to_agent='claw-mac'.
// Uses claim_agent_command() / complete_agent_command() / fail_agent_command_transient() RPCs.
// v2 handlers:
//   - run_ollama_prompt  — local Ollama inference
//   - browser_act        — ClawBrowserSession.act() (FB + IG only in v1 allowlist)
// Unknown commands → capability_missing.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const AGENT_NAME = 'claw-mac';
const POLL_EMPTY_MS = 2000;
const POLL_BUSY_MS = 200;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// ── env loader (shares format with claw-heartbeat.js) ──────────────
const envPath = process.env.NEO_BRAIN_ENV_PATH
  || `${homedir()}/.openclaw/secrets/neo-brain.env`;

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=');
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
      .filter(Boolean)
  );
} catch (e) {
  console.error(`[worker] failed to read ${envPath}: ${e.message}`);
  process.exit(1);
}

const SUPABASE_URL = fileEnv.NEO_BRAIN_URL || process.env.NEO_BRAIN_URL;
const SERVICE_KEY = fileEnv.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[worker] NEO_BRAIN_URL or NEO_BRAIN_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

// ── neo-brain RPC helpers ──────────────────────────────────────────
async function rpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rpc ${fn} ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const claimNext = () => rpc('claim_agent_command', { p_to_agent: AGENT_NAME });
const complete = (id, status, result) =>
  rpc('complete_agent_command', { p_id: id, p_status: status, p_result: result });
const failTransient = (id, result) =>
  rpc('fail_agent_command_transient', { p_id: id, p_result: result });

// ── error class helpers ────────────────────────────────────────────
class CommandError extends Error {
  constructor(errorClass, message, details) {
    super(message);
    this.errorClass = errorClass;
    this.details = details;
  }
}
const invalidPayload = (m, d) => new CommandError('invalid_payload', m, d);
const capabilityMissing = (m, d) => new CommandError('capability_missing', m, d);
const transient = (m, d) => new CommandError('transient', m, d);

// ── command handlers ──────────────────────────────────────────────

async function runOllamaPrompt(payload) {
  const allowedModels = ['qwen3:8b', 'qwen3:14b', 'gemma3:12b'];
  const { model, prompt, max_tokens = 2000, think = false } = payload || {};

  if (!model || typeof model !== 'string') throw invalidPayload('model (string) is required');
  if (!allowedModels.includes(model))
    throw invalidPayload(`model must be one of ${allowedModels.join(', ')}`, { received: model });
  if (!prompt || typeof prompt !== 'string') throw invalidPayload('prompt (string) is required');
  if (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > 32000)
    throw invalidPayload('max_tokens must be integer in [1, 32000]', { received: max_tokens });
  if (typeof think !== 'boolean') throw invalidPayload('think must be boolean when supplied');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        think,
        options: { num_predict: max_tokens },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw transient(`ollama fetch failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    throw capabilityMissing(`ollama model not pulled locally: ${model}`, { body: text });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status >= 500) throw transient(`ollama ${res.status}`, { body: text });
    throw new CommandError('permanent', `ollama ${res.status}`, { body: text });
  }

  const data = await res.json();
  return {
    response: data.response ?? '',
    thinking: data.thinking ?? null,
    model: data.model ?? model,
    tokens_used: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    eval_duration_ms: data.eval_duration ? Math.round(data.eval_duration / 1e6) : null,
    finish_reason: data.done_reason || (data.done ? 'stop' : 'unknown'),
  };
}

// ── browser_act: route an intent to ClawBrowserSession ──────────────
// Phase 5b.1 v1 scope: Facebook + Instagram ONLY. Other sites (TikTok,
// Threads, X, LinkedIn, YouTube, Higgsfield, OpenArt, PromeAI, Kling.ai,
// etc.) deliberately NOT in the allowlist — add each one after its
// profile is logged-in, its golden paths are eval'd, and its overlays
// are understood. Rejecting out-of-scope hosts with capability_missing
// is a feature, not a bug.
const BROWSER_ACT_ALLOWED_HOSTS = new Set([
  'www.facebook.com', 'facebook.com',
  'www.instagram.com', 'instagram.com',
]);

async function browserAct(payload) {
  const { intent, url_context, timeout_ms, with_screenshot = false, vars = {} } = payload || {};

  if (!intent || typeof intent !== 'string')
    throw invalidPayload('intent (string) is required');
  if (!url_context || typeof url_context !== 'string')
    throw invalidPayload('url_context (string) is required');
  if (timeout_ms !== undefined && (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 300_000))
    throw invalidPayload('timeout_ms must be integer ms in [1000, 300000] when supplied', { received: timeout_ms });
  if (typeof with_screenshot !== 'boolean')
    throw invalidPayload('with_screenshot must be boolean when supplied', { received: with_screenshot });
  if (vars !== null && (typeof vars !== 'object' || Array.isArray(vars)))
    throw invalidPayload('vars must be a plain object when supplied', { received: vars });

  let host;
  try { host = new URL(url_context).hostname; }
  catch { throw invalidPayload('url_context must be a valid URL', { received: url_context }); }

  if (!BROWSER_ACT_ALLOWED_HOSTS.has(host)) {
    throw capabilityMissing(
      `browser_act not yet enabled for host '${host}' — v1 scope is Facebook + Instagram only`,
      { allowed: [...BROWSER_ACT_ALLOWED_HOSTS], received: host }
    );
  }

  // Dynamic import so a wrapper-level failure doesn't crash the whole worker.
  const { ClawBrowserSession } = await import('./claw-browser-session.mjs');

  let session;
  try {
    session = await ClawBrowserSession.acquire({
      profile: '.gemini/antigravity-browser-profile',
      pinRect: { w: 1440, h: 900 },
    });
  } catch (e) {
    throw transient(`browser acquire failed: ${e.message}`);
  }

  try {
    const r = await session.act({ intent, url_context, timeout_ms, withScreenshot: with_screenshot, vars: vars || {} });
    return {
      layer: r.layer,
      ready: r.ready,
      cache_hit: r.cache_hit,
      url: r.url,
      domain: r.domain,
      duration_ms: r.duration_ms,
      cached_action: r.cached_action || null,
      coached_by: r.coached_by || null,
      action_output: r.action_output ?? null,
      overlay_detected: r.preflight?.overlay_detected ?? null,
      dismissed: r.preflight?.dismissed ?? null,
      overlay_description: r.preflight?.verdict?.overlay_description || null,
      screenshot_media_id: r.screenshot_media_id || null,
      screenshot_url: r.screenshot_url || null,
    };
  } catch (e) {
    if (/window not found|CDP|fetch failed|ECONNREFUSED|net::/i.test(e.message)) {
      throw transient(`browser_act runtime: ${e.message}`);
    }
    throw new CommandError('permanent', `browser_act: ${e.message}`);
  } finally {
    // Graceful detach — Chrome stays alive (persistent launchd service).
    await session.release({ keepAlive: true }).catch(() => {});
  }
}

// Dispatch table. Add commands here as they come online.
const HANDLERS = {
  run_ollama_prompt: runOllamaPrompt,
  browser_act: browserAct,
};

// ── execution wrapper ──────────────────────────────────────────────
async function execute(cmd) {
  const handler = HANDLERS[cmd.command];
  if (!handler) {
    throw capabilityMissing(`command '${cmd.command}' not implemented on ${AGENT_NAME}`, {
      available: Object.keys(HANDLERS),
    });
  }
  return handler(cmd.payload || {});
}

// ── main loop ─────────────────────────────────────────────────────
let shuttingDown = false;
process.on('SIGTERM', () => { shuttingDown = true; console.log('[worker] SIGTERM — draining'); });
process.on('SIGINT',  () => { shuttingDown = true; console.log('[worker] SIGINT — draining'); });

async function processOne() {
  let rows;
  try {
    rows = await claimNext();
  } catch (e) {
    console.error(`[worker] claim error: ${e.message}`);
    return false;
  }
  const cmd = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!cmd) return false;

  const startedAt = Date.now();
  console.log(`[worker] claimed ${cmd.id} command=${cmd.command} from=${cmd.from_agent}`);

  try {
    const result = await execute(cmd);
    await complete(cmd.id, 'done', {
      ...result,
      _meta: { duration_ms: Date.now() - startedAt, worker_version: 'claw-command-worker-v2' },
    });
    console.log(`[worker] done ${cmd.id} in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const errorClass = err.errorClass || 'permanent';
    const body = {
      error: err.message,
      error_class: errorClass,
      details: err.details ?? null,
      _meta: { duration_ms: Date.now() - startedAt, worker_version: 'claw-command-worker-v2' },
    };
    if (errorClass === 'transient') {
      const newStatus = await failTransient(cmd.id, body);
      console.error(`[worker] transient ${cmd.id} → ${newStatus}: ${err.message}`);
    } else {
      await complete(cmd.id, 'failed', body);
      console.error(`[worker] failed ${cmd.id} (${errorClass}): ${err.message}`);
    }
  }
  return true;
}

async function loop() {
  console.log(`[worker] starting — agent=${AGENT_NAME} supabase=${new URL(SUPABASE_URL).host} ollama=${OLLAMA_URL}`);
  while (!shuttingDown) {
    const didWork = await processOne();
    await new Promise(r => setTimeout(r, didWork ? POLL_BUSY_MS : POLL_EMPTY_MS));
  }
  console.log('[worker] exited cleanly');
  process.exit(0);
}

loop().catch(err => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
