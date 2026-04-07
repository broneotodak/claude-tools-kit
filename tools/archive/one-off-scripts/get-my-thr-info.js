#!/usr/bin/env node

/**
 * Get personal info from THR database
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/THR/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getMyInfo() {
  // First, check what columns exist
  const { data: sample } = await supabase
    .from('thr_employees')
    .select('*')
    .limit(1);

  if (sample && sample[0]) {
    console.log('Available columns:', Object.keys(sample[0]).join(', '));
  }

  // Search for the owner/admin (likely hafiz or neo)
  const { data, error } = await supabase
    .from('thr_employees')
    .select('*')
    .eq('access_level', 8)  // Super Admin
    .limit(5);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  if (data && data.length > 0) {
    console.log('\n=== SUPER ADMINS (Level 8) ===');
    data.forEach((emp, i) => {
      console.log(`\n--- ${i + 1}. ${emp.full_name || 'Unknown'} ---`);
      console.log('Employee ID:', emp.employee_id);
      console.log('Full Name:', emp.full_name);
      console.log('Position:', emp.position);
      console.log('Department:', emp.department);
      console.log('Access Level:', emp.access_level);

      // Contact info
      if (emp.contact_info) {
        console.log('Emails:', JSON.stringify(emp.contact_info.emails || {}));
        console.log('Phone:', emp.contact_info.phone || emp.contact_info.mobile);
      }

      // Personal info
      if (emp.personal_info) {
        console.log('IC/ID:', emp.personal_info.ic_number || emp.personal_info.id_number);
        console.log('Gender:', emp.personal_info.gender);
        console.log('DOB:', emp.personal_info.date_of_birth);
        console.log('Nationality:', emp.personal_info.nationality);
      }

      // Employment info
      if (emp.employment_info) {
        console.log('Status:', emp.employment_info.employment_status);
        console.log('Join Date:', emp.employment_info.join_date);
      }
    });
  } else {
    console.log('No super admins found');
  }
}

getMyInfo().catch(console.error);
