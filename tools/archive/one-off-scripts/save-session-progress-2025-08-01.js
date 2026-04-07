const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveSessionProgress() {
  const memory = {
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_code',
    category: 'CTK',
    memory_type: 'session_summary',
    content: 'Session Aug 1 2025: Fixed FlowState memory system, investigated all tables, fixed CTK violations, checked THR status (85% ready). Key work: (1) Disabled broken memory sync, created V16 system prompt, (2) Fixed wrong directory usage, (3) Created credential management tools, saved THR Google Client ID. THR critical issues: missing storage buckets, DB connection nulls. Ready for /compact.',
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: 'CTK',
      activity_type: 'session_end',
      flowstate_ready: true,
      session_date: '2025-08-01',
      major_accomplishments: [
        'Fixed FlowState memory system completely',
        'Created CLAUDE_DESKTOP_SYSTEM_PROMPT_V16.md',
        'Investigated context_embeddings and claude_credentials tables',
        'Fixed CTK violation - wrong directory usage',
        'Created credential management tools in CTK',
        'Saved THR Google Client ID to claude_credentials',
        'Checked THR status - 85% ready for production'
      ],
      files_created: {
        flowstate_investigation: [
          '/claude-tools-kit/tools/flowstate-investigation/CLAUDE_DESKTOP_SYSTEM_PROMPT_V16.md',
          '/claude-tools-kit/tools/flowstate-investigation/memory-system-investigation-report.md',
          '/claude-tools-kit/tools/flowstate-investigation/memory-tables-comprehensive-report.md',
          '/claude-tools-kit/tools/flowstate-investigation/create-activity-log.sql'
        ],
        credential_tools: [
          '/claude-tools-kit/tools/credential-management/save-thr-credentials-simple.js',
          '/claude-tools-kit/tools/credential-management/populate-env-from-credentials.js'
        ],
        thr_files: [
          '/THR/docs/THR-PRIORITY-ACTION-PLAN-2025-08-01.md',
          '/THR/scripts/comprehensive-thr-status.js',
          '/THR/scripts/check-thr-database-integrity.js'
        ]
      },
      critical_findings: {
        flowstate: 'activity_log table missing but not needed - FlowState reads directly from claude_desktop_memory',
        context_embeddings: '102 records for semantic search, fixed one Neo Macbook entry',
        claude_credentials: '19 API keys actively used, added THR Google Client ID',
        thr_issues: [
          'Missing VITE_GOOGLE_CLIENT_ID - NOW SAVED',
          'Storage buckets not created (employee-photos, claim-receipts, thr-documents)',
          'Database queries returning null - check credentials'
        ]
      },
      thr_status: {
        progress: 85,
        sql_migrations: 165,
        completed_modules: 8,
        deployment: 'GitHub to Netlify auto-deploy',
        production_url: 'https://thr.neotodak.com'
      },
      next_actions: [
        'Create THR storage buckets in Supabase',
        'Fix THR database connection',
        'Push THR changes to GitHub for Netlify deployment',
        'Test THR login with saved Google Client ID'
      ]
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
      console.log('✅ Session progress saved successfully!');
      console.log('📝 Memory ID:', data[0].id);
    }
  } catch (err) {
    console.error('Failed:', err);
  }
}

saveSessionProgress();