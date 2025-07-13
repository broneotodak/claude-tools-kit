#!/usr/bin/env node

/**
 * THR LHDN (Income Tax) Number Migration
 * Migrates Income Tax information from raw data into master_hr2000 table
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
 * Process a single employee master file
 */
async function processEmployeeMaster(filePath) {
    const companyCode = path.basename(filePath).split('_')[0];
    console.log(`\nProcessing ${path.basename(filePath)}...`);
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const employees = [];
    let currentEmployee = {};

    // Parse the file content
    const lines = fileContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('Employee No.')) {
            if (Object.keys(currentEmployee).length > 0) {
                employees.push(currentEmployee);
            }
            currentEmployee = {
                raw_no: line.split('Employee No.')[1].trim()
            };
            continue;
        }

        // Extract Income Tax Number
        if (line.includes('Income Tax No')) {
            // Check if this line contains actual tax number
            const taxMatch = line.match(/Income Tax No\s+([A-Z]{2}\s*\d{11})/);
            if (taxMatch) {
                currentEmployee.income_tax_no = taxMatch[1].trim();
            }
            // If no match, it means the field is empty (runs into "Overtime Group")
        }

        // Extract Income Tax Branch
        if (line.includes('Income Tax Branch')) {
            const parts = line.split('Income Tax Branch');
            if (parts.length > 1) {
                const branchValue = parts[1].trim();
                // Extract branch value before any other field
                const branchMatch = branchValue.match(/^([^/]+?)(?:\s+Work\/NPL Group|$)/);
                if (branchMatch) {
                    const branch = branchMatch[1].trim();
                    if (branch && branch !== '') {
                        currentEmployee.income_tax_branch = branch;
                    }
                }
            }
        }
    }

    // Add last employee
    if (Object.keys(currentEmployee).length > 0) {
        employees.push(currentEmployee);
    }

    // Company code mapping
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

    // Update master_hr2000 table
    let updated = 0;
    for (const employee of employees) {
        // Convert employee number to database format
        const number = employee.raw_no.replace(/[A-Za-z]+/, '');
        const prefix = companyMap[companyCode] || companyCode;
        
        // Build employee number
        let formattedNumber = number;
        if (prefix === 'ST' && !number.startsWith('0') && number.length < 4) {
            formattedNumber = '0' + number.padStart(3, '0');
        }
        
        const employeeNo = prefix + formattedNumber;

        // Skip if no tax data
        if (!employee.income_tax_no && !employee.income_tax_branch) {
            continue;
        }

        // Update the record
        const updateData = {
            updated_at: new Date().toISOString()
        };
        
        if (employee.income_tax_no) {
            updateData.lhdn_no = employee.income_tax_no;
        }
        
        // Skip income_tax_branch for now until column is added
        // if (employee.income_tax_branch) {
        //     updateData.income_tax_branch = employee.income_tax_branch;
        // }

        const { error } = await supabase
            .from('master_hr2000')
            .update(updateData)
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
        } else {
            console.log(`✅ Updated LHDN data for ${employeeNo}: ${employee.income_tax_no || 'N/A'} (Branch: ${employee.income_tax_branch || 'N/A'})`);
            updated++;
        }
    }

    return updated;
}

/**
 * Main migration function
 */
async function migrateLHDN() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    console.log('🔍 Starting LHDN (Income Tax) migration...');
    console.log(`Found ${files.length} employee master files\n`);
    
    let totalUpdated = 0;

    for (const file of files) {
        const filePath = path.join(rawDataDir, file);
        const updated = await processEmployeeMaster(filePath);
        totalUpdated += updated;
    }

    console.log('\n📊 Migration Summary:');
    console.log(`Total files processed: ${files.length}`);
    console.log(`Total records updated: ${totalUpdated}`);

    // Verify migration
    const { data: verifyData, error: verifyError } = await supabase
        .from('master_hr2000')
        .select('employee_no, lhdn_no')
        .not('lhdn_no', 'is', null)
        .limit(10);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: ${record.lhdn_no}`);
        });
    }

    // Show breakdown by prefix
    const { data: prefixData, error: prefixError } = await supabase
        .from('master_hr2000')
        .select('lhdn_no')
        .not('lhdn_no', 'is', null);

    if (!prefixError && prefixData) {
        const prefixCounts = {};
        prefixData.forEach(record => {
            const prefix = record.lhdn_no.substring(0, 2);
            prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
        });
        
        console.log('\n📊 LHDN Number Prefix Distribution:');
        Object.entries(prefixCounts).forEach(([prefix, count]) => {
            console.log(`  ${prefix}: ${count} records`);
        });
    }
}

// Run migration
if (require.main === module) {
    migrateLHDN().catch(console.error);
}

module.exports = { migrateLHDN };