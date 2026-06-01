#!/usr/bin/env node

/**
 * Shows the most recent memories written to the LIVE neo-brain (`memories`).
 *
 * NOTE: previously read the legacy `flowstate_activities` table (parked since the neo-brain
 * migration), which always returned "0 synced". Now reads NEO_BRAIN_URL / `memories` so it
 * reflects what the fleet is actually writing right now.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEO_BRAIN_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const LIMIT = parseInt(process.argv[2], 10) || 10;

async function checkLatestActivities() {
    try {
        const { data, error } = await supabase
            .from('memories')
            .select('created_at, category, source, agent:metadata->>agent, content')
            .order('created_at', { ascending: false })
            .limit(LIMIT);

        if (error) {
            console.error('Error:', error.message);
            return;
        }

        console.log(`🧠 ${data.length} most recent neo-brain memories\n`);
        data.forEach((m, idx) => {
            const when = (m.created_at || '').replace('T', ' ').slice(0, 16);
            const snippet = (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);
            console.log(`${String(idx + 1).padStart(2)}. ${when}  [${m.category || '?'}]  src=${m.source || '?'}${m.agent ? ` agent=${m.agent}` : ''}`);
            console.log(`    ${snippet}${snippet.length >= 90 ? '…' : ''}\n`);
        });
    } catch (err) {
        console.error('Failed:', err.message || err);
    }
}

checkLatestActivities();
