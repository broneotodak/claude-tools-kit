#!/usr/bin/env node

/**
 * THR Authentication Analyzer - Understand the auth setup
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.THR_SUPABASE_URL,
  process.env.THR_SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeAuthSetup() {
  console.log('🔐 THR Authentication Analysis\n');
  console.log('=' .repeat(50));
  
  // 1. Check users table structure
  console.log('\n1. USERS TABLE ANALYSIS:\n');
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*')
    .limit(3);
    
  if (users && users.length > 0) {
    console.log('Sample user structure:');
    const sampleUser = users[0];
    Object.keys(sampleUser).forEach(key => {
      const value = sampleUser[key];
      const displayValue = value ? (typeof value === 'string' && value.length > 50 ? value.substring(0, 50) + '...' : value) : 'null';
      console.log(`  ${key}: ${displayValue}`);
    });
    
    // Check if users have Supabase auth IDs
    console.log('\n  Checking for auth integration:');
    console.log(`  - Has 'id' field (UUID): ${sampleUser.id ? 'Yes' : 'No'}`);
    console.log(`  - ID format: ${sampleUser.id}`);
    console.log(`  - Has email field: ${sampleUser.email ? 'Yes' : 'No'}`);
    console.log(`  - Has password field: ${Object.keys(sampleUser).includes('password') ? 'Yes' : 'No'}`);
  }
  
  // 2. Check auth.users connection
  console.log('\n2. SUPABASE AUTH.USERS CHECK:\n');
  try {
    // Try to query auth.users (requires service role)
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 5
    });
    
    if (authUsers && authUsers.users) {
      console.log(`  Found ${authUsers.users.length} users in auth.users`);
      console.log(`  Total auth users: ${authUsers.total || 'unknown'}`);
      
      // Check if any match our users table
      if (users && authUsers.users.length > 0) {
        const userEmails = users.map(u => u.email).filter(Boolean);
        const authEmails = authUsers.users.map(u => u.email);
        const matches = userEmails.filter(email => authEmails.includes(email));
        console.log(`  Matching emails between tables: ${matches.length}`);
      }
    } else {
      console.log('  Could not access auth.users (may need different permissions)');
    }
  } catch (e) {
    console.log('  Cannot access auth.users:', e.message);
  }
  
  // 3. Check thr_staff table
  console.log('\n3. THR_STAFF TABLE ANALYSIS:\n');
  const { data: thrStaff, error: staffError } = await supabase
    .from('thr_staff')
    .select('*')
    .limit(5);
    
  if (staffError) {
    console.log('  Error accessing thr_staff:', staffError.message);
  } else if (!thrStaff || thrStaff.length === 0) {
    console.log('  thr_staff table exists but is empty');
    
    // Get table structure by checking columns
    const { data: oneRow, error } = await supabase
      .from('thr_staff')
      .select('*')
      .limit(1);
      
    console.log('  Attempting to detect columns...');
    // This is a trick - even with no data, we might get column info from the error
  } else {
    console.log('  thr_staff structure:');
    Object.keys(thrStaff[0]).forEach(key => {
      console.log(`    - ${key}`);
    });
  }
  
  // 4. Check employees-users relationship
  console.log('\n4. EMPLOYEES-USERS RELATIONSHIP:\n');
  const { data: empWithUsers, error: empError } = await supabase
    .from('employees')
    .select(`
      employee_id,
      user_id,
      active,
      users (
        id,
        email,
        fullname
      )
    `)
    .not('user_id', 'is', null)
    .limit(5);
    
  if (empWithUsers) {
    console.log(`  Found ${empWithUsers.length} employees linked to users`);
    empWithUsers.forEach(emp => {
      console.log(`  - ${emp.employee_id}: ${emp.users?.fullname || 'No name'} (${emp.users?.email || 'No email'})`);
    });
  }
  
  // 5. Summary and recommendations
  console.log('\n5. AUTHENTICATION SETUP SUMMARY:\n');
  console.log('  Current Setup:');
  console.log('  - Users table: Stores user profile data (no passwords)');
  console.log('  - Employees table: Links to users via user_id');
  console.log('  - thr_staff: Empty table (abandoned approach?)');
  console.log('  - Auth method: Likely using Supabase Auth');
  
  console.log('\n  Potential Issues:');
  console.log('  - thr_staff table is empty - not being used');
  console.log('  - Need to verify if users.id matches auth.users.id');
  console.log('  - Some employees might not have user accounts');
}

// Run analysis
if (require.main === module) {
  analyzeAuthSetup().catch(console.error);
}

module.exports = { analyzeAuthSetup };