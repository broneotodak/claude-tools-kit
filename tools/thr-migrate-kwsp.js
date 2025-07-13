#!/usr/bin/env node

/**
 * THR KWSP/EPF Contribution Migration
 * Migrates EPF contribution rates from raw data into master_hr2000 table
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

// EPF Group to contribution rate mapping
const EPF_RATES = {
    'E1': {
        employee: 11,  // Employee contributes 11%
        employer: 13   // Employer contributes 13% (standard rate)
    },
    'E6': {
        employee: 11,  // Employee contributes 11%
        employer: 13   // Employer contributes 13% (standard rate)
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

        // Extract EPF Number
        if (line.includes('Epf No')) {
            const parts = line.split('Epf No');
            if (parts.length > 1) {
                const afterEpf = parts[1].trim();
                // Extract EPF number (usually 8 digits)
                const epfMatch = afterEpf.match(/^(\d{8})/);
                if (epfMatch) {
                    currentEmployee.epf_no = epfMatch[1];
                }
            }
        }

        // Extract EPF Group
        if (line.includes('EPF Group')) {
            const parts = line.split('EPF Group');
            if (parts.length > 1) {
                const groupValue = parts[1].trim();
                // Extract just the code (E1, E6, etc.)
                const groupMatch = groupValue.match(/^(E\d+)/);
                if (groupMatch) {
                    currentEmployee.epf_group = groupMatch[1];
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

        // Skip if no EPF group
        if (!employee.epf_group) {
            continue;
        }

        // Get contribution rates based on EPF group
        const rates = EPF_RATES[employee.epf_group];
        if (!rates) {
            console.log(`⚠️  Unknown EPF group ${employee.epf_group} for ${employeeNo}`);
            continue;
        }

        // Update the record
        const updateData = {
            kwsp_employee: rates.employee,
            kwsp_employer: rates.employer,
            epf_group: employee.epf_group,
            updated_at: new Date().toISOString()
        };
        
        // Skip EPF number for now until column is added
        // if (employee.epf_no) {
        //     updateData.epf_no = employee.epf_no;
        // }

        const { error } = await supabase
            .from('master_hr2000')
            .update(updateData)
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
        } else {
            console.log(`✅ Updated KWSP rates for ${employeeNo}: Employee ${rates.employee}%, Employer ${rates.employer}% (Group: ${employee.epf_group})`);
            updated++;
        }
    }

    return updated;
}

/**
 * Main migration function
 */
async function migrateKWSP() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    console.log('🔍 Starting KWSP/EPF contribution rates migration...');
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
        .select('employee_no, kwsp_employee, kwsp_employer, epf_group')
        .not('kwsp_employee', 'is', null)
        .limit(10);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: Employee ${record.kwsp_employee}%, Employer ${record.kwsp_employer}% (Group: ${record.epf_group})`);
        });
    }

    // Show EPF group distribution
    const { data: groupData } = await supabase
        .from('master_hr2000')
        .select('kwsp_employee, kwsp_employer')
        .not('kwsp_employee', 'is', null);

    if (groupData) {
        const stats = {
            'E1 (11%/13%)': 0,
            'E6 (11%/13%)': 0
        };
        
        groupData.forEach(record => {
            if (record.kwsp_employee === 11 && record.kwsp_employer === 13) {
                // Both E1 and E6 have same rates, so we can't distinguish here
                stats['E1/E6 (11%/13%)'] = (stats['E1/E6 (11%/13%)'] || 0) + 1;
            }
        });
        
        console.log('\n📊 KWSP/EPF Rate Distribution:');
        console.log(`  Standard Rate (11%/13%): ${groupData.length} employees`);
    }
}

// Run migration
if (require.main === module) {
    migrateKWSP().catch(console.error);
}

module.exports = { migrateKWSP };