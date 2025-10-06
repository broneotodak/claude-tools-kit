#!/usr/bin/env node

/**
 * Pre-commit Security Hook
 * Blocks commits with exposed credentials
 */

const fs = require('fs');
const path = require('path');

// Security patterns to detect
const SECURITY_PATTERNS = [
  { pattern: /(SUPABASE_SERVICE_ROLE_KEY|supabase.*service.*role.*key)[\s:=]["']?[a-zA-Z0-9_-]{20,}/i, name: 'Supabase Service Role Key' },
  { pattern: /(OPENAI_API_KEY|openai.*api.*key)[\s:=]["']?sk-[a-zA-Z0-9]{20,}/i, name: 'OpenAI API Key' },
  { pattern: /(ANTHROPIC_API_KEY|anthropic.*api.*key)[\s:=]["']?sk-ant-[a-zA-Z0-9_-]{20,}/i, name: 'Anthropic API Key' },
  { pattern: /postgres:\/\/[^:]+:[^@]+@[^\/]+/i, name: 'PostgreSQL Connection String' },
  { pattern: /(password|passwd|pwd)[\s:=]["'][^"'\s]{8,}/i, name: 'Password' },
  { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/i, name: 'Private Key' },
  { pattern: /(github_pat|ghp)_[a-zA-Z0-9]{36,}/i, name: 'GitHub Token' }
];

function scanContent(content, filePath) {
  const violations = [];

  for (const { pattern, name } of SECURITY_PATTERNS) {
    if (pattern.test(content)) {
      violations.push({ file: filePath, type: name });
    }
  }

  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const toolInput = args[0] ? JSON.parse(args[0]) : {};

  // Get file being committed
  const filePath = toolInput.file_path;

  if (!filePath || !fs.existsSync(filePath)) {
    console.log(JSON.stringify({ allow: true }));
    return;
  }

  // Skip binary files and node_modules
  if (filePath.includes('node_modules') || filePath.match(/\.(jpg|jpeg|png|gif|pdf|zip)$/i)) {
    console.log(JSON.stringify({ allow: true }));
    return;
  }

  // Read and scan file
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = scanContent(content, filePath);

  if (violations.length > 0) {
    console.log(JSON.stringify({
      allow: false,
      message: `🛑 Security Violation Detected!\n\nFound exposed credentials:\n${violations.map(v => `  - ${v.type} in ${v.file}`).join('\n')}\n\n⚠️ Remove credentials before committing.\n💡 Use environment variables instead.`
    }));
  } else {
    console.log(JSON.stringify({ allow: true }));
  }
}

if (require.main === module) {
  main();
}
