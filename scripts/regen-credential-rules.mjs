#!/usr/bin/env node
// regen-credential-rules.mjs
//
// Regenerates packages/memory/src/credential-rules.json — the single source
// of credential-detection patterns for the @todak/memory SDK.
//
// Policy (decided 2026-05-15, Phase S.2 step R):
//   - Baseline = the gitleaks default ruleset, pinned to GITLEAKS_VERSION.
//   - Keep ONLY prefix-anchored, self-identifying rules: the matched token
//     starts with a >=3-char literal prefix (sk-, ghp_, AKIA, GOCSPX-, ...).
//     These are near-zero false-positive.
//   - DROP contextual/keyword rules (match a generic blob by a nearby
//     keyword) and generic catch-alls. In an *auto-redaction* tool those
//     would rewrite legitimate memory content. Entropy thresholds are not
//     ported for the same reason — the literal prefix is the precision.
//   - MERGE our 23 hand-verified CTK custom rules (incl. Supabase sbp_ /
//     sb_secret_, which gitleaks has no rule for).
//
// Usage:  node scripts/regen-credential-rules.mjs [--write]
//   without --write: prints the audit only (dry, no file changes).

import { writeFileSync } from 'node:fs';

const GITLEAKS_VERSION = 'v8.30.1';
const GITLEAKS_URL = `https://raw.githubusercontent.com/gitleaks/gitleaks/${GITLEAKS_VERSION}/config/gitleaks.toml`;
const OUT_PATH = new URL('../packages/memory/src/credential-rules.json', import.meta.url);
const WRITE = process.argv.includes('--write');

// ── CTK custom rules — hand-verified, always retained ───────────────
// These backstop the gitleaks set: Supabase has no gitleaks rule, and our
// existing 21 patterns are a known-good verified subset.
const CTK_CUSTOM_RULES = [
  { id: 'ctk-anthropic-api-key',        regex: 'sk-ant-api03-[A-Za-z0-9_-]{20,}',            description: 'Anthropic API key' },
  { id: 'ctk-anthropic-admin-key',      regex: 'sk-ant-admin01-[A-Za-z0-9_-]{20,}',          description: 'Anthropic admin API key' },
  { id: 'ctk-openai-project-key',       regex: 'sk-proj-[A-Za-z0-9_-]{30,}',                 description: 'OpenAI project API key' },
  { id: 'ctk-github-token',             regex: '(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}',       description: 'GitHub token (classic / oauth / app / refresh)' },
  { id: 'ctk-github-fine-grained-pat',  regex: 'github_pat_[A-Za-z0-9_]{30,}',               description: 'GitHub fine-grained PAT' },
  { id: 'ctk-gitlab-pat',               regex: 'glpat-[A-Za-z0-9_-]{20,}',                   description: 'GitLab personal access token' },
  { id: 'ctk-slack-token',              regex: 'xox[bpars]-[A-Za-z0-9-]{10,}',               description: 'Slack token' },
  { id: 'ctk-aws-access-key',           regex: '(?:AKIA|ASIA)[0-9A-Z]{16}',                  description: 'AWS access key id' },
  { id: 'ctk-jwt',                      regex: 'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', description: 'JWT (Supabase / n8n / generic)' },
  { id: 'ctk-newrelic-key',             regex: 'NRAK-[A-Z0-9]{20,}',                         description: 'New Relic API key' },
  { id: 'ctk-pem-block',                regex: '-----BEGIN[^-]+-----',                       description: 'PEM private-key block header' },
  { id: 'ctk-google-oauth-secret',      regex: 'GOCSPX-[A-Za-z0-9_-]{20,}',                  description: 'Google OAuth client secret' },
  { id: 'ctk-google-api-key',           regex: 'AIza[A-Za-z0-9_-]{35}',                      description: 'Google API key' },
  { id: 'ctk-stripe-live-secret',       regex: 'sk_live_[A-Za-z0-9]{24,}',                   description: 'Stripe live secret key' },
  { id: 'ctk-stripe-restricted-key',    regex: 'rk_live_[A-Za-z0-9]{24,}',                   description: 'Stripe restricted key' },
  { id: 'ctk-twilio-account-sid',       regex: 'AC[a-f0-9]{32}',                             description: 'Twilio account SID' },
  { id: 'ctk-twilio-api-key',           regex: 'SK[a-f0-9]{32}',                             description: 'Twilio API key' },
  { id: 'ctk-sendgrid-key',             regex: 'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}', description: 'SendGrid API key' },
  { id: 'ctk-huggingface-token',        regex: 'hf_[A-Za-z0-9]{34}',                         description: 'HuggingFace access token' },
  { id: 'ctk-npm-token',                regex: 'npm_[A-Za-z0-9]{36}',                        description: 'npm access token' },
  { id: 'ctk-digitalocean-token',       regex: 'dop_v1_[a-f0-9]{64}',                        description: 'DigitalOcean personal access token' },
  // ── new 2026-05-15 (Phase S.2 registry-expansion event #2) ──
  { id: 'ctk-supabase-access-token',    regex: 'sbp_[a-f0-9]{40}',                           description: 'Supabase personal/management access token' },
  { id: 'ctk-supabase-secret-key',      regex: 'sb_secret_[A-Za-z0-9_-]{20,}',               description: 'Supabase secret API key (new format)' },
];

