#!/usr/bin/env node

/**
 * THR PCB Tax Group Migration
 * Migrates PCB tax group information from raw data into master_hr2000 table
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

        // Extract PCB /Tax Group
        if (line.includes('PCB /Tax Group')) {
            // Find the position of "PCB /Tax Group"
            const taxGroupIndex = line.indexOf('PCB /Tax Group');
            if (taxGroupIndex !== -1) {
                // Get everything after "PCB /Tax Group"
                const afterTaxGroup = line.substring(taxGroupIndex + 'PCB /Tax Group'.length).trim();
                
                // Extract the tax group (format: XX-Description)
                const taxGroupMatch = afterTaxGroup.match(/^(\d{2}-[^\/\n]+)/);
                if (taxGroupMatch) {
                    const fullTaxGroup = taxGroupMatch[1].trim();
                    currentEmployee.pcb_tax_group = fullTaxGroup;
                    
                    // Also extract just the code
                    const codeMatch = fullTaxGroup.match(/^(\d{2})/);
                    if (codeMatch) {
                        currentEmployee.pcb_code = codeMatch[1];
                    }
                }
            }
        }

        // Extract PTPTN No
        if (line.includes('PTPTN No')) {
            const parts = line.split('PTPTN No');
            if (parts.length > 1) {
                const afterPtptn = parts[1].trim();
                // Get the PTPTN number before any other field
                const ptptnMatch = afterPtptn.match(/^(\S+)/);
                if (ptptnMatch && ptptnMatch[1] !== '') {
                    currentEmployee.ptptn_no = ptptnMatch[1];
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

        // Skip if no PCB data
        if (!employee.pcb_code && !employee.ptptn_no) {
            continue;
        }

        // Update the record
        const updateData = {
            updated_at: new Date().toISOString()
        };
        
        if (employee.pcb_code) {
            updateData.pcb = employee.pcb_code;
        }
        
        // Store full tax group in a separate field if needed
        // if (employee.pcb_tax_group) {
        //     updateData.pcb_tax_group = employee.pcb_tax_group;
        // }
        
        // if (employee.ptptn_no) {
        //     updateData.ptptn_no = employee.ptptn_no;
        // }

        const { error } = await supabase
            .from('master_hr2000')
            .update(updateData)
            .eq('employee_no', employeeNo);

        if (error) {
            console.error(`❌ Error updating ${employeeNo}:`, error.message);
        } else {
            console.log(`✅ Updated PCB data for ${employeeNo}: PCB code ${employee.pcb_code || 'N/A'} (${employee.pcb_tax_group || 'N/A'})`);
            updated++;
        }
    }

    return updated;
}

/**
 * Main migration function
 */
async function migratePCB() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    console.log('🔍 Starting PCB tax group migration...');
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
        .select('employee_no, pcb')
        .not('pcb', 'is', null)
        .limit(10);

    if (!verifyError && verifyData) {
        console.log('\n✅ Sample migrated records:');
        verifyData.forEach(record => {
            console.log(`  ${record.employee_no}: PCB code ${record.pcb}`);
        });
    }

    // Show PCB code distribution
    const { data: pcbData } = await supabase
        .from('master_hr2000')
        .select('pcb')
        .not('pcb', 'is', null);

    if (pcbData) {
        const pcbCounts = {};
        pcbData.forEach(record => {
            pcbCounts[record.pcb] = (pcbCounts[record.pcb] || 0) + 1;
        });
        
        console.log('\n📊 PCB Code Distribution:');
        Object.entries(pcbCounts)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([code, count]) => {
                console.log(`  ${code}: ${count} employees`);
            });
    }
}

// Run migration
if (require.main === module) {
    migratePCB().catch(console.error);
}

module.exports = { migratePCB };