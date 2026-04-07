#!/usr/bin/env node

/**
 * THR Fixed Allowances Migration
 * Migrates fixed allowances and deductions from raw data into master_hr2000 table
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
    
    // Match pattern: number, code, description, amount, period, from date, to date
    const match = line.match(/^(\d+)\s+([A-Z\.\s]+?)([A-Z\s]+?)\s+([\-\d,]+\.\d{2})\s+(\w+)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})$/);
    
    if (!match) {
        // Try alternative pattern for lines with different spacing
        const altMatch = line.match(/^(\d+)\s+([A-Z\.]+)\s*([A-Z\s]+?)\s+([\-\d,]+\.\d{2})\s+(\w+)\s+(\d{2}\/\d{4})\s+(\d{2}\/\d{4})$/);
        if (!altMatch) return null;
        match = altMatch;
    }
    
    const [_, seq, code, description, amount, period, fromDate, toDate] = match;
    
    return {
        sequence: parseInt(seq),
        code: code.trim(),
        description: description.trim(),
        amount: parseFloat(amount.replace(/,/g, '')),
        period: period,
        from_date: fromDate,
        to_date: toDate,
        is_deduction: amount.includes('-')
    };
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
                    employeeAllowances.set(currentEmployee, allowances);
                    console.log(`  ✓ ${currentEmployee}: ${allowances.length} allowances/deductions`);
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
                        allowances.push(allowance);
                    }
                }
            }
        }

        // Save last employee's allowances
        if (currentEmployee && allowances.length > 0) {
            employeeAllowances.set(currentEmployee, allowances);
            console.log(`  ✓ ${currentEmployee}: ${allowances.length} allowances/deductions`);
        }
    }

    return employeeAllowances;
}

/**
 * Update database with allowances
 */
async function updateDatabase(employeeAllowances) {
    console.log(`\n💾 Updating fixed allowances for ${employeeAllowances.size} employees...\n`);
    
    let updated = 0;
    let errors = 0;

    for (const [employeeNo, allowances] of employeeAllowances) {
        // Structure allowances as JSONB
        const fixedAllowances = {
            allowances: allowances.filter(a => !a.is_deduction),
            deductions: allowances.filter(a => a.is_deduction),
            total_allowances: allowances.filter(a => !a.is_deduction).reduce((sum, a) => sum + a.amount, 0),
            total_deductions: allowances.filter(a => a.is_deduction).reduce((sum, a) => sum + Math.abs(a.amount), 0),
            last_updated: new Date().toISOString()
        };

        const { error } = await supabase
            .from('master_hr2000')
            .update({
                fixed_allowances: fixedAllowances,
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
async function migrateFixedAllowances() {
    console.log('🔍 Starting Fixed Allowances migration...');
    console.log('Extracting allowances and deductions from employee records\n');

    // Process TXT files
    const employeeAllowances = await processTXTFiles();

    if (employeeAllowances.size === 0) {
        console.log('\n⚠️  No fixed allowances found in raw files.');
        return;
    }

    // Show summary
    let totalAllowances = 0;
    let totalDeductions = 0;
    for (const allowances of employeeAllowances.values()) {
        totalAllowances += allowances.filter(a => !a.is_deduction).length;
        totalDeductions += allowances.filter(a => a.is_deduction).length;
    }

    console.log(`\n📊 Found data for ${employeeAllowances.size} employees:`);
    console.log(`  - Total allowances: ${totalAllowances}`);
    console.log(`  - Total deductions: ${totalDeductions}`);

    // Update database
    await updateDatabase(employeeAllowances);

    // Verify migration
    console.log('\n🔍 Verifying fixed allowances migration...\n');
    
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, employee_name, fixed_allowances')
        .not('fixed_allowances', 'is', null)
        .limit(5);

    if (!sampleError && samples) {
        console.log('📋 Sample records:');
        samples.forEach(emp => {
            console.log(`\n  ${emp.employee_no}:`);
            if (emp.fixed_allowances) {
                console.log(`    Allowances: ${emp.fixed_allowances.allowances?.length || 0}`);
                console.log(`    Deductions: ${emp.fixed_allowances.deductions?.length || 0}`);
                console.log(`    Total allowances: RM ${emp.fixed_allowances.total_allowances?.toFixed(2) || '0.00'}`);
                console.log(`    Total deductions: RM ${emp.fixed_allowances.total_deductions?.toFixed(2) || '0.00'}`);
            }
        });
    }

    // Get statistics
    const { count: withAllowances } = await supabase
        .from('master_hr2000')
        .select('*', { count: 'exact', head: true })
        .not('fixed_allowances', 'is', null);

    console.log(`\n📊 Total employees with fixed allowances: ${withAllowances}`);
}

// Run migration
if (require.main === module) {
    migrateFixedAllowances().catch(console.error);
}

module.exports = { migrateFixedAllowances };