#!/usr/bin/env node

/**
 * Edit Validation Hook
 * Validates edits for common mistakes and dangerous operations
 */

const fs = require('fs');
const path = require('path');

// Dangerous patterns in edits
const DANGEROUS_PATTERNS = [
  {
    pattern: /DROP\s+TABLE/i,
    name: 'DROP TABLE',
    message: 'Dropping tables requires explicit confirmation'
  },
  {
    pattern: /TRUNCATE\s+TABLE/i,
    name: 'TRUNCATE TABLE',
    message: 'Truncating tables is destructive - use with caution'
  },
  {
    pattern: /DELETE\s+FROM\s+\w+\s*;/i,
    name: 'DELETE without WHERE',
    message: 'DELETE without WHERE clause will remove ALL records'
  },
  {
    pattern: /UPDATE\s+\w+\s+SET.*(?!WHERE)/is,
    name: 'UPDATE without WHERE',
    message: 'UPDATE without WHERE clause will affect ALL records'
  },
  {
    pattern: /ALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN/i,
    name: 'DROP COLUMN',
    message: 'Dropping columns is destructive and cannot be undone'
  }
];

function validateEdit(oldString, newString, filePath) {
  const warnings = [];

  // Check if editing SQL file
  if (filePath.match(/\.(sql|migration)$/i)) {
    for (const { pattern, name, message } of DANGEROUS_PATTERNS) {
      if (pattern.test(newString)) {
        warnings.push({ type: name, message, file: filePath });
      }
    }
  }

  // Check for hardcoded credentials being added
  const credPatterns = [
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/i,
    /OPENAI_API_KEY\s*=\s*['"]sk-[^'"]+['"]/i,
    /password\s*=\s*['"][^'"]+['"]/i
  ];

  for (const pattern of credPatterns) {
    if (!pattern.test(oldString) && pattern.test(newString)) {
      warnings.push({
        type: 'Hardcoded Credential',
        message: 'Adding hardcoded credentials - use environment variables instead',
        file: filePath
      });
    }
  }

  return warnings;
}

function main() {
  const args = process.argv.slice(2);
  const toolInput = args[0] ? JSON.parse(args[0]) : {};

  const { file_path: filePath, old_string: oldString, new_string: newString } = toolInput;

  if (!filePath || !oldString || !newString) {
    console.log(JSON.stringify({ allow: true }));
    return;
  }

  const warnings = validateEdit(oldString, newString, filePath);

  if (warnings.length > 0) {
    const warningMessages = warnings.map(w => `⚠️  ${w.type}: ${w.message}`).join('\n');
    console.log(JSON.stringify({
      allow: false,
      message: `Edit Validation Warnings:\n\n${warningMessages}\n\nProceed with caution or use --force if intentional.`
    }));
  } else {
    console.log(JSON.stringify({ allow: true }));
  }
}

if (require.main === module) {
  main();
}
