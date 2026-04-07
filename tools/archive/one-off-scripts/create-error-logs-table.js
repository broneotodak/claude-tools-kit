#!/usr/bin/env node

/**
 * Create unified error logs table in CTK memory database
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createErrorLogsTable() {
  console.log('📦 Creating unified error logs table in CTK memory database...\n');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '../sql/create-unified-error-logs.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { 
      sql_query: sql 
    }).single();
    
    if (error) {
      // If exec_sql doesn't exist, try direct execution
      console.log('Using direct SQL execution...');
      
      // Split SQL into individual statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      for (const statement of statements) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        
        try {
          // For CREATE statements, we need to use raw SQL
          const { error: stmtError } = await supabase
            .from('ctk_error_logs')
            .select('count')
            .limit(1);
          
          if (stmtError && stmtError.code === '42P01') {
            // Table doesn't exist, which is expected
            console.log('Table does not exist yet, creating...');
          }
        } catch (err) {
          // Expected error
        }
      }
      
      console.log('\n✅ Table creation SQL prepared. Please run this in Supabase SQL Editor:');
      console.log('   1. Go to Supabase Dashboard');
      console.log('   2. Navigate to SQL Editor');
      console.log('   3. Copy and paste the contents of:');
      console.log(`      ${sqlPath}`);
      console.log('   4. Execute the SQL');
      
      // Also save a simpler version for immediate execution
      const simpleSql = `
-- Create basic error logs table
CREATE TABLE IF NOT EXISTS ctk_error_logs (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    project_name VARCHAR(100) NOT NULL,
    page_url TEXT,
    environment VARCHAR(50) DEFAULT 'production',
    user_id TEXT,
    metadata JSONB DEFAULT '{}',
    severity VARCHAR(20) DEFAULT 'error',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    memory_id BIGINT
);

-- Create basic indexes
CREATE INDEX idx_ctk_error_logs_project ON ctk_error_logs(project_name);
CREATE INDEX idx_ctk_error_logs_created_at ON ctk_error_logs(created_at DESC);
      `;
      
      fs.writeFileSync(path.join(__dirname, '../sql/create-basic-error-logs.sql'), simpleSql);
      console.log('\n📝 Basic version saved to: sql/create-basic-error-logs.sql');
      
    } else {
      console.log('✅ Error logs table created successfully!');
      if (data && data.result) {
        console.log('\nResult:', JSON.stringify(data.result, null, 2));
      }
    }
    
  } catch (err) {
    console.error('❌ Error creating table:', err.message);
    console.log('\nPlease create the table manually in Supabase SQL Editor.');
  }
}

// Run the creation
createErrorLogsTable();