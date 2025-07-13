#!/usr/bin/env node

/**
 * THR (Human Resource Management System) Operations
 * Specialized tool for THR database operations
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize THR Supabase client
const supabase = createClient(
  process.env.THR_SUPABASE_URL,
  process.env.THR_SUPABASE_SERVICE_ROLE_KEY
);

// Common THR operations
async function getEmployeeById(employeeId) {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      users (
        name,
        email,
        phone
      ),
      organizations (
        name,
        branch
      )
    `)
    .eq('employee_id', employeeId)
    .single();
    
  if (error) throw error;
  return data;
}

async function getActiveEmployees(organizationId = null) {
  let query = supabase
    .from('employees')
    .select(`
      *,
      users (
        name,
        email,
        phone
      ),
      organizations (
        name,
        branch
      )
    `)
    .eq('active', true);
    
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getOrganizations() {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('active', true)
    .order('display_order');
    
  if (error) throw error;
  return data;
}

async function getEmployeesByOrganization(organizationId) {
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      users (
        name,
        email,
        phone
      )
    `)
    .eq('organization_id', organizationId)
    .order('employee_id');
    
  if (error) throw error;
  return data;
}

async function searchEmployees(searchTerm) {
  // Search in users table joined with employees
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      users!inner (
        name,
        email,
        phone
      ),
      organizations (
        name,
        branch
      )
    `)
    .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`, { foreignTable: 'users' });
    
  if (error) throw error;
  return data;
}

async function getTHRStats() {
  try {
    // Get total employees
    const { count: totalEmployees } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true });
      
    // Get active employees
    const { count: activeEmployees } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('active', true);
      
    // Get organizations
    const { data: organizations } = await supabase
      .from('organizations')
      .select('id, name, branch');
      
    // Get employee count by organization
    const orgStats = [];
    for (const org of organizations) {
      const { count } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id);
        
      orgStats.push({
        organization: org.name,
        branch: org.branch,
        employeeCount: count
      });
    }
    
    return {
      totalEmployees,
      activeEmployees,
      inactiveEmployees: totalEmployees - activeEmployees,
      organizations: organizations.length,
      organizationStats: orgStats
    };
  } catch (error) {
    throw error;
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  try {
    switch (command) {
      case 'stats':
        console.log('📊 THR Statistics\n');
        const stats = await getTHRStats();
        console.log(`Total Employees: ${stats.totalEmployees}`);
        console.log(`Active: ${stats.activeEmployees}`);
        console.log(`Inactive: ${stats.inactiveEmployees}`);
        console.log(`Organizations: ${stats.organizations}\n`);
        console.log('By Organization:');
        stats.organizationStats.forEach(org => {
          console.log(`  ${org.organization} (${org.branch}): ${org.employeeCount} employees`);
        });
        break;
        
      case 'orgs':
      case 'organizations':
        console.log('🏢 Organizations\n');
        const orgs = await getOrganizations();
        orgs.forEach(org => {
          console.log(`${org.display_order}. ${org.name} (${org.branch})`);
          console.log(`   ID: ${org.id}`);
          console.log(`   Active: ${org.active}\n`);
        });
        break;
        
      case 'active':
        console.log('👥 Active Employees\n');
        const active = await getActiveEmployees(arg);
        console.log(`Found ${active.length} active employees\n`);
        active.forEach(emp => {
          console.log(`${emp.employee_id}: ${emp.users?.name || 'No name'}`);
          console.log(`  Email: ${emp.users?.email || 'No email'}`);
          console.log(`  Organization: ${emp.organizations?.name || 'Unknown'}`);
          console.log('');
        });
        break;
        
      case 'search':
        if (!arg) {
          console.error('Please provide a search term');
          process.exit(1);
        }
        console.log(`🔍 Searching for: ${arg}\n`);
        const results = await searchEmployees(arg);
        console.log(`Found ${results.length} employees\n`);
        results.forEach(emp => {
          console.log(`${emp.employee_id}: ${emp.users?.name}`);
          console.log(`  Email: ${emp.users?.email}`);
          console.log(`  Organization: ${emp.organizations?.name}`);
          console.log(`  Active: ${emp.active}`);
          console.log('');
        });
        break;
        
      case 'employee':
        if (!arg) {
          console.error('Please provide an employee ID');
          process.exit(1);
        }
        console.log(`👤 Employee Details: ${arg}\n`);
        const employee = await getEmployeeById(arg);
        console.log(`Name: ${employee.users?.name}`);
        console.log(`Employee ID: ${employee.employee_id}`);
        console.log(`Email: ${employee.users?.email}`);
        console.log(`Phone: ${employee.users?.phone}`);
        console.log(`Organization: ${employee.organizations?.name}`);
        console.log(`Start Date: ${employee.start_date}`);
        console.log(`End Date: ${employee.end_date || 'Current'}`);
        console.log(`Active: ${employee.active}`);
        break;
        
      default:
        console.log('THR Operations Tool\n');
        console.log('Usage:');
        console.log('  ./thr-operations.js stats                    - Show THR statistics');
        console.log('  ./thr-operations.js organizations            - List all organizations');
        console.log('  ./thr-operations.js active [org_id]          - List active employees');
        console.log('  ./thr-operations.js search <term>            - Search employees');
        console.log('  ./thr-operations.js employee <id>            - Get employee details');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getEmployeeById,
  getActiveEmployees,
  getOrganizations,
  getEmployeesByOrganization,
  searchEmployees,
  getTHRStats
};