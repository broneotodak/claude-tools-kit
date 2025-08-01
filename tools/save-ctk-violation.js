const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveCTKViolation() {
  const memory = {
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_code',
    category: 'CTK',
    memory_type: 'critical_learning',
    content: 'CRITICAL CTK VIOLATION: Created 6 files in /claude-tools/ instead of /claude-tools-kit/. Root cause: working directory confusion and muscle memory. Fixed by moving all files to correct location. Lesson: CTK compliance requires active directory verification, not just good intentions.',
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: 'CTK',
      activity_type: 'bug_fix',
      flowstate_ready: true,
      violation_type: 'wrong_directory',
      files_affected: 6,
      corrective_action: 'moved to /claude-tools-kit/tools/flowstate-investigation/',
      root_cause: [
        'Working directory confusion',
        'Muscle memory from temp scripts',
        'Missing CTK directory check'
      ],
      prevention: [
        'Always verify pwd before creating files',
        'Use full paths for CTK files',
        'Remember claude-tools-kit is canonical'
      ]
    },
    importance: 10
  };

  const { data, error } = await supabase
    .from('claude_desktop_memory')
    .insert(memory)
    .select();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ CTK violation saved as critical learning');
  }
}

saveCTKViolation();