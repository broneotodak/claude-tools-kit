const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkMessagingStructure() {
  console.log('🔍 ANALYZING EXISTING MESSAGING TABLE STRUCTURES\n');
  console.log('='.repeat(80));

  const tablesToCheck = [
    'thr_messages',
    'thr_conversations',
    'thr_notifications',
    'thr_user_messages',
    'thr_inbox',
    'thr_chats'
  ];

  for (const tableName of tablesToCheck) {
    console.log(`\n📊 Table: ${tableName}`);
    console.log('-'.repeat(40));

    try {
      // Get one record to see structure
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (!error) {
        if (data && data.length > 0) {
          console.log('Sample record:');
          console.log(JSON.stringify(data[0], null, 2));
        } else {
          console.log('Table exists but is empty. Checking columns...');
          
          // Try to insert and rollback to see structure
          const testData = { test: 'test' };
          const { error: insertError } = await supabase
            .from(tableName)
            .insert(testData);
          
          if (insertError) {
            console.log('Column info from error:', insertError.message);
          }
        }
      } else {
        console.log('Error:', error.message);
      }
    } catch (e) {
      console.log('Failed to analyze:', e.message);
    }
  }

  // Check thr_notifications specifically since it exists
  console.log('\n🔔 Special check for thr_notifications:');
  try {
    // Try to see what columns it expects
    const { error } = await supabase
      .from('thr_notifications')
      .insert({
        recipient_id: '00000000-0000-0000-0000-000000000000',
        type: 'test',
        title: 'test',
        body: 'test'
      });

    if (error) {
      console.log('Expected columns based on error:', error.message);
    }
  } catch (e) {
    console.log('Structure check failed:', e.message);
  }
}

checkMessagingStructure();