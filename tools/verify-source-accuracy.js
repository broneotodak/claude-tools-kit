#!/usr/bin/env node

/**
 * Verify Source Field Accuracy
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifySourceAccuracy() {
  console.log('✅ VERIFYING SOURCE FIELD ACCURACY\n');

  // Check the memory we just saved (ID: 3209)
  const { data, error } = await supabase
    .from('claude_desktop_memory')
    .select('id, source, metadata, created_at')
    .eq('id', 3209)
    .single();

  if (error) throw error;

  console.log('Memory ID: 3209 (just saved)\n');
  console.log(`Source field: "${data.source}" ✅`);
  console.log(`Metadata.saved_by: "${data.metadata.saved_by}" ✅`);
  console.log(`Expected: "claude_code" (underscore)\n`);

  const correct = data.source === 'claude_code' && data.metadata.saved_by === 'claude_code';

  if (correct) {
    console.log('✅ ACCURACY VERIFIED - Source field is now correct!\n');
  } else {
    console.log('❌ ACCURACY ISSUE - Source field still incorrect\n');
  }

  return { success: correct, data };
}

verifySourceAccuracy()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
