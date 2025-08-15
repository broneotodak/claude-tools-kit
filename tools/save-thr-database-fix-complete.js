const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveTHRDatabaseFixComplete() {
  const memory = {
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_code',
    category: 'CTK',
    memory_type: 'critical_context',
    content: 'THR Database Confusion FIXED! THR uses ftbtsxlujsnobujwekwx (ATLAS/THR shared), NOT aiazdgohytygipiddbtp. Updated: credentials, main CLAUDE.md, THR CLAUDE.md, CTK CLAUDE.md. All storage buckets exist: employee-photos, employee-documents, claim-receipts, memos.',
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: 'THR',
      activity_type: 'critical_fix',
      flowstate_ready: true,
      fix_summary: {
        issue: 'CTK was confused about THR database - using old URL',
        resolution: 'Updated all references to correct shared database',
        correct_database: {
          url: 'ftbtsxlujsnobujwekwx.supabase.co',
          description: 'ATLAS/THR shared database'
        },
        wrong_database: {
          url: 'aiazdgohytygipiddbtp.supabase.co',
          description: 'Old THR database - DO NOT USE'
        },
        files_updated: [
          '/Projects/CLAUDE.md',
          '/Projects/THR/CLAUDE.md',
          '/Projects/claude-tools-kit/CLAUDE.md',
          'claude_credentials table'
        ],
        storage_buckets_confirmed: [
          'employee-photos',
          'employee-documents',
          'claim-receipts',
          'memos'
        ]
      }
    },
    importance: 10
  };

  try {
    const { data, error } = await supabase
      .from('claude_desktop_memory')
      .insert(memory)
      .select();

    if (error) {
      console.error('Error:', error);
    } else {
      console.log('✅ THR Database Fix Complete - Saved to Memory!');
      console.log('📝 Memory ID:', data[0].id);
      console.log('\n🎯 Key Points:');
      console.log('- THR uses: ftbtsxlujsnobujwekwx.supabase.co');
      console.log('- This is shared with ATLAS');
      console.log('- All storage buckets exist and are ready');
      console.log('- No more confusion!');
    }
  } catch (err) {
    console.error('Failed:', err);
  }
}

saveTHRDatabaseFixComplete();