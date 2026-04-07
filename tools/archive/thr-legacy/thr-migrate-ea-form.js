#!/usr/bin/env node

/**
 * THR EA Form Migration
 * Maps PCB/Tax Group codes to EA form categories
 * EA forms are LHDN (Malaysian tax authority) tax deduction forms
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

// PCB Group to EA Form mapping
// Based on Malaysian LHDN tax categories
const PCB_TO_EA_FORM = {
    '01': 'EA-S',     // Single person/married woman
    '02': 'EA-M1',    // Married (spouse working) - 1 child
    '03': 'EA-M2',    // Married (spouse working) - 2 children
    '04': 'EA-M3',    // Married (spouse working) - 3 children
    '05': 'EA-M3+',   // Married (spouse not working) - 3+ children
    '06': 'EA-M4',    // Married (spouse working) - 4 children
    '07': 'EA-M5',    // Married (spouse working) - 5 children
    '08': 'EA-M6',    // Married (spouse working) - 6 children
    '09': 'EA-M7',    // Married (spouse working) - 7 children
    '10': 'EA-M8',    // Married (spouse working) - 8 children
    '11': 'EA-M9',    // Married (spouse working) - 9 children
    '12': 'EA-M10',   // Married (spouse working) - 10 children
    '13': 'EA-NS1',   // Married (spouse not working) - 1 child
    '14': 'EA-NS2',   // Married (spouse not working) - 2 children
    '15': 'EA-NS3',   // Married (spouse not working) - 3 children
    '16': 'EA-NS4',   // Married (spouse not working) - 4 children
    '17': 'EA-NS5',   // Married (spouse not working) - 5 children
    '18': 'EA-NS6+'   // Married (spouse not working) - 6+ children
};

/**
 * Extract PCB group from CSV line
 */
function extractPCBFromCSV(lines, startIdx) {
    for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
        const line = lines[i];
        
        if (line.includes('PCB /Tax Group') || line.includes('PCB/Tax Group')) {
            const parts = line.split(',');
            // PCB label is in column 7, value is in column 12
            if (parts[7] && parts[7].includes('PCB')) {
                if (parts[12] && parts[12].trim()) {
                    const value = parts[12].trim();
                    // Extract just the numeric code (01, 02, etc.) from values like "01-Single person/married woman"
                    const match = value.match(/^(\d{2})-/);
                    if (match) {
                        return match[1];
                    }
                }
            }
        }
    }
    return null;
}

/**
 * Extract PCB group from TXT line
 */
function extractPCBFromTXT(lines, startIdx) {
    for (let i = startIdx; i < Math.min(startIdx + 50, lines.length); i++) {
        const line = lines[i];
        
        if (line.includes('PCB /Tax Group') || line.includes('PCB/Tax Group')) {
            // Extract the numeric code from patterns like "PCB /Tax Group 01-Single person/married woman"
            const match = line.match(/PCB\s*\/?\s*Tax Group\s+(\d{2})-/);
            if (match) {
                return match[1];
            }
        }
    }
    return null;
}

/**
 * Process CSV files
 */
async function processCSVFiles() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.csv'));

    const employeeEAForms = new Map();

    for (const file of files) {
        console.log(`\nProcessing ${file}...`);
        const filePath = path.join(rawDataDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        let currentEmployee = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for employee number
            if (line.startsWith('Employee No.')) {
                const parts = line.split(',');
                if (parts[3] && parts[3].trim()) {
                    currentEmployee = parts[3].trim();
                }
            }

            // After finding employee number, look ahead for PCB group
            if (line.startsWith('Employee No.') && currentEmployee) {
                const pcbCode = extractPCBFromCSV(lines, i);
                if (pcbCode) {
                    const eaForm = PCB_TO_EA_FORM[pcbCode];
                    if (eaForm) {
                        employeeEAForms.set(currentEmployee, {
                            pcb_code: pcbCode,
                            ea_form: eaForm
                        });
                        console.log(`  ✓ ${currentEmployee}: PCB ${pcbCode} → ${eaForm}`);
                    }
                }
            }
        }
    }

    return employeeEAForms;
}

/**
 * Process TXT files for missing data
 */
async function processTXTFiles(existingData) {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

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

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('Employee No.')) {
                let employeeNo = null;
                const directMatch = line.match(/Employee No\.\s+([A-Z]+\d+)/);
                
                if (directMatch) {
                    employeeNo = directMatch[1];
                }

                if (employeeNo && !existingData.has(employeeNo)) {
                    const pcbCode = extractPCBFromTXT(lines, i);
                    if (pcbCode) {
                        const eaForm = PCB_TO_EA_FORM[pcbCode];
                        if (eaForm) {
                            // Convert to database format
                            const number = employeeNo.replace(/[A-Za-z]+/, '');
                            const prefix = companyMap[companyCode] || companyCode;
                            
                            let formattedNumber = number;
                            if (prefix === 'ST' && !number.startsWith('0') && number.length < 4) {
                                formattedNumber = '0' + number.padStart(3, '0');
                            }
                            
                            const dbEmployeeNo = prefix + formattedNumber;
                            
                            existingData.set(dbEmployeeNo, {
                                pcb_code: pcbCode,
                                ea_form: eaForm
                            });
                            console.log(`  ✓ ${dbEmployeeNo}: PCB ${pcbCode} → ${eaForm}`);
                        }
                    }
                }
            }
        }
    }

    return existingData;
}

/**
 * Update database with EA form data
 */
async function updateDatabase(employeeEAForms) {
    console.log(`\n💾 Updating EA form data for ${employeeEAForms.size} employees...\n`);
    
    let updated = 0;
    let errors = 0;

    for (const [employeeNo, data] of employeeEAForms) {
        const { error } = await supabase
            .from('master_hr2000')
            .update({
                ea_form: data.ea_form,
                updated_at: new Date().toISOString()
            })
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
            errors++;
        } else {
            updated++;
            if (updated % 50 === 0) {
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
async function migrateEAForm() {
    console.log('🔍 Starting EA Form migration...');
    console.log('Mapping PCB/Tax Group codes to EA form categories\n');

    // Process CSV files first
    let employeeEAForms = await processCSVFiles();

    // Process TXT files for additional data
    employeeEAForms = await processTXTFiles(employeeEAForms);

    if (employeeEAForms.size === 0) {
        console.log('\n⚠️  No EA form data found in raw files.');
        return;
    }

    // Update database
    await updateDatabase(employeeEAForms);

    // Verify migration
    console.log('\n🔍 Verifying EA form migration...\n');
    
    const { data: stats, error: statsError } = await supabase
        .from('master_hr2000')
        .select('ea_form')
        .not('ea_form', 'is', null);

    if (!statsError && stats) {
        const eaFormCounts = {};
        stats.forEach(row => {
            eaFormCounts[row.ea_form] = (eaFormCounts[row.ea_form] || 0) + 1;
        });

        console.log('📊 EA Form Distribution:');
        Object.entries(eaFormCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([form, count]) => {
                console.log(`  ${form}: ${count} employees`);
            });
    }

    // Show samples
    const { data: samples, error: sampleError } = await supabase
        .from('master_hr2000')
        .select('employee_no, employee_name, ea_form')
        .not('ea_form', 'is', null)
        .limit(5);

    if (!sampleError && samples) {
        console.log('\n📋 Sample records:');
        samples.forEach(emp => {
            console.log(`  ${emp.employee_no}: ${emp.ea_form}`);
        });
    }
}

// Run migration
if (require.main === module) {
    migrateEAForm().catch(console.error);
}

module.exports = { migrateEAForm };