#!/usr/bin/env node

/**
 * THR Final Cleanup - Remove remaining duplicate organizations
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupDuplicates() {
  console.log('🧹 Final cleanup of duplicate organizations...\n');
  
  // Get all organizations
  const { data: orgs } = await supabase
    .from('thr_organizations')
    .select('*')
    .order('organization_code, created_at');
  
  // Find duplicates
  const seen = {};
  const toDelete = [];
  
  orgs.forEach(org => {
    if (seen[org.organization_code]) {
      // Keep the older one, delete the newer
      toDelete.push(org.organization_id);
      console.log(`Found duplicate: ${org.organization_code} - ${org.name} (created: ${org.created_at})`);
    } else {
      seen[org.organization_code] = org;
    }
  });
  
  // Delete duplicates
  if (toDelete.length > 0) {
    console.log(`\nDeleting ${toDelete.length} duplicates...`);
    
    for (const id of toDelete) {
      const { error } = await supabase
        .from('thr_organizations')
        .delete()
        .eq('organization_id', id);
      
      if (error) {
        console.error(`❌ Error deleting ${id}: ${error.message}`);
      } else {
        console.log(`✅ Deleted: ${id}`);
      }
    }
  } else {
    console.log('✅ No duplicates found');
  }
  
  // Final count
  const { count } = await supabase
    .from('thr_organizations')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n✅ Final organization count: ${count}`);
}

async function main() {
  try {
    await cleanupDuplicates();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}