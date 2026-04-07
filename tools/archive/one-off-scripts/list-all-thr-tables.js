const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  'https://ftbtsxlujsnobujwekwx.supabase.co',
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function listAllTHRTables() {
  console.log('📋 LISTING ALL TABLES IN THR DATABASE\n');
  console.log('='.repeat(60));

  try {
    // Direct query to get all public tables
    const { data, error } = await supabase
      .rpc('get_all_tables', {
        schema_name: 'public'
      });

    if (error) {
      // If RPC doesn't exist, try direct query
      const { data: tables, error: tableError } = await supabase
        .from('thr_employees')
        .select('id')
        .limit(1);

      if (!tableError) {
        console.log('✅ Connected to database. Let me check tables differently...\n');
        
        // List known THR tables
        const knownTables = [
          'thr_employees',
          'thr_organizations', 
          'thr_departments',
          'thr_positions',
          'thr_leaves',
          'thr_leave_types',
          'thr_leave_balances',
          'thr_claims',
          'thr_claim_types',
          'thr_claim_receipts',
          'thr_payroll',
          'thr_payroll_items',
          'thr_allowances',
          'thr_deductions',
          'thr_documents',
          'thr_notifications',
          'thr_activity_logs',
          'thr_settings'
        ];

        console.log('Checking known THR tables:');
        for (const tableName of knownTables) {
          try {
            const { count, error } = await supabase
              .from(tableName)
              .select('*', { count: 'exact', head: true });
            
            if (!error) {
              console.log(`✅ ${tableName} - EXISTS (${count} records)`);
            } else {
              console.log(`❌ ${tableName} - NOT FOUND`);
            }
          } catch (e) {
            console.log(`❌ ${tableName} - ERROR`);
          }
        }

        // Check specifically for messaging-related tables
        console.log('\nChecking potential messaging tables:');
        const messagingTables = [
          'thr_messages',
          'thr_conversations', 
          'thr_user_messages',
          'thr_inbox',
          'thr_chats',
          'messages',
          'notifications'
        ];

        for (const tableName of messagingTables) {
          try {
            const { count, error } = await supabase
              .from(tableName)
              .select('*', { count: 'exact', head: true });
            
            if (!error) {
              console.log(`✅ ${tableName} - EXISTS (${count} records)`);
            } else {
              console.log(`❌ ${tableName} - NOT FOUND`);
            }
          } catch (e) {
            console.log(`❌ ${tableName} - NOT FOUND`);
          }
        }
      }
    } else {
      console.log('All public tables:');
      data?.forEach(table => {
        console.log(`- ${table.table_name}`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

listAllTHRTables();