#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function addSampleClaims() {
    console.log('📋 Adding Sample Claims Data...\n');
    
    try {
        // Get a few employees
        const { data: employees } = await supabase
            .from('thr_employees')
            .select('id, full_name, employee_no')
            .in('employee_no', ['TS001', 'TS002', 'TS003', 'TS004', 'TS005'])
            .limit(5);
        
        if (!employees || employees.length === 0) {
            console.log('No employees found');
            return;
        }
        
        console.log(`Found ${employees.length} employees`);
        
        // Sample claims data
        const claimTypes = ['MEDICAL', 'TRAVEL', 'MEAL', 'EQUIPMENT', 'TRAINING'];
        const statuses = ['pending', 'approved', 'rejected'];
        
        const sampleClaims = [];
        
        // Generate claims for each employee
        employees.forEach((emp, index) => {
            // Each employee gets 2-3 claims
            const numClaims = 2 + Math.floor(Math.random() * 2);
            
            for (let i = 0; i < numClaims; i++) {
                const claimType = claimTypes[Math.floor(Math.random() * claimTypes.length)];
                const status = statuses[Math.floor(Math.random() * statuses.length)];
                const daysAgo = Math.floor(Math.random() * 60);
                const claimDate = new Date();
                claimDate.setDate(claimDate.getDate() - daysAgo);
                
                const claim = {
                    employee_id: emp.id,
                    claim_type: claimType,
                    claim_date: claimDate.toISOString().split('T')[0],
                    amount: Math.floor(Math.random() * 2000) + 100,
                    status: status,
                    description: getClaimDescription(claimType),
                };
                
                // If approved, add approval info
                if (status === 'approved') {
                    claim.approved_by = employees[0].id; // Neo approves
                    claim.approved_date = new Date(claimDate.getTime() + 86400000).toISOString().split('T')[0];
                }
                
                sampleClaims.push(claim);
            }
        });
        
        console.log(`\nInserting ${sampleClaims.length} sample claims...`);
        
        const { error } = await supabase
            .from('thr_claims')
            .insert(sampleClaims);
        
        if (error) {
            console.error('Error inserting claims:', error);
        } else {
            console.log('✅ Sample claims added successfully!');
            
            // Show summary
            const { data: summary } = await supabase
                .from('thr_claims')
                .select('status')
                .in('employee_id', employees.map(e => e.id));
            
            if (summary) {
                const counts = summary.reduce((acc, claim) => {
                    acc[claim.status] = (acc[claim.status] || 0) + 1;
                    return acc;
                }, {});
                
                console.log('\nClaims Summary:');
                Object.entries(counts).forEach(([status, count]) => {
                    console.log(`  ${status}: ${count}`);
                });
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

function getClaimDescription(type) {
    const descriptions = {
        MEDICAL: [
            'Clinic visit for health checkup',
            'Prescription medication',
            'Specialist consultation',
            'Medical test and screening',
        ],
        TRAVEL: [
            'Client meeting travel expenses',
            'Conference attendance in KL',
            'Project site visit transportation',
            'Business trip accommodation',
        ],
        MEAL: [
            'Team lunch meeting',
            'Client entertainment dinner',
            'Working overtime meal allowance',
            'Department celebration meal',
        ],
        EQUIPMENT: [
            'Ergonomic mouse and keyboard',
            'Monitor stand for home office',
            'Office supplies and stationery',
            'External hard drive for backup',
        ],
        TRAINING: [
            'Online certification course',
            'Professional development workshop',
            'Technical skills training',
            'Leadership development program',
        ],
    };
    
    const options = descriptions[type] || ['General expense claim'];
    return options[Math.floor(Math.random() * options.length)];
}

addSampleClaims().catch(console.error);