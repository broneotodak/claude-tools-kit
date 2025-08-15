const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixTHRDatabaseConfusion() {
  console.log('=== Fixing THR Database Confusion ===\n');
  
  // First, let's see what we have
  console.log('1. Checking existing THR credentials...');
  const { data: existing, error: fetchError } = await supabase
    .from('claude_credentials')
    .select('*')
    .eq('owner_id', 'neo_todak')
    .or('service.eq.supabase_thr,service.eq.supabase_thr_url,service.eq.supabase_thr_anon,service.eq.google_oauth_thr');
    
  if (fetchError) {
    console.error('Error fetching:', fetchError);
    return;
  }
  
  console.log('\nExisting THR credentials:');
  existing.forEach(cred => {
    const value = cred.credential_value.startsWith('http') 
      ? cred.credential_value 
      : cred.credential_value.substring(0, 40) + '...';
    console.log(`- ${cred.service}: ${value}`);
    if (cred.description) console.log(`  Description: ${cred.description}`);
  });
  
  // Delete old/wrong THR database references
  console.log('\n2. Cleaning up wrong database references...');
  
  const wrongUrls = existing.filter(c => 
    c.credential_value.includes('aiazdgohytygipiddbtp')
  );
  
  if (wrongUrls.length > 0) {
    console.log(`Found ${wrongUrls.length} wrong URL entries to remove`);
    for (const wrong of wrongUrls) {
      const { error } = await supabase
        .from('claude_credentials')
        .delete()
        .eq('id', wrong.id);
      
      if (!error) {
        console.log(`✅ Removed wrong entry: ${wrong.service}`);
      }
    }
  }
  
  // Add/Update correct THR database info
  console.log('\n3. Adding correct THR database credentials...');
  
  const correctCredentials = [
    {
      owner_id: 'neo_todak',
      service: 'supabase_thr_url',
      credential_value: 'https://ftbtsxlujsnobujwekwx.supabase.co',
      description: 'THR Supabase URL (ATLAS/THR shared database)',
      category: 'database',
      metadata: {
        project: 'THR',
        environment: 'production',
        note: 'This is the CORRECT database for THR - shared with ATLAS'
      }
    }
  ];
  
  for (const cred of correctCredentials) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('claude_credentials')
      .select('id')
      .eq('owner_id', cred.owner_id)
      .eq('service', cred.service)
      .single();
      
    if (existing) {
      // Update
      const { error } = await supabase
        .from('claude_credentials')
        .update({
          credential_value: cred.credential_value,
          description: cred.description,
          metadata: cred.metadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
        
      if (!error) {
        console.log(`✅ Updated ${cred.service}`);
      }
    } else {
      // Insert
      const { error } = await supabase
        .from('claude_credentials')
        .insert(cred);
        
      if (!error) {
        console.log(`✅ Added ${cred.service}`);
      }
    }
  }
  
  // Save to memory
  console.log('\n4. Saving to memory...');
  const memory = {
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_code',
    category: 'CTK',
    memory_type: 'critical_fix',
    content: 'Fixed THR database confusion. THR uses ftbtsxlujsnobujwekwx.supabase.co (ATLAS/THR shared), NOT aiazdgohytygipiddbtp (old THR). Updated credentials and CTK to prevent future confusion.',
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: 'THR',
      activity_type: 'configuration_fix',
      flowstate_ready: true,
      critical_info: {
        correct_database: 'ftbtsxlujsnobujwekwx.supabase.co',
        wrong_database: 'aiazdgohytygipiddbtp.supabase.co',
        reason: 'THR shares database with ATLAS since migration'
      }
    },
    importance: 9
  };
  
  const { data: memData, error: memError } = await supabase
    .from('claude_desktop_memory')
    .insert(memory)
    .select();
    
  if (!memError) {
    console.log(`✅ Saved to memory (ID: ${memData[0].id})`);
  }
  
  console.log('\n✅ THR database confusion fixed!');
  console.log('\nCorrect THR Database: https://ftbtsxlujsnobujwekwx.supabase.co');
  console.log('This is the ATLAS/THR shared database - use this for all THR operations');
}

fixTHRDatabaseConfusion();