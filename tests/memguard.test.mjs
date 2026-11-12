import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = new URL('../tools/memguard.sh', import.meta.url).pathname;
const meminfo = (gb) => { const f = path.join(mkdtempSync(path.join(tmpdir(), 'mg-')), 'meminfo'); writeFileSync(f, `MemTotal: 125000000 kB\nMemAvailable: ${Math.round(gb * 1048576)} kB\n`); return f; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// async variant: the guarded child must be reaped by the event loop (a blocking spawnSync leaves it a zombie that still looks alive)
const runAsync = (args, mi) => new Promise((resolve) => { const g = spawn('bash', [SCRIPT, ...args], { env: { ...process.env, MEMGUARD_MEMINFO: mi } }); let err = ''; g.stderr.on('data', (d) => (err += d)); g.on('close', (status) => resolve({ status, stderr: err })); });
const run = (args, mi) => spawnSync('bash', [SCRIPT, ...args], { env: { ...process.env, MEMGUARD_MEMINFO: mi }, encoding: 'utf8', timeout: 15000 });

test('kills exactly the named process when MemAvailable drops below the floor, logs it, exits 3', async () => {
  const victim = spawn('sleep', ['60']), bystander = spawn('sleep', ['60']); await new Promise((r) => setTimeout(r, 100));
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'mg-')), 'g.log');
  const r = run(['--min-gb', '20', '--pid', String(victim.pid), '--interval', '0.1', '--log', log], meminfo(5));
  assert.equal(r.status, 3); assert.match(r.stderr, /killed pid \d+ \(only 5 GB available, floor 20 GB\)/);
  await new Promise((res) => setTimeout(res, 200)); assert.equal(alive(victim.pid), false, 'the guarded process is gone'); assert.equal(alive(bystander.pid), true, 'any other process is untouched');
  assert.match(readFileSync(log, 'utf8'), /KILLED pid \d+: only 5 GB available/); bystander.kill('SIGKILL');
});

test('does nothing while memory is fine, and ends cleanly (exit 0) when the guarded process finishes by itself', async () => {
  const p = spawn('sleep', ['1']); await new Promise((r) => setTimeout(r, 50));
  const r = await runAsync(['--min-gb', '20', '--pid', String(p.pid), '--interval', '0.1'], meminfo(80));
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
});

test('refuses bad arguments: a name pattern instead of a PID, a missing floor, an unknown flag', () => {
  const mi = meminfo(80);
  assert.equal(run(['--min-gb', '20', '--pid', 'llama-server'], mi).status, 2);
  assert.equal(run(['--pid', '123'], mi).status, 2);
  assert.equal(run(['--min-gb', '20', '--pid', '123', '--bogus'], mi).status, 2);
  assert.equal(run(['--min-gb', 'abc', '--pid', '123'], mi).status, 2);
});

test('a PID that is already gone is a clean exit, not a kill of something else', () => {
  assert.equal(run(['--min-gb', '20', '--pid', '2147483000', '--interval', '0.1'], meminfo(1)).status, 0);
});
