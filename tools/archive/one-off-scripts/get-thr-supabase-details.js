const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTHRSupabaseDetails() {
  const { data, error } = await supabase
    .from('claude_credentials')
    .select('service, credential_value, description')
    .eq('owner_id', 'neo_todak')
    .eq('service', 'supabase_thr');
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('THR Supabase credentials:');
    data.forEach(cred => {
      if (cred.credential_value.startsWith('https://')) {
        console.log(`\nURL: ${cred.credential_value}`);
      } else if (cred.credential_value.startsWith('eyJ')) {
        console.log(`\nKey (${cred.credential_value.length} chars): ${cred.credential_value.substring(0, 40)}...`);
      }
      if (cred.description) {
        console.log(`Description: ${cred.description}`);
      }
    });
  }
}

getTHRSupabaseDetails();