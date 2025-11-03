#!/usr/bin/env node

/**
 * Daily Maintenance - Automated Health and Cleanup
 * Runs: Duplicate detection, health check, basic cleanup
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { execSync } = require('child_process');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const maintenanceLog = [];

function log(message, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), level, message };
  maintenanceLog.push(entry);
  const icon = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : level === 'success' ? '✅' : '📝';
  console.log(`${icon} ${message}`);
}

async function detectDuplicates() {
  log('Checking for duplicate memories...');

  try {
    // Sample recent memories
    const { data: recentMemories } = await supabase
      .from('claude_desktop_memory')
      .select('content')
      .eq('user_id', 'neo_todak')
      .order('created_at', { ascending: false })
      .limit(1000);

    const contentMap = new Map();
    recentMemories.forEach(m => {
      contentMap.set(m.content, (contentMap.get(m.content) || 0) + 1);
    });

    const duplicates = Array.from(contentMap.entries())
      .filter(([_, count]) => count > 1);

    if (duplicates.length > 5) {
      log(`Found ${duplicates.length} duplicate groups - action needed`, 'warning');
      return { status: 'warning', count: duplicates.length };
    } else if (duplicates.length > 0) {
      log(`Found ${duplicates.length} duplicate groups - within acceptable range`, 'info');
      return { status: 'ok', count: duplicates.length };
    } else {
      log('No duplicates found', 'success');
      return { status: 'clean', count: 0 };
    }
  } catch (error) {
    log(`Duplicate check failed: ${error.message}`, 'error');
    return { status: 'error', error: error.message };
  }
}

async function checkMemoryGrowth() {
  log('Analyzing memory growth rate...');

  try {
    const { count: totalCount } = await supabase
      .from('claude_desktop_memory')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'neo_todak');

    const { count: last24h } = await supabase
      .from('claude_desktop_memory')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'neo_todak')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const { count: last7days } = await supabase
      .from('claude_desktop_memory')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'neo_todak')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    log(`Total memories: ${totalCount}`, 'info');
    log(`Last 24h: ${last24h} new memories`, 'info');
    log(`Last 7 days: ${last7days} new memories`, 'info');

    const dailyAvg = (last7days / 7).toFixed(1);
    log(`Average daily growth: ${dailyAvg} memories/day`, 'info');

    if (dailyAvg > 100) {
      log('High memory growth rate detected', 'warning');
      return { status: 'warning', dailyAvg };
    }

    return {
      status: 'normal',
      total: totalCount,
      last24h,
      last7days,
      dailyAvg
    };
  } catch (error) {
    log(`Memory growth check failed: ${error.message}`, 'error');
    return { status: 'error', error: error.message };
  }
}

async function cleanupOldBackups() {
  log('Cleaning up old backup files (>30 days)...');

  try {
    const backupDir = '/Users/broneotodak/Projects/claude-tools-kit/backups';
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const files = fs.readdirSync(backupDir);
    let deletedCount = 0;

    files.forEach(file => {
      const filePath = `${backupDir}/${file}`;
      const stats = fs.statSync(filePath);

      if (stats.mtimeMs < thirtyDaysAgo && stats.size < 1024 * 1024 * 10) { // Only delete files < 10MB
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      log(`Deleted ${deletedCount} old backup files`, 'success');
    } else {
      log('No old backups to delete', 'info');
    }

    return { status: 'complete', deletedCount };
  } catch (error) {
    log(`Backup cleanup failed: ${error.message}`, 'error');
    return { status: 'error', error: error.message };
  }
}

async function checkSystemResources() {
  log('Checking system resources...');

  try {
    // Disk space
    const dfOutput = execSync('df -h /').toString();
    const usageMatch = dfOutput.match(/(\d+)%/);
    const diskUsage = usageMatch ? parseInt(usageMatch[1]) : 0;

    if (diskUsage > 90) {
      log(`Disk usage critical: ${diskUsage}%`, 'error');
      return { status: 'critical', diskUsage };
    } else if (diskUsage > 75) {
      log(`Disk usage high: ${diskUsage}%`, 'warning');
      return { status: 'warning', diskUsage };
    } else {
      log(`Disk usage normal: ${diskUsage}%`, 'success');
      return { status: 'ok', diskUsage };
    }
  } catch (error) {
    log(`Resource check failed: ${error.message}`, 'error');
    return { status: 'error', error: error.message };
  }
}

async function saveMaintenanceReport() {
  const timestamp = Date.now();
  const reportPath = `/Users/broneotodak/Projects/claude-tools-kit/logs/daily-maintenance-${timestamp}.json`;

  const logsDir = '/Users/broneotodak/Projects/claude-tools-kit/logs';
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    log: maintenanceLog,
    results: {
      duplicates: maintenanceLog.find(l => l.message.includes('duplicate')),
      growth: maintenanceLog.find(l => l.message.includes('growth')),
      backup: maintenanceLog.find(l => l.message.includes('backup')),
      resources: maintenanceLog.find(l => l.message.includes('resources'))
    }
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`Maintenance report saved: ${reportPath}`, 'info');

  return reportPath;
}

async function main() {
  console.log('🔧 DAILY MAINTENANCE');
  console.log('=' .repeat(80));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('=' .repeat(80) + '\n');

  // Run maintenance tasks
  await detectDuplicates();
  await checkMemoryGrowth();
  await checkSystemResources();
  await cleanupOldBackups();

  console.log('\n' + '=' .repeat(80));
  console.log('✅ Daily maintenance complete');
  console.log('=' .repeat(80));

  // Save report
  await saveMaintenanceReport();

  return { success: true };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Maintenance failed:', err);
      process.exit(1);
    });
}

module.exports = { main };
