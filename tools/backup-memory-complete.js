#!/usr/bin/env node

/**
 * Complete Memory Backup - CRITICAL OPERATION
 * CTK Maximum Safety: Full database backup before upgrades
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backupMemoryTable() {
  console.log('💾 COMPLETE MEMORY TABLE BACKUP');
  console.log('=' .repeat(80));
  console.log('⚠️  CRITICAL OPERATION - Creating full backup before upgrades\n');

  const backupDir = '/Users/broneotodak/Projects/claude-tools-kit/backups/pre-upgrade';
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = Date.now();
  const backupPath = `${backupDir}/memory-full-backup-${timestamp}.json`;

  try {
    // Get total count first
    const { count: totalCount } = await supabase
      .from('claude_desktop_memory')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'neo_todak');

    console.log(`📊 Total memories to backup: ${totalCount}\n`);

    // Fetch all memories with pagination
    const PAGE_SIZE = 1000;
    let allMemories = [];
    let page = 0;

    while (true) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      console.log(`Fetching page ${page + 1} (${from}-${to})...`);

      const { data, error } = await supabase
        .from('claude_desktop_memory')
        .select('*')
        .eq('user_id', 'neo_todak')
        .range(from, to)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        allMemories = allMemories.concat(data);
        console.log(`  ✅ Retrieved ${data.length} records (Total: ${allMemories.length}/${totalCount})`);

        if (data.length < PAGE_SIZE) break;
        page++;
      } else {
        break;
      }
    }

    // Create comprehensive backup
    const backup = {
      timestamp: new Date().toISOString(),
      operation: 'pre-upgrade-backup',
      database: process.env.SUPABASE_URL,
      table: 'claude_desktop_memory',
      user_id: 'neo_todak',
      total_records: allMemories.length,
      backup_type: 'COMPLETE',
      purpose: 'pgvectorscale upgrade + graph schema addition',
      records: allMemories,
      schema: allMemories.length > 0 ? {
        columns: Object.keys(allMemories[0]),
        sample: allMemories[0]
      } : null
    };

    // Save to file
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

    // Calculate file size
    const stats = fs.statSync(backupPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log('\n' + '=' .repeat(80));
    console.log('✅ BACKUP COMPLETE');
    console.log('=' .repeat(80));
    console.log(`📁 Backup file: ${backupPath}`);
    console.log(`📊 Records backed up: ${allMemories.length}`);
    console.log(`💾 File size: ${fileSizeMB} MB`);
    console.log(`⏰ Timestamp: ${backup.timestamp}`);
    console.log('=' .repeat(80));

    // Create verification hash
    const hash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(allMemories))
      .digest('hex');

    const verificationFile = `${backupDir}/verification-${timestamp}.json`;
    fs.writeFileSync(verificationFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      backup_file: backupPath,
      record_count: allMemories.length,
      sha256_hash: hash,
      file_size_bytes: stats.size
    }, null, 2));

    console.log(`\n🔐 Verification hash: ${hash.substring(0, 16)}...`);
    console.log(`📝 Verification file: ${verificationFile}\n`);

    return {
      success: true,
      backupPath,
      verificationFile,
      recordCount: allMemories.length,
      hash
    };

  } catch (error) {
    console.error('\n❌ BACKUP FAILED:', error.message);
    console.error('⚠️  DO NOT PROCEED WITH UPGRADE');
    return {
      success: false,
      error: error.message
    };
  }
}

if (require.main === module) {
  backupMemoryTable()
    .then(result => {
      if (result.success) {
        console.log('✅ Safe to proceed with upgrade');
        process.exit(0);
      } else {
        console.log('❌ Cannot proceed - backup failed');
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { backupMemoryTable };
