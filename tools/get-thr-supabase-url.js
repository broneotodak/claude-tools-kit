const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTHRSupabaseURL() {
  const { data, error } = await supabase
    .from('claude_credentials')
    .select('service, credential_value')
    .eq('owner_id', 'neo_todak')
    .eq('service', 'supabase_thr_url')
    .single();
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('THR Supabase URL:', data.credential_value);
  }
}

getTHRSupabaseURL();