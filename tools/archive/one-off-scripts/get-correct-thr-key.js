const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getCorrectTHRKey() {
  // Get THR anon key
  const { data: anonKey } = await supabase
    .from('claude_credentials')
    .select('credential_value')
    .eq('owner_id', 'neo_todak')
    .eq('service', 'supabase_thr')
    .eq('description', 'THR Supabase anon key')
    .single();
    
  if (anonKey) {
    console.log('THR_ANON_KEY=' + anonKey.credential_value);
  }
}

getCorrectTHRKey();