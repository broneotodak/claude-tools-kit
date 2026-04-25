#!/usr/bin/env node
// Live memory counts from neo-brain for the startup banner.
// Output: a single line `TOTAL|PROJECT_COUNT` (PROJECT_COUNT empty if no project arg or General).
// Stays silent on any failure so the banner never hangs or errors out.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const url = process.env.NEO_BRAIN_URL;
const key = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const project = process.argv[2] && process.argv[2] !== 'General' ? process.argv[2] : null;

if (!url || !key) { console.log('|'); process.exit(0); }

const TIMEOUT_MS = 2500;
const timer = setTimeout(() => { console.log('|'); process.exit(0); }, TIMEOUT_MS);

(async () => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(url, key, { auth: { persistSession: false } });

    const totalQ = sb.from('memories').select('*', { count: 'exact', head: true });
    const projQ = project
      ? sb.from('memories').select('*', { count: 'exact', head: true })
          .or(`category.ilike.${project},metadata->>project.eq.${project}`)
      : Promise.resolve({ count: null });

    const [{ count: total }, { count: projCount }] = await Promise.all([totalQ, projQ]);
    clearTimeout(timer);
    console.log(`${total ?? ''}|${projCount ?? ''}`);
  } catch {
    clearTimeout(timer);
    console.log('|');
  }
})();
