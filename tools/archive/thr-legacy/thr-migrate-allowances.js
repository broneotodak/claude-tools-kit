#!/usr/bin/env node

/**
 * THR Allowances Migration
 * Migrates allowances into the simplified allowances column format
 * This is separate from fixed_allowances which has a more complex structure
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Connect to THR_neo (previously ATLAS) database
const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Parse allowance line from TXT file
 */
function parseAllowanceLine(line) {
    // Format: "1   T.ALLOWTRAVELLING ALLOWANCE          5,000.00 END               12/2024        12/2025"
    // Format: "1   STAFF HSTAFF HOUSE                    -200.00 END               01/2023        01/2040"
    
    // Match pattern with proper spacing handling
    const patterns = [
        // Pattern 1: Standard format with clear spacing
        /^(\d+)\s+([A-Z\.\s]+?)([A-Z\s]+?)\s+([\-\d,]+\.\d{2})\s+(\w+)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})$/,
        // Pattern 2: Compact format
        /^(\d+)\s+([A-Z\.]+)\s*([A-Z\s]+?)\s+([\-\d,]+\.\d{2})\s+(\w+)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})$/,
        // Pattern 3: More flexible format
        /^(\d+)\s+([A-Z\.\s]+?)\s{2,}([\-\d,]+\.\d{2})\s+(\w+)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})$/
    ];
    
    for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
            if (match.length === 8) {
                // Standard format with code and description
                const [_, seq, code, description, amount, period, fromDate, toDate] = match;
                return {
                    code: code.trim().replace(/\s+/g, ''),
                    description: description.trim(),
                    amount: parseFloat(amount.replace(/,/g, '')),
                    period: period,
                    start_date: fromDate,
                    end_date: toDate
                };
            } else if (match.length === 7) {
                // Format without separate description
                const [_, seq, codeAndDesc, amount, period, fromDate, toDate] = match;
                // Extract code (first word) and description (rest)
                const parts = codeAndDesc.trim().split(/\s+/);
                const code = parts[0];
                const description = parts.slice(1).join(' ') || code;
                return {
                    code: code,
                    description: description,
                    amount: parseFloat(amount.replace(/,/g, '')),
                    period: period,
                    start_date: fromDate,
                    end_date: toDate
                };
            }
        }
    }
    
    return null;
}

/**
 * Process TXT files for allowances
 */
