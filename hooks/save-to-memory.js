#!/usr/bin/env node

/**
 * Auto-Save to Memory Hook
 * Automatically saves important file changes to pgVector memory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// File patterns that should trigger auto-save
const IMPORTANT_PATTERNS = [
  /\.claude\/(agents|commands)\//,  // Claude Code configurations
  /CLAUDE\.md$/,                     // Claude instructions
  /\.cursorrules$/,                  // Cursor rules
  /orchestration\.config\.json$/,    // CTK orchestration configs
  /package\.json$/,                  // Dependencies
  /\.env\.example$/                  // Environment templates
];

function shouldAutoSave(filePath) {
  return IMPORTANT_PATTERNS.some(pattern => pattern.test(filePath));
}

function extractContent(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract summary from first few lines
    const lines = content.split('\n').slice(0, 10);
    const summary = lines
      .filter(line => line.trim() && !line.startsWith('#'))
      .slice(0, 3)
      .join(' ')
      .substring(0, 200);

    return summary || `Updated ${path.basename(filePath)}`;
  } catch (error) {
    return `Updated ${path.basename(filePath)}`;
  }
}

function main() {
  const args = process.argv.slice(2);
  const toolInput = args[0] ? JSON.parse(args[0]) : {};

  const filePath = toolInput.file_path || '';

  if (!shouldAutoSave(filePath)) {
    console.log(JSON.stringify({ allow: true }));
    return;
  }

  try {
    // Extract content summary
    const content = extractContent(filePath);
    const fileName = path.basename(filePath);
    const category = filePath.includes('.claude') ? 'Config' : 'Project';
    const title = `Updated ${fileName}`;

    // Save to memory (non-blocking)
    const savePath = path.join(__dirname, '../tools/save-memory-enhanced.js');

    if (fs.existsSync(savePath)) {
      // Run in background, don't block the edit
      execSync(
        `node "${savePath}" "${category}" "${title}" "${content}" 5 &`,
        { stdio: 'ignore' }
      );
    }

    // Always allow the operation
    console.log(JSON.stringify({
      allow: true,
      message: `✓ Auto-saved to memory: ${title}`
    }));
  } catch (error) {
    // Don't block on errors
    console.log(JSON.stringify({ allow: true }));
  }
}

if (require.main === module) {
  main();
}