// ── minimal gitleaks.toml parser ────────────────────────────────────
// Line-based. gitleaks emits one regex per line in '''triple quotes'''.
// Captures id/description/regex/secretGroup per [[rules]] block; ignores
// content inside [[rules.allowlists]] / [rules.allowlist] sub-tables.
function parseGitleaksToml(text) {
  const rules = [];
  let cur = null;
  let section = 'none'; // 'rule' | 'allowlist' | 'none'
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '[[rules]]') {
      if (cur) rules.push(cur);
      cur = {};
      section = 'rule';
      continue;
    }
    if (/^\[\[?rules\.allowlists?\]\]?$/.test(line) || line === '[allowlist]' || line === '[[allowlist]]') {
      section = 'allowlist';
      continue;
    }
    if (section !== 'rule' || !cur) continue;
    let m;
    if ((m = line.match(/^id = "(.*)"$/))) cur.id = m[1];
    else if ((m = line.match(/^description = "(.*)"$/))) cur.description = m[1];
    else if ((m = line.match(/^regex = '''(.*)'''$/))) cur.regex = m[1];
    else if ((m = line.match(/^secretGroup = (\d+)$/))) cur.secretGroup = Number(m[1]);
  }
  if (cur) rules.push(cur);
  return rules.filter((r) => r.id && r.regex);
}

// ── classification: prefix-anchored vs contextual ───────────────────
// A rule is prefix-anchored if, after stripping leading (?i), \b, ^, \A and
// group-openers, the regex begins with a run of >=3 literal chars.
function leadingLiteralRun(regex) {
  let s = regex;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pre of ['(?i)', '\\b', '\\A', '^']) {
      if (s.startsWith(pre)) { s = s.slice(pre.length); changed = true; }
    }
    const g = s.match(/^\((?:\?:|\?P?<[^>]+>)?/);
    if (g && g[0].length) { s = s.slice(g[0].length); changed = true; }
  }
  let run = 0;
  for (const c of s) {
    if (/[A-Za-z0-9_-]/.test(c)) run++;
    else break;
  }
  return run;
}

// ── false-positive probes ───────────────────────────────────────────
// Benign, non-secret strings that must NOT match any kept rule. A rule that
// matches one of these is too loose (e.g. a bare [a-f0-9]{40} alternation
// branch that hits every git SHA) and is dropped regardless of how its
// regex *starts*. This catches "literal-prefix OR bare-blob" alternations
// the leading-literal classifier alone would miss.
const FP_PROBES = [
  'd0392a8f1c2b3e4a5d6c7b8a9e0f1a2b3c4d5e6f',           // 40-hex git SHA
  'd0392a8',                                             // short git SHA
  '550e8400-e29b-41d4-a716-446655440000',                // UUID v4
  '0123456789abcdef0123456789abcdef',                    // 32-hex
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // 64-hex
  'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5',    // base64-ish blob
  'aB3xY7zQ9wE2rT5uI8oP1aS4dF6gH0jK3lZ9xC2vB5nM8qW1eR4', // long random alnum
  'the quick brown fox jumps over the lazy dog 12345',   // prose with digits
  'https://example.com/path/to/resource?query=value123', // a URL
  '/Users/broneotodak/Projects/claude-tools-kit/src',    // a file path
];

// ── explicit rule blocklist ─────────────────────────────────────────
// Rules dropped by id (not by probe). The gitleaks curl-auth-* rules are
// real detections, but they capture the ENTIRE curl command (often 100s of
// chars, including $VAR placeholders) as the match. That's unusable for an
// extract-and-redact tool: it over-redacts, and any memory containing a
// curl command would make redactMemory permanently refuse (the whole-
// command "secret" can never be fully removed). 2026-05-15 Phase S.2.
const RULE_BLOCKLIST = new Set([
  'curl-auth-header',
  'curl-auth-user',
]);

function tripsProbe(jsRegex) {
  for (const probe of FP_PROBES) {
    jsRegex.lastIndex = 0;
    if (jsRegex.test(probe)) return probe;
  }
  return null;
}