async function processTXTFiles() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    const employeeAllowances = new Map();

    const companyMap = {
        '10C': 'CMP',
        'HSB': 'HYLN',
        'LTCM': 'TL',
        'MH': 'MH',
        'MTSB': 'MTSB',
        'STSB': 'ST',
        'TASB': 'TA',
        'TCSB': 'TC',
        'TDSB': 'ST',
        'THSB': 'TH',
        'TPSB': 'TP',
        'TRC': 'TRC',
        'TSSB': 'TS',
        'TTK': 'TK'
    };

    for (const file of files) {
        console.log(`\nProcessing ${file}...`);
        const companyCode = file.split('_')[0];
        const filePath = path.join(rawDataDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        let currentEmployee = null;
        let inAllowanceSection = false;
        let allowances = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Find employee number
            if (line.includes('Employee No.')) {
                // Save previous employee's allowances if any
                if (currentEmployee && allowances.length > 0) {
                    // Only include positive amounts (allowances, not deductions)
                    const positiveAllowances = allowances.filter(a => a.amount > 0);
                    if (positiveAllowances.length > 0) {
                        employeeAllowances.set(currentEmployee, positiveAllowances);
                        console.log(`  ✓ ${currentEmployee}: ${positiveAllowances.length} allowances`);
                    }
                }

                // Extract new employee number
                const match = line.match(/Employee No\.\s+([A-Z]+\d+)/);
                if (match) {
                    const rawEmpNo = match[1];
                    const number = rawEmpNo.replace(/[A-Za-z]+/, '');
                    const prefix = companyMap[companyCode] || companyCode;
                    
                    let formattedNumber = number;
                    if (prefix === 'ST' && !number.startsWith('0') && number.length < 4) {
                        formattedNumber = '0' + number.padStart(3, '0');
                    }
                    
                    currentEmployee = prefix + formattedNumber;
                    allowances = [];
                    inAllowanceSection = false;
                }
            }

            // Check if we're in the allowance section
            if (line.includes('Fixed Allowance / Deduction')) {
                inAllowanceSection = true;
                continue;
            }

            // Parse allowance lines
            if (inAllowanceSection && currentEmployee) {
                // Stop at next section or empty employee record
                if (line.includes('EMPLOYEE PERSONAL DETAIL') || 
                    line.includes('Employee No.') || 
                    line.trim() === '' && lines[i+1] && lines[i+1].includes('Employee No.')) {
                    inAllowanceSection = false;
                    continue;
                }

                // Try to parse allowance line
                if (/^\d+\s+[A-Z]/.test(line.trim())) {
                    const allowance = parseAllowanceLine(line.trim());
                    if (allowance) {
                        // Normalize code format
                        if (allowance.code === 'T.ALLOW') {
                            allowance.code = 'T.ALLOWANCE';
                        }
                        if (allowance.code === 'ALLOWANC') {
                            allowance.code = 'ALLOWANCE';
                        }
                        
                        // Ensure description is properly formatted
                        if (!allowance.description || allowance.description === allowance.code) {
                            if (allowance.code.includes('T.ALLOW')) {
                                allowance.description = 'TRAVELLING ALLOWANCE';
                            } else if (allowance.code === 'ALLOWANCE') {
                                allowance.description = 'ALLOWANCE';
                            } else if (allowance.code.includes('MEAL')) {
                                allowance.description = 'MEAL ALLOWANCE';
                            } else if (allowance.code.includes('HOS')) {
                                allowance.description = 'HOSTEL ALLOWANCE';
                            } else if (allowance.code.includes('TRAVEL')) {
                                allowance.description = 'TRAVELLING ALLOWANCE';
                            } else if (allowance.code === 'CA') {
                                allowance.description = 'COVERING ALLOWANCE';
                            } else {
                                allowance.description = allowance.code.replace(/_/g, ' ').replace(/\./g, ' ').trim();
                            }
                        }
                        
                        allowances.push(allowance);
                    }
                }
            }
        }

        // Save last employee's allowances
        if (currentEmployee && allowances.length > 0) {
            const positiveAllowances = allowances.filter(a => a.amount > 0);
            if (positiveAllowances.length > 0) {
                employeeAllowances.set(currentEmployee, positiveAllowances);
                console.log(`  ✓ ${currentEmployee}: ${positiveAllowances.length} allowances`);
            }
        }
    }

    return employeeAllowances;
}

/**
 * Update database with allowances
 */
async function updateDatabase(employeeAllowances) {
    console.log(`\n💾 Updating allowances for ${employeeAllowances.size} employees...\n`);
    
    let updated = 0;
    let errors = 0;

    for (const [employeeNo, allowances] of employeeAllowances) {
        const { error } = await supabase
            .from('master_hr2000')
            .update({
                allowances: allowances,
                updated_at: new Date().toISOString()
            })
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
            errors++;
        } else {
            updated++;
            if (updated % 10 === 0) {
                console.log(`  ✓ Updated ${updated} records...`);
            }
        }
    }

    console.log(`\n✅ Successfully updated: ${updated} records`);
    if (errors > 0) {
        console.log(`❌ Errors: ${errors} records`);
    }

    return updated;
}

/**
 * Main migration function
 */
async function migrateAllowances() {
    console.log('🔍 Starting Allowances migration...');
    console.log('Extracting allowances (positive amounts only) for the allowances column\n');

    // Process TXT files
    const employeeAllowances = await processTXTFiles();

    if (employeeAllowances.size === 0) {
        console.log('\n⚠️  No allowances found in raw files.');
        return;
    }

    // Update database
    await updateDatabase(employeeAllowances);

    // Verify migration
    console.log('\n🔍 Verifying allowances migration...\n');
    
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, employee_name, allowances')
        .not('allowances', 'is', null)
        .limit(5);

    if (!sampleError && samples) {
        console.log('📋 Sample records:');
        samples.forEach(emp => {
            console.log(`\n  ${emp.employee_no}:`);
            if (emp.allowances && Array.isArray(emp.allowances)) {
                emp.allowances.forEach(allowance => {
                    console.log(`    - ${allowance.code}: ${allowance.description} (RM ${allowance.amount})`);
                    console.log(`      Period: ${allowance.start_date} to ${allowance.end_date}`);
                });
            }
        });
    }

    // Get statistics
    const { count: withAllowances } = await supabase
        .from('master_hr2000')
        .select('*', { count: 'exact', head: true })
        .not('allowances', 'is', null);

    console.log(`\n📊 Total employees with allowances: ${withAllowances}`);
}

// Run migration
if (require.main === module) {
    migrateAllowances().catch(console.error);
}

module.exports = { migrateAllowances };