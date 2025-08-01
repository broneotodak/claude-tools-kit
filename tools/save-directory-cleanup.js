const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveDirectoryCleanup() {
  const memory = {
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_code',
    category: 'CTK',
    memory_type: 'maintenance',
    content: 'Cleaned up /claude-tools/ directory confusion. Archived 24 temporary files to archive-2025-08-01, created DO_NOT_USE_README.md warning. This is NOT the CTK directory - always use /claude-tools-kit/. Directory appears to be legacy recovery/emergency tools.',
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: 'CTK',
      activity_type: 'cleanup',
      flowstate_ready: true,
      files_archived: 24,
      action_taken: [
        'Archived today\'s temporary files',
        'Created DO_NOT_USE_README.md warning',
        'Clarified this is NOT CTK directory'
      ],
      correct_directory: '/Users/broneotodak/Projects/claude-tools-kit/'
    },
    importance: 8
  };

  const { data, error } = await supabase
    .from('claude_desktop_memory')
    .insert(memory)
    .select();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ Directory cleanup saved to memory');
  }
}

saveDirectoryCleanup();