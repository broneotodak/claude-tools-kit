#!/usr/bin/env node

/**
 * THR PERKESO/SOCSO Code Migration
 * Migrates SOCSO information from raw data into master_hr2000 table
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

        // Extract SOCSO/KSPA Number
        if (line.includes('SOCSO / KSPA No')) {
            const parts = line.split('SOCSO / KSPA No');
            if (parts.length > 1) {
                // Extract the number after SOCSO / KSPA No
                const afterSocso = parts[1].trim();
                // Get the number before any other field like "PCB /Tax Group"
                const socsoMatch = afterSocso.match(/^(\S+)/);
                if (socsoMatch) {
                    currentEmployee.socso_no = socsoMatch[1];
                }
            }
        }

        // Extract SOCSO Group
        if (line.includes('SOCSO Group')) {
            const parts = line.split('SOCSO Group');
            if (parts.length > 1) {
                const groupValue = parts[1].trim();
                // Extract just the code (S1, S2, etc.)
                const groupMatch = groupValue.match(/^(S\d+)/);
                if (groupMatch) {
                    currentEmployee.socso_group = groupMatch[1];
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

        // Skip if no SOCSO data
        if (!employee.socso_no && !employee.socso_group) {
            continue;
        }

        // Update the record
        const { error } = await supabase
            .from('master_hr2000')
            .update({
                perkeso_code: employee.socso_no || null,
                socso_group: employee.socso_group || null,
                updated_at: new Date().toISOString()
            })
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
        } else {
            console.log(`✅ Updated SOCSO data for ${employeeNo}: ${employee.socso_no || 'N/A'} (Group: ${employee.socso_group || 'N/A'})`);
            updated++;
        }
    }

    return updated;
}

/**
 * Main migration function
 */
async function migratePerkeso() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    console.log('🔍 Starting PERKESO/SOCSO migration...');
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
        .select('employee_no, perkeso_code, socso_group')
        .not('perkeso_code', 'is', null)
        .limit(5);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: ${record.perkeso_code} (Group: ${record.socso_group || 'N/A'})`);
        });
    }
}

// Run migration
if (require.main === module) {
    migratePerkeso().catch(console.error);
}

module.exports = { migratePerkeso };