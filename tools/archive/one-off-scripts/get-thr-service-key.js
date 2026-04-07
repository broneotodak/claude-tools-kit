const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTHRServiceKey() {
  const { data, error } = await supabase
    .from('claude_credentials')
    .select('credential_value')
    .eq('owner_id', 'neo_todak')
    .eq('service', 'supabase_thr')
    .eq('description', 'THR Supabase service role key')
    .single();
    
  if (error) {
    console.error('Error:', error);
  } else {
    // Save to env file for THR bucket check
    const fs = require('fs');
    const envContent = `THR_SERVICE_KEY=${data.credential_value}\n`;
    fs.writeFileSync('.env.thr', envContent);
    console.log('THR service key saved to .env.thr');
  }
}

getTHRServiceKey();