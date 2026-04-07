const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function checkMessagingTables() {
  console.log('🔍 CHECKING EXISTING THR TABLES FOR MESSAGING/NOTIFICATIONS\n');
  console.log('='.repeat(80));
  console.log('Following CTK: Checking all existing tables before creating new ones\n');

  try {
    // Get all tables that might be related to messaging
    const { data: tables } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .ilike('table_name', '%message%')
      .order('table_name');

    console.log('1. Tables with "message" in name:');
    if (tables && tables.length > 0) {
      tables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('   ❌ No tables found with "message"');
    }

    // Check for notification tables
    const { data: notifTables } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .ilike('table_name', '%notif%')
      .order('table_name');

    console.log('\n2. Tables with "notif" in name:');
    if (notifTables && notifTables.length > 0) {
      notifTables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('   ❌ No tables found with "notif"');
    }

    // Check for inbox tables
    const { data: inboxTables } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .ilike('table_name', '%inbox%')
      .order('table_name');

    console.log('\n3. Tables with "inbox" in name:');
    if (inboxTables && inboxTables.length > 0) {
      inboxTables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('   ❌ No tables found with "inbox"');
    }

    // Check for chat/conversation tables
    const { data: chatTables } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .or('table_name.ilike.%chat%,table_name.ilike.%conversation%')
      .order('table_name');

    console.log('\n4. Tables with "chat" or "conversation" in name:');
    if (chatTables && chatTables.length > 0) {
      chatTables.forEach(t => console.log(`   - ${t.table_name}`));
    } else {
      console.log('   ❌ No tables found with "chat" or "conversation"');
    }

    // Check all THR tables to be thorough
    const { data: thrTables } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .ilike('table_name', 'thr_%')
      .order('table_name');

    console.log('\n5. All THR tables (for reference):');
    if (thrTables && thrTables.length > 0) {
      thrTables.forEach(t => console.log(`   - ${t.table_name}`));
    }

    // Check if thr_notifications already exists
    const { data: checkNotif } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'thr_notifications')
      .single();

    if (checkNotif) {
      console.log('\n⚠️  WARNING: thr_notifications table already exists!');
      
      // Get its structure
      const { data: columns } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable')
        .eq('table_schema', 'public')
        .eq('table_name', 'thr_notifications')
        .order('ordinal_position');

      console.log('\nExisting thr_notifications columns:');
      columns?.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
    }

    console.log('\n📌 Summary:');
    console.log('- Need to check if any existing tables before creating new ones');
    console.log('- thr_notifications might already exist');
    console.log('- Should verify schema of any existing tables');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkMessagingTables();