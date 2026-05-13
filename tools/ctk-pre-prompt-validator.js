#!/usr/bin/env node
/**
 * CTK Pre-Prompt Validator
 * Run this BEFORE responding to any prompt to ensure CTK compliance
 *
 * Usage: node ctk-pre-prompt-validator.js "user prompt"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class CTKValidator {
    constructor() {
        this.violations = [];
        this.warnings = [];
        this.projectType = null;
        this.databases = {
            THR: 'ftbtsxlujsnobujwekwx',
            ATLAS: 'ftbtsxlujsnobujwekwx',
            MEMORY: 'xsunmervpyrplzarebva',
            MEMORY_LEGACY: 'uzamamymfzhelvkwpvgt'
        };
    }

    detectProject() {
        const cwd = process.cwd();

        // Check for .ctkrc
        if (fs.existsSync('.ctkrc')) {
            const ctkrc = JSON.parse(fs.readFileSync('.ctkrc', 'utf8'));
            this.projectType = ctkrc.project || 'unknown';
            return;
        }

        // Check directory name
        if (cwd.includes('THR')) this.projectType = 'THR';
        else if (cwd.includes('ATLAS')) this.projectType = 'ATLAS';
        else if (cwd.includes('todak-ai')) this.projectType = 'TODAK-AI';
        else this.projectType = path.basename(cwd);
    }

    checkDatabaseConfig() {
        // Check if correct database is configured
        const currentUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

        if (this.projectType === 'THR' || this.projectType === 'ATLAS') {
            if (currentUrl && (currentUrl.includes(this.databases.MEMORY) || currentUrl.includes(this.databases.MEMORY_LEGACY))) {
                this.violations.push(`❌ WRONG DATABASE! THR uses ${this.databases.THR}, not memory DB!`);
            }
        }
    }

    checkForExistingTools(promptContent) {
        const keywords = ['save', 'search', 'test', 'check', 'position', 'employee'];
        const prompt = promptContent.toLowerCase();

        keywords.forEach(keyword => {
            if (prompt.includes(keyword)) {
                // Check for existing scripts
                try {
                    const scripts = execSync(`ls scripts/*${keyword}* 2>/dev/null || true`, {
                        encoding: 'utf8'
                    }).trim();

                    if (scripts) {
                        this.warnings.push(`⚠️  Found existing ${keyword} tools: ${scripts.split('\n').join(', ')}`);
                    }
                } catch(e) {
                    // No matching scripts
                }
            }
        });
    }

    checkSaveProgressTriggers(promptContent) {
        const triggers = [
            'save progress',
            'save our progress',
            'save this',
            'document this',
            'save to memory'
        ];

        const prompt = promptContent.toLowerCase();
        const triggered = triggers.some(t => prompt.includes(t));

        if (triggered) {
            this.violations.push('🔴 MANDATORY: User requested save - you MUST save to pgVector memory!');
        }
    }

    validatePrompt(promptContent) {
        console.log('🔍 CTK Pre-Prompt Validation\n');
        console.log('=' .repeat(60));

        this.detectProject();
        console.log(`📁 Project: ${this.projectType}`);
        console.log(`📂 Directory: ${process.cwd()}`);

        this.checkDatabaseConfig();
        this.checkForExistingTools(promptContent);
        this.checkSaveProgressTriggers(promptContent);

        // Report results
        console.log('\n📋 CTK Compliance Check:');

        if (this.violations.length > 0) {
            console.log('\n❌ VIOLATIONS FOUND:');
            this.violations.forEach(v => console.log(`   ${v}`));
        }

        if (this.warnings.length > 0) {
            console.log('\n⚠️  WARNINGS:');
            this.warnings.forEach(w => console.log(`   ${w}`));
        }

        if (this.violations.length === 0 && this.warnings.length === 0) {
            console.log('✅ No CTK violations detected');
        }

        // Provide quick commands
        console.log('\n📝 Quick Commands for this project:');
        if (this.projectType === 'THR') {
            console.log('   Save: node save-thr-progress.cjs "content"');
            console.log('   Test: node test-position-handling.cjs');
            console.log('   DB: ftbtsxlujsnobujwekwx.supabase.co');
        }

        console.log('\n🛡️  Remember: CTK is LAW, not guidance!');
        console.log('=' .repeat(60));

        return {
            valid: this.violations.length === 0,
            violations: this.violations,
            warnings: this.warnings,
            project: this.projectType
        };
    }
}

// CLI usage
if (require.main === module) {
    const prompt = process.argv.slice(2).join(' ') || '';
    const validator = new CTKValidator();
    const result = validator.validatePrompt(prompt);

    if (!result.valid) {
        console.log('\n🚨 STOP! Fix violations before proceeding!');
        process.exit(1);
    }
}

module.exports = CTKValidator;