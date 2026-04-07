#!/usr/bin/env node

/**
 * THR Spouse Details Migration
 * Migrates spouse information from raw data into master_hr2000 table
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

// Tax group mapping
const TAX_GROUP_PATTERNS = {
    'Spouse working': {
        pattern: /(\d+)-Spouse working \((\d+) child\)/,
        working: true
    },
    'Spouse not working': {
        pattern: /(\d+)-Spouse not working \((\d+) child\)/,
        working: false
    }
};

/**
 * Extract spouse details from employee data
 */
function extractSpouseDetails(employeeData) {
    const spouseDetails = {
        name: employeeData.spouse_name || null,
        ic_number: employeeData.spouse_ic || null,
        income_tax_number: employeeData.spouse_income_tax_no || null,
        income_tax_branch: employeeData.spouse_income_tax_branch || null,
        working_status: null,
        children_count: parseInt(employeeData.children_count) || 0,
        marital_status: employeeData.marital_status || null
    };

    // Extract working status from tax group
    const taxGroup = employeeData.tax_group;
    if (taxGroup) {
        for (const [key, config] of Object.entries(TAX_GROUP_PATTERNS)) {
            const match = taxGroup.match(config.pattern);
            if (match) {
                spouseDetails.working_status = config.working;
                spouseDetails.tax_group_code = match[1];
                spouseDetails.children_count = parseInt(match[2]);
                break;
            }
        }
    }

    // Only return if we have any spouse data
    const hasData = Object.values(spouseDetails).some(val => val !== null);
    return hasData ? spouseDetails : null;
}

/**
 * Process a single employee master file
 */
