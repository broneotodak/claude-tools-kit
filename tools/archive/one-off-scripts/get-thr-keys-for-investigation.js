const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTHRKeys() {
  const { data } = await supabase
    .from('claude_credentials')
    .select('service, credential_value')
    .eq('owner_id', 'neo_todak')
    .in('service', ['supabase_thr'])
    .eq('description', 'THR Supabase anon key');
    
  if (data && data[0]) {
    console.log('export THR_ANON_KEY="' + data[0].credential_value + '"');
  }
}

getTHRKeys();