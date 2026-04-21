import { NeoBrain, NEO_SELF_ID, S3StorageAdapter } from '../src/index.js';
import { embedText } from '../src/gemini.js';

// Instantiation smoke — reads from env, won't run without it
if (!process.env.NEO_BRAIN_URL || !(process.env.NEO_BRAIN_ANON_KEY || process.env.NEO_BRAIN_SERVICE_ROLE_KEY)) {
  console.error('Set NEO_BRAIN_URL + NEO_BRAIN_ANON_KEY (or NEO_BRAIN_SERVICE_ROLE_KEY) in env before running.');
  process.exit(1);
}
const brain = new NeoBrain({ agent: 'smoke-test' });
console.log('[1] SDK class instantiated:', typeof brain.search === 'function' ? 'OK' : 'FAIL');
console.log('[2] NEO_SELF_ID export:', NEO_SELF_ID);

// Embedding smoke (real API call if GEMINI_API_KEY present)
if (process.env.GEMINI_API_KEY) {
  const emb = await embedText('smoke test embedding for neo-brain');
  console.log('[3] Gemini embedding dims:', emb ? emb.length : 'NULL');
}

// S3 adapter instantiation (no real creds, just class check)
try {
  new S3StorageAdapter({ endpoint:'https://x', bucket:'b', accessKeyId:'a', secretAccessKey:'s' });
  console.log('[4] S3StorageAdapter class OK');
} catch (e) { console.log('[4] S3 adapter FAIL:', e.message); }

console.log('SDK smoke passed');