async function processEmployeeMaster(filePath) {
    const companyCode = path.basename(filePath).split('_')[0];
    console.log(`Company code: ${companyCode}...`);
    console.log(`Processing ${path.basename(filePath)}...`);
    
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
                // Get raw employee number
                raw_no: line.split('Employee No.')[1].trim()
            };
            continue;
        }

        // Extract spouse details section
        if (line === 'SPOUSE DETAIL') {
            // Parse spouse details section carefully
            const spouseDetailsStart = i;
            let spouseName, spouseIC, spouseTaxNo, spouseTaxBranch;
            
            // Skip header line
            i++;
            
            // Read next few lines for spouse details
            for (let j = spouseDetailsStart + 1; j < spouseDetailsStart + 5 && j < lines.length; j++) {
                const line = lines[j];
                
                // Handle space-aligned columns
                if (line.includes('Name')) {
                    // Split by multiple spaces
                    const parts = line.split(/\s{2,}/).filter(Boolean);
                    
                    // Find name and IC
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();
                        if (part === 'Name') {
                            if (i + 1 < parts.length && !parts[i + 1].includes('I/C No')) {
                                spouseName = parts[i + 1];
                            }
                        }
                        if (part.includes('I/C No (Old/ New)')) {
                            if (i + 1 < parts.length) {
                                spouseIC = parts[i + 1];
                            }
                        }
                    }
                }
                
                if (line.includes('Income Tax No')) {
                    // Tax info is on the same line, split by spaces
                    const taxParts = line.split(/\s{2,}/).filter(Boolean);
                    
                    // Find tax no and branch
                    for (let i = 0; i < taxParts.length; i++) {
                        const part = taxParts[i].trim();
                        if (part === 'Income Tax No') {
                            if (i + 1 < taxParts.length && !taxParts[i + 1].includes('Income Tax Branch')) {
                                spouseTaxNo = taxParts[i + 1];
                            }
                        }
                        if (part === 'Income Tax Branch') {
                            if (i + 1 < taxParts.length) {
                                spouseTaxBranch = taxParts[i + 1];
                            }
                        }
                    }
                }
            }

            if (spouseName || spouseIC || spouseTaxNo || spouseTaxBranch) {
                currentEmployee.spouse_name = spouseName;
                currentEmployee.spouse_ic = spouseIC;
                currentEmployee.spouse_income_tax_no = spouseTaxNo;
                currentEmployee.spouse_income_tax_branch = spouseTaxBranch;
            }
        }

        // Extract other relevant fields
        if (line.includes('Marital Status')) {
            currentEmployee.marital_status = line.split('Marital Status')[1].trim();
        }
        if (line.includes('No. of Children')) {
            currentEmployee.children_count = line.split('No. of Children')[1].trim();
        }
        if (line.includes('PCB /Tax Group')) {
            currentEmployee.tax_group = line.split('PCB /Tax Group')[1].trim();
        }
    }

    // Add last employee
    if (Object.keys(currentEmployee).length > 0) {
        employees.push(currentEmployee);
    }

    // Update master_hr2000 table
    for (const employee of employees) {
        // Convert employee number to database format
        let employeeNo = employee.raw_no;
        
        // Mapping of company codes
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

        // Remove company code if present
        const number = employeeNo.replace(/[A-Za-z]+/, '');
        
        // Add standard company prefix
        const prefix = companyMap[companyCode] || companyCode;
        
        // Build employee number, handling both formats (001 and 0001)
        let formattedNumber = number;
        if (prefix === 'ST' && !number.startsWith('0') && number.length < 4) {
            formattedNumber = '0' + number.padStart(3, '0');
        }
        
        employee.employee_no = prefix + formattedNumber;
        let spouseDetails = extractSpouseDetails(employee);
        if (!spouseDetails) continue;

        // First verify the employee exists
        const { data: existingEmployee, error: findError } = await supabase
            .from('master_hr2000')
            .select('employee_no, spouse_details')
            .eq('employee_no', employee.employee_no)
            .single();

        if (findError || !existingEmployee) {
            console.error(`❌ Employee ${employee.employee_no} not found in master_hr2000`);
            continue;
        }

        // If we already have spouse details, merge with new data
        if (existingEmployee.spouse_details) {
            const existingSpouse = existingEmployee.spouse_details;
            console.log(`⚠️  Employee ${employee.employee_no} has existing spouse details. Merging...`);
            
            // Keep existing data if present
            spouseDetails = {
                ...spouseDetails,
                name: existingSpouse.name || spouseDetails.name,
                ic_number: existingSpouse.ic_number || spouseDetails.ic_number,
                income_tax_number: existingSpouse.income_tax_number || spouseDetails.income_tax_number,
                income_tax_branch: existingSpouse.income_tax_branch || spouseDetails.income_tax_branch,
                working_status: existingSpouse.working_status || spouseDetails.working_status,
                children_count: existingSpouse.children_count || spouseDetails.children_count,
                marital_status: existingSpouse.marital_status || spouseDetails.marital_status,
                tax_group_code: existingSpouse.tax_group_code || spouseDetails.tax_group_code
            };
        }

        // Proceed with update if verification passed
        const { error } = await supabase
            .from('master_hr2000')
            .update({
                spouse_details: spouseDetails,
                updated_at: new Date().toISOString()
            })
            .eq('employee_no', employee.employee_no);

        if (error) {
            console.error(`Error updating ${employee.employee_no}:`, error);
        } else {
            console.log(`✅ Updated spouse details for ${employee.employee_no}`);
        }
    }

    return employees.length;
}

/**
 * Main migration function
 */
async function migrateSpouseDetails() {
    const rawDataDir = '/Users/broneotodak/Projects/THR/raw_data';
    const files = fs.readdirSync(rawDataDir)
        .filter(f => f.endsWith('_Employee Master.txt'));

    // First verify existing data
    console.log('Verifying existing data in master_hr2000...');
    const { data: existingData, error: checkError } = await supabase
        .from('master_hr2000')
        .select('employee_no, spouse_details')
        .not('spouse_details', 'is', null);

    if (checkError) {
        console.error('❌ Error checking existing data:', checkError);
        return;
    }

    console.log(`Found ${existingData?.length || 0} records with existing spouse details\n`);

    console.log(`Found ${files.length} employee master files\n`);
    
    let totalProcessed = 0;
    let totalUpdated = 0;

    for (const file of files) {
        const filePath = path.join(rawDataDir, file);
        const processed = await processEmployeeMaster(filePath);
        totalProcessed += processed;
    }

    console.log('\nMigration Summary:');
    console.log(`Total files processed: ${files.length}`);
    console.log(`Total employees processed: ${totalProcessed}`);

    // Verify migration
    const { data: verifyData, error: verifyError } = await supabase
        .from('master_hr2000')
        .select('id')
        .not('spouse_details', 'is', null);

    if (!verifyError) {
        console.log(`Total records with spouse details: ${verifyData.length}`);
    }
}

// Run migration
if (require.main === module) {
    migrateSpouseDetails().catch(console.error);
}

module.exports = { migrateSpouseDetails, extractSpouseDetails };