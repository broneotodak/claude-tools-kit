#!/usr/bin/env node

/**
 * THR EIS (Employment Insurance System) Migration
 * Migrates EIS contribution rates from raw data into master_hr2000 table
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

// EIS contribution rates (Malaysian standard)
const EIS_RATES = {
    'S1': {
        employee: 0.2,  // 0.2% of salary
        employer: 0.2   // 0.2% of salary
    }
};

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

        // Extract EIS Group
        if (line.includes('EIS')) {
            // Look for EIS group pattern
            const eisMatch = line.match(/EIS\s+(S\d+)/);
            if (eisMatch) {
                currentEmployee.eis_group = eisMatch[1];
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

        // Skip if no EIS group
        if (!employee.eis_group) {
            continue;
        }

        // Get contribution rates based on EIS group
        const rates = EIS_RATES[employee.eis_group];
        if (!rates) {
            console.log(`⚠️  Unknown EIS group ${employee.eis_group} for ${employeeNo}`);
            continue;
        }

        // Update the record
        const updateData = {
            eis_employee: rates.employee,
            eis_employer: rates.employer,
            eis_group: employee.eis_group,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('master_hr2000')
            .update(updateData)
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
        } else {
            console.log(`✅ Updated EIS rates for ${employeeNo}: Employee ${rates.employee}%, Employer ${rates.employer}% (Group: ${employee.eis_group})`);
            updated++;
        }
    }

    return updated;
}

/**
 * Main migration function
 */
async function migrateEIS() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    console.log('🔍 Starting EIS contribution rates migration...');
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
        .select('employee_no, eis_employee, eis_employer')
        .not('eis_employee', 'is', null)
        .limit(10);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: Employee ${record.eis_employee}%, Employer ${record.eis_employer}%`);
        });
    }
}

// Run migration
if (require.main === module) {
    migrateEIS().catch(console.error);
}

module.exports = { migrateEIS };