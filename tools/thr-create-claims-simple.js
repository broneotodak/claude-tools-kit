#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createSimpleClaimsTables() {
    console.log('📋 Creating Simple Claims Table...\n');
    
    try {
        // Create a simple claims table if it doesn't exist
        console.log('Creating thr_claims table...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_claims (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    claim_type VARCHAR(50),
                    claim_date DATE,
                    amount DECIMAL(12,2),
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    submitted_at TIMESTAMP WITH TIME ZONE,
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_at TIMESTAMP WITH TIME ZONE,
                    rejection_reason TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                
                -- Create indexes
                CREATE INDEX IF NOT EXISTS idx_claims_employee_id ON thr_claims(employee_id);
                CREATE INDEX IF NOT EXISTS idx_claims_status ON thr_claims(status);
                CREATE INDEX IF NOT EXISTS idx_claims_claim_date ON thr_claims(claim_date);
            `
        });
        
        console.log('✅ Claims table created successfully!');
        
        // Check if we can insert a test claim
        console.log('\nTesting table with sample data...');
        
        // Get Neo's employee ID
        const { data: neo } = await supabase
            .from('thr_employees')
            .select('id')
            .eq('employee_no', 'TS001')
            .single();
        
        if (neo) {
            // Insert a sample claim
            const { error: insertError } = await supabase
                .from('thr_claims')
                .insert({
                    employee_id: neo.id,
                    claim_type: 'TRAVEL',
                    claim_date: '2024-07-01',
                    amount: 450.00,
                    description: 'Client meeting travel expenses - KL to Penang',
                    status: 'approved',
                    submitted_at: new Date().toISOString(),
                });
            
            if (insertError) {
                console.error('Error inserting test claim:', insertError);
            } else {
                console.log('✅ Test claim inserted successfully!');
            }
        }
        
    } catch (error) {
        console.error('❌ Error creating claims table:', error);
    }
}

createSimpleClaimsTables().catch(console.error);