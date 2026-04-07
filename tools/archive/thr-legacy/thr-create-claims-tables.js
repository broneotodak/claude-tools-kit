#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function createClaimsTables() {
    console.log('📋 Creating Claims Tables...\n');
    
    try {
        // 1. Create claim types table
        console.log('Creating thr_claim_types...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_claim_types (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    max_amount DECIMAL(12,2),
                    requires_receipt BOOLEAN DEFAULT true,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `
        });
        
        // 2. Create claims table
        console.log('Creating thr_claims...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_claims (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    employee_id UUID REFERENCES thr_employees(id) ON DELETE CASCADE,
                    claim_type_id UUID REFERENCES thr_claim_types(id),
                    claim_date DATE NOT NULL,
                    amount DECIMAL(12,2) NOT NULL,
                    description TEXT,
                    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
                    
                    -- Approval workflow
                    submitted_at TIMESTAMP WITH TIME ZONE,
                    approved_by UUID REFERENCES thr_employees(id),
                    approved_at TIMESTAMP WITH TIME ZONE,
                    rejection_reason TEXT,
                    
                    -- Additional fields
                    receipt_urls JSONB DEFAULT '[]'::jsonb,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `
        });
        
        // 3. Create claim attachments table
        console.log('Creating thr_claim_attachments...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS thr_claim_attachments (
                    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                    claim_id UUID REFERENCES thr_claims(id) ON DELETE CASCADE,
                    file_name VARCHAR(255) NOT NULL,
                    file_url TEXT NOT NULL,
                    file_size INTEGER,
                    mime_type VARCHAR(100),
                    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `
        });
        
        // 4. Insert default claim types
        console.log('\nInserting default claim types...');
        const claimTypes = [
            { code: 'MEDICAL', name: 'Medical', description: 'Medical expenses reimbursement', max_amount: 5000 },
            { code: 'TRAVEL', name: 'Travel', description: 'Travel and transportation expenses', max_amount: 2000 },
            { code: 'MEAL', name: 'Meal', description: 'Meal and entertainment allowance', max_amount: 500 },
            { code: 'TRAINING', name: 'Training', description: 'Training and development expenses', max_amount: 10000 },
            { code: 'EQUIPMENT', name: 'Equipment', description: 'Office equipment and supplies', max_amount: 3000 },
            { code: 'PHONE', name: 'Phone Bill', description: 'Mobile phone bill reimbursement', max_amount: 300 },
            { code: 'INTERNET', name: 'Internet', description: 'Internet subscription reimbursement', max_amount: 200 },
            { code: 'OTHER', name: 'Other', description: 'Other miscellaneous claims', max_amount: 1000 }
        ];
        
        const { error: insertError } = await supabase
            .from('thr_claim_types')
            .upsert(claimTypes, { onConflict: 'code' });
        
        if (insertError) {
            console.error('Error inserting claim types:', insertError);
        } else {
            console.log('✅ Claim types inserted successfully');
        }
        
        // 5. Create indexes
        console.log('\nCreating indexes...');
        await supabase.rpc('exec_sql', {
            sql: `
                CREATE INDEX IF NOT EXISTS idx_claims_employee_id ON thr_claims(employee_id);
                CREATE INDEX IF NOT EXISTS idx_claims_status ON thr_claims(status);
                CREATE INDEX IF NOT EXISTS idx_claims_claim_date ON thr_claims(claim_date);
                CREATE INDEX IF NOT EXISTS idx_claim_attachments_claim_id ON thr_claim_attachments(claim_id);
            `
        });
        
        console.log('\n✅ Claims tables created successfully!');
        
    } catch (error) {
        console.error('❌ Error creating claims tables:', error);
    }
}

createClaimsTables().catch(console.error);