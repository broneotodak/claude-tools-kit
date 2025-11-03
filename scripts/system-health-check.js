#!/usr/bin/env node

/**
 * System Health Check - Comprehensive Monitoring
 * CTK Automated Health Monitoring System
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Health check results
const healthReport = {
  timestamp: new Date().toISOString(),
  machine: {
    name: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release()
  },
  checks: {},
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0
  }
};

function check(name, status, details = {}) {
  healthReport.checks[name] = {
    status,
    ...details,
    checked_at: new Date().toISOString()
  };

  healthReport.summary.total++;
  if (status === 'pass') healthReport.summary.passed++;
  else if (status === 'fail') healthReport.summary.failed++;
  else if (status === 'warning') healthReport.summary.warnings++;

  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} ${name}: ${status.toUpperCase()}`);
  if (details.message) console.log(`   ${details.message}`);
}

async function checkMemoryHealth() {
  console.log('\n📊 MEMORY SYSTEM HEALTH\n');

  try {
    // Check main memory table
    const { count: mainCount, error: mainError } = await supabase
      .from('claude_desktop_memory')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', 'neo_todak');

    if (mainError) {
      check('memory_table', 'fail', { message: `Error: ${mainError.message}` });
    } else {
      check('memory_table', 'pass', { count: mainCount, message: `${mainCount} memories` });
    }

    // Check archive table
    const { count: archiveCount, error: archiveError } = await supabase
      .from('claude_desktop_memory_archive')
      .select('*', { count: 'exact', head: true });

    if (archiveError) {
      check('archive_table', 'warning', { message: `Error: ${archiveError.message}` });
    } else {
      check('archive_table', 'pass', { count: archiveCount, message: `${archiveCount} archived` });
    }

    // Check for duplicates
    const { data: recentMemories } = await supabase
      .from('claude_desktop_memory')
      .select('content')
      .eq('user_id', 'neo_todak')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (recentMemories) {
      const contentMap = new Map();
      recentMemories.forEach(m => {
        contentMap.set(m.content, (contentMap.get(m.content) || 0) + 1);
      });

      const duplicates = Array.from(contentMap.values()).filter(count => count > 1).length;

      if (duplicates > 5) {
        check('duplicate_check', 'warning', {
          duplicates,
          message: `${duplicates} duplicate groups in recent 1000 memories`
        });
      } else {
        check('duplicate_check', 'pass', {
          duplicates,
          message: `${duplicates} duplicate groups (acceptable)`
        });
      }
    }

  } catch (error) {
    check('memory_health', 'fail', { message: error.message });
  }
}

async function checkDiskSpace() {
  console.log('\n💾 DISK SPACE\n');

  try {
    const dfOutput = execSync('df -h /').toString();
    const lines = dfOutput.trim().split('\n');
    const dataLine = lines[1].split(/\s+/);

    const total = dataLine[1];
    const used = dataLine[2];
    const available = dataLine[3];
    const usedPercent = parseInt(dataLine[4].replace('%', ''));

    if (usedPercent > 90) {
      check('disk_space', 'fail', {
        total,
        used,
        available,
        usedPercent,
        message: `Disk usage critical: ${usedPercent}%`
      });
    } else if (usedPercent > 75) {
      check('disk_space', 'warning', {
        total,
        used,
        available,
        usedPercent,
        message: `Disk usage high: ${usedPercent}%`
      });
    } else {
      check('disk_space', 'pass', {
        total,
        used,
        available,
        usedPercent,
        message: `${usedPercent}% used, ${available} available`
      });
    }
  } catch (error) {
    check('disk_space', 'fail', { message: error.message });
  }
}

async function checkMemoryRAM() {
  console.log('\n🧠 SYSTEM MEMORY (RAM)\n');

  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedPercent = ((usedMem / totalMem) * 100).toFixed(1);

    const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
    const freeGB = (freeMem / 1024 / 1024 / 1024).toFixed(1);
    const usedGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);

    if (usedPercent > 90) {
      check('system_ram', 'warning', {
        total: `${totalGB} GB`,
        used: `${usedGB} GB`,
        free: `${freeGB} GB`,
        usedPercent: `${usedPercent}%`,
        message: `High memory usage: ${usedPercent}%`
      });
    } else {
      check('system_ram', 'pass', {
        total: `${totalGB} GB`,
        used: `${usedGB} GB`,
        free: `${freeGB} GB`,
        usedPercent: `${usedPercent}%`,
        message: `${freeGB} GB free of ${totalGB} GB`
      });
    }
  } catch (error) {
    check('system_ram', 'fail', { message: error.message });
  }
}

async function checkCTKTools() {
  console.log('\n🛠️  CTK TOOLS\n');

  try {
    const toolsDir = '/Users/broneotodak/Projects/claude-tools-kit/tools';

    if (!fs.existsSync(toolsDir)) {
      check('ctk_tools', 'fail', { message: 'Tools directory not found' });
      return;
    }

    const files = fs.readdirSync(toolsDir);
    const jsFiles = files.filter(f => f.endsWith('.js'));

    check('ctk_tools', 'pass', {
      toolCount: jsFiles.length,
      message: `${jsFiles.length} tools available`
    });

  } catch (error) {
    check('ctk_tools', 'fail', { message: error.message });
  }
}

async function checkDatabaseConnection() {
  console.log('\n🔌 DATABASE CONNECTION\n');

  try {
    const start = Date.now();

    const { data, error } = await supabase
      .from('claude_desktop_memory')
      .select('id')
      .limit(1);

    const latency = Date.now() - start;

    if (error) {
      check('database_connection', 'fail', { message: error.message });
    } else if (latency > 2000) {
      check('database_connection', 'warning', {
        latency: `${latency}ms`,
        message: `High latency: ${latency}ms`
      });
    } else {
      check('database_connection', 'pass', {
        latency: `${latency}ms`,
        message: `Connected (${latency}ms)`
      });
    }
  } catch (error) {
    check('database_connection', 'fail', { message: error.message });
  }
}

async function checkClaudeCode() {
  console.log('\n🤖 CLAUDE CODE\n');

  try {
    const version = execSync('claude --version 2>&1').toString().trim();

    check('claude_code', 'pass', {
      version,
      message: `Version: ${version}`
    });
  } catch (error) {
    check('claude_code', 'warning', {
      message: 'Could not determine Claude Code version'
    });
  }
}

async function saveReport(format = 'both') {
  const timestamp = Date.now();
  const docsDir = '/Users/broneotodak/Projects/claude-tools-kit/docs';

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // JSON format
  if (format === 'json' || format === 'both') {
    const jsonPath = `${docsDir}/health-check-${timestamp}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(healthReport, null, 2));
    console.log(`\n📁 JSON report: ${jsonPath}`);
  }

  // Markdown format
  if (format === 'markdown' || format === 'both') {
    const mdPath = `${docsDir}/SYSTEM-HEALTH-REPORT-${new Date().toISOString().split('T')[0]}.md`;

    let markdown = `# System Health Report\n\n`;
    markdown += `**Generated:** ${healthReport.timestamp}\n\n`;
    markdown += `**Machine:** ${healthReport.machine.name} (${healthReport.machine.platform})\n\n`;
    markdown += `## Summary\n\n`;
    markdown += `- ✅ Passed: ${healthReport.summary.passed}\n`;
    markdown += `- ❌ Failed: ${healthReport.summary.failed}\n`;
    markdown += `- ⚠️ Warnings: ${healthReport.summary.warnings}\n`;
    markdown += `- 📊 Total Checks: ${healthReport.summary.total}\n\n`;
    markdown += `## Detailed Results\n\n`;

    Object.entries(healthReport.checks).forEach(([name, result]) => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
      markdown += `### ${icon} ${name}\n\n`;
      markdown += `**Status:** ${result.status.toUpperCase()}\n\n`;
      if (result.message) markdown += `${result.message}\n\n`;
      if (Object.keys(result).length > 3) {
        markdown += `**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\n`;
      }
    });

    fs.writeFileSync(mdPath, markdown);
    console.log(`📁 Markdown report: ${mdPath}`);
  }
}

async function main() {
  console.log('🏥 SYSTEM HEALTH CHECK');
  console.log('=' .repeat(80));
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Machine: ${os.hostname()}`);
  console.log('=' .repeat(80));

  await checkDatabaseConnection();
  await checkMemoryHealth();
  await checkDiskSpace();
  await checkMemoryRAM();
  await checkCTKTools();
  await checkClaudeCode();

  console.log('\n' + '=' .repeat(80));
  console.log('📋 SUMMARY');
  console.log('=' .repeat(80));
  console.log(`Total Checks: ${healthReport.summary.total}`);
  console.log(`✅ Passed: ${healthReport.summary.passed}`);
  console.log(`❌ Failed: ${healthReport.summary.failed}`);
  console.log(`⚠️ Warnings: ${healthReport.summary.warnings}`);
  console.log('=' .repeat(80));

  const overallStatus = healthReport.summary.failed === 0 ? 'HEALTHY' : 'NEEDS ATTENTION';
  const statusIcon = healthReport.summary.failed === 0 ? '✅' : '⚠️';
  console.log(`\n${statusIcon} Overall Status: ${overallStatus}\n`);

  // Save reports
  await saveReport('both');

  return {
    success: true,
    report: healthReport
  };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Health check failed:', err);
      process.exit(1);
    });
}

module.exports = { main, healthReport };
