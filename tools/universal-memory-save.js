#!/usr/bin/env node

/**
 * Universal Memory Save — backward-compatible wrapper
 * Delegates to the unified save-memory.js
 */

const { saveMemory } = require('./save-memory');

// CLI: same interface as before
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: universal-memory-save.js "content" [--type=feature] [--importance=7]');
    process.exit(1);
  }

  const content = args.filter(a => !a.startsWith('--'))[0];
  const options = {};
  args.filter(a => a.startsWith('--')).forEach(f => {
    const [key, value] = f.substring(2).split('=');
    options[key] = isNaN(value) ? value : parseInt(value);
  });

  saveMemory(content, options)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { UniversalMemorySave: { saveMemory }, universalSave: saveMemory };