function captureGroupCount(regex) {
  let n = 0;
  for (let i = 0; i < regex.length; i++) {
    const c = regex[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { i++; while (i < regex.length && regex[i] !== ']') { if (regex[i] === '\\') i++; i++; } continue; }
    if (c === '(' && regex[i + 1] !== '?') n++;
  }
  return n;
}

// ── Go (RE2) regex → JavaScript RegExp ──────────────────────────────
function goRegexToJs(regex) {
  let r = regex;
  let flags = 'g';
  if (r.includes('(?i)')) { flags += 'i'; r = r.split('(?i)').join(''); }
  r = r.replace(/\(\?P</g, '(?<');
  r = r.replace(/\\A/g, '^').replace(/\\z/g, '$');
  return { source: r, flags };
}

function compileToRule(id, description, goRegex, explicitSecretGroup) {
  const { source, flags } = goRegexToJs(goRegex);
  new RegExp(source, flags); // throws on bad conversion — caller catches
  const sg = explicitSecretGroup != null
    ? explicitSecretGroup
    : (captureGroupCount(source) >= 1 ? 1 : 0);
  return { id, description: description || '', regex: source, flags, secretGroup: sg };
}

// ── main ────────────────────────────────────────────────────────────
console.log(`Fetching gitleaks ${GITLEAKS_VERSION} ruleset…`);
const res = await fetch(GITLEAKS_URL);
if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1); }
const toml = await res.text();

const parsed = parseGitleaksToml(toml);
console.log(`Parsed ${parsed.length} gitleaks rules.`);

const kept = [];
const droppedContextual = [];
const droppedConvFail = [];
const droppedFalsePositive = [];
const droppedBlocklist = [];

for (const r of parsed) {
  if (RULE_BLOCKLIST.has(r.id)) { droppedBlocklist.push(r.id); continue; }
  if (leadingLiteralRun(r.regex) < 3) { droppedContextual.push(r.id); continue; }
  let rule;
  try {
    rule = { ...compileToRule(`gitleaks-${r.id}`, r.description, r.regex, r.secretGroup), source: `gitleaks-${GITLEAKS_VERSION}` };
  } catch (e) {
    droppedConvFail.push(`${r.id}: ${e.message}`);
    continue;
  }
  const probe = tripsProbe(new RegExp(rule.regex, rule.flags));
  if (probe) {
    droppedFalsePositive.push(`${r.id}: matched benign "${probe.slice(0, 24)}…"`);
    continue;
  }
  kept.push(rule);
}

// custom rules (always JS-native already) — must themselves pass the FP probe
const customCompiled = CTK_CUSTOM_RULES.map((r) => {
  const rule = { ...compileToRule(r.id, r.description, r.regex, null), source: 'ctk-custom' };
  const probe = tripsProbe(new RegExp(rule.regex, rule.flags));
  if (probe) {
    console.error(`✗ CTK custom rule ${r.id} matches benign probe "${probe}" — fix the rule`);
    process.exit(1);
  }
  return rule;
});

const allRules = [...customCompiled, ...kept];

// ── audit ───────────────────────────────────────────────────────────
console.log('\n━━ classification audit ━━');
console.log(`  gitleaks parsed:          ${parsed.length}`);
console.log(`  kept (prefix-anchored):   ${kept.length}`);
console.log(`  dropped (blocklist):      ${droppedBlocklist.length}  [${droppedBlocklist.join(', ')}]`);
console.log(`  dropped (contextual):     ${droppedContextual.length}`);
console.log(`  dropped (convert fail):   ${droppedConvFail.length}`);
console.log(`  dropped (false-positive): ${droppedFalsePositive.length}`);
console.log(`  ctk custom rules:         ${customCompiled.length}`);
console.log(`  TOTAL in registry:        ${allRules.length}`);
if (droppedConvFail.length) {
  console.log('\n  conversion failures:');
  for (const d of droppedConvFail) console.log(`    ✗ ${d}`);
}
if (droppedFalsePositive.length) {
  console.log('\n  dropped — matched a benign false-positive probe:');
  for (const d of droppedFalsePositive) console.log(`    ✗ ${d}`);
}
console.log('\n  kept gitleaks rule ids:');
console.log('    ' + kept.map((r) => r.id.replace(`gitleaks-${GITLEAKS_VERSION}`, '').replace('gitleaks-', '')).join(', '));

const out = {
  _meta: {
    generated: new Date().toISOString(),
    gitleaks_version: GITLEAKS_VERSION,
    gitleaks_source: GITLEAKS_URL,
    policy: 'prefix-anchored named-service rules only; contextual/keyword + generic rules excluded; entropy thresholds not ported',
    regen: 'node scripts/regen-credential-rules.mjs --write',
    rule_count: allRules.length,
  },
  rules: allRules,
};

if (WRITE) {
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n✓ wrote ${OUT_PATH.pathname} (${allRules.length} rules)`);
} else {
  console.log('\n(dry run — pass --write to update credential-rules.json)');
}
