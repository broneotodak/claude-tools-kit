#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixNeoMacbookEntry() {
  console.log('🔧 Fixing "Neo Macbook" entry in context_embeddings...\n');

  // Find the entry
  const { data: entries, error: findError } = await supabase
    .from('context_embeddings')
    .select('id, name, metadata')
    .eq('metadata->>machine', 'Neo Macbook');

  if (findError) {
    console.error('Error finding entry:', findError);
    return;
  }

  if (!entries || entries.length === 0) {
    console.log('✅ No "Neo Macbook" entries found - already clean!');
    return;
  }

  console.log(`Found ${entries.length} entry with "Neo Macbook":`);
  entries.forEach(e => {
    console.log(`  - ID: ${e.id}`);
    console.log(`    Name: ${e.name}`);
  });

  // Fix the machine name
  for (const entry of entries) {
    const updatedMetadata = {
      ...entry.metadata,
      machine: 'MacBook Pro'
    };

    const { error: updateError } = await supabase
      .from('context_embeddings')
      .update({ metadata: updatedMetadata })
      .eq('id', entry.id);

    if (updateError) {
      console.error(`❌ Error updating ${entry.id}:`, updateError);
    } else {
      console.log(`✅ Fixed entry ${entry.id} - changed "Neo Macbook" to "MacBook Pro"`);
    }
  }

  console.log('\n✨ Cleanup complete!');
}

fixNeoMacbookEntry().catch(console.error);