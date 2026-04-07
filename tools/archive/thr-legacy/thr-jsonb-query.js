#!/usr/bin/env node

/**
 * THR JSONB Query Tool
 * Powerful queries on JSONB data structure
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Query builders for JSONB
const queries = {
  // Find employees by IC number
  async findByIC(icNumber) {
    const { data, error } = await supabase
      .from('hr2000_master')
      .select('*')
      .or(`personal_data->ic_number_new.eq."${icNumber}",personal_data->ic_number_old.eq."${icNumber}"`);
    
    return { data, error };
  },
  
  // Find by department
  async findByDepartment(department) {
    const { data, error } = await supabase
      .from('hr2000_master')
      .select('*')
      .filter('employment_data->department', 'ilike', `%${department}%`);
    
    return { data, error };
  },
  
  // Find by salary range
  async findBySalaryRange(min, max) {
    const { data, error } = await supabase
      .from('hr2000_master')
      .select('*')
      .gte('compensation_data->basic_salary', min)
      .lte('compensation_data->basic_salary', max);
    
    return { data, error };
  },
  
  // Complex query example
  async findActiveByOrganization(orgId) {
    const { data, error } = await supabase
      .from('hr2000_master')
      .select(`
        employee_id,
        full_name,
        email,
        personal_data->ic_number_new,
        employment_data->department,
        employment_data->designation,
        compensation_data->basic_salary
      `)
      .eq('organization_id', orgId)
      .eq('active', true);
    
    return { data, error };
  },
  
  // Extract specific fields from JSONB
  async getEmployeeDetails(employeeId) {
    const { data, error } = await supabase
      .from('hr2000_master')
      .select('*')
      .eq('employee_id', employeeId)
      .single();
    
    if (data) {
      return {
        data: {
          // Core info
          id: data.employee_id,
          name: data.full_name,
          email: data.email,
          active: data.active,
          
          // Personal details
          ic: data.personal_data?.ic_number_new,
          phone: data.personal_data?.phone,
          birthDate: data.personal_data?.birth_date,
          gender: data.personal_data?.gender,
          
          // Employment
          department: data.employment_data?.department,
          designation: data.employment_data?.designation,
          joinDate: data.employment_data?.join_date,
          
          // Compensation
          basicSalary: data.compensation_data?.basic_salary,
          allowances: data.compensation_data?.allowances,
          
          // Statutory
          epf: data.statutory_data?.epf_number,
          socso: data.statutory_data?.socso_number,
          tax: data.statutory_data?.income_tax_number
        },
        error: null
      };
    }
    
    return { data: null, error };
  },
  
  // Update JSONB fields
  async updateEmployeeField(employeeId, category, field, value) {
    // First get current data
    const { data: current } = await supabase
      .from('hr2000_master')
      .select(category)
      .eq('employee_id', employeeId)
      .single();
    
    if (!current) return { error: 'Employee not found' };
    
    // Update specific field in JSONB
    const updatedData = {
      ...current[category],
      [field]: value
    };
    
    const { data, error } = await supabase
      .from('hr2000_master')
      .update({ 
        [category]: updatedData,
        last_updated: new Date()
      })
      .eq('employee_id', employeeId);
    
    return { data, error };
  },
  
  // Generate reports
  async generateDepartmentReport() {
    const { data } = await supabase
      .from('hr2000_master')
      .select('employment_data->department')
      .eq('active', true);
    
    // Count by department
    const deptCounts = {};
    data.forEach(row => {
      const dept = row.department || 'Unknown';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });
    
    return deptCounts;
  }
};

// CLI interface
async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  try {
    switch (command) {
      case 'find-ic':
        const { data: icResults } = await queries.findByIC(args[0]);
        console.log(`Found ${icResults?.length || 0} employees with IC ${args[0]}`);
        icResults?.forEach(emp => {
          console.log(`- ${emp.employee_id}: ${emp.full_name}`);
        });
        break;
        
      case 'find-dept':
        const { data: deptResults } = await queries.findByDepartment(args[0]);
        console.log(`Found ${deptResults?.length || 0} employees in ${args[0]} department`);
        break;
        
      case 'employee':
        const { data: details } = await queries.getEmployeeDetails(args[0]);
        if (details) {
          console.log('\nEmployee Details:');
          Object.entries(details).forEach(([key, value]) => {
            if (value) console.log(`  ${key}: ${value}`);
          });
        } else {
          console.log('Employee not found');
        }
        break;
        
      case 'update':
        if (args.length < 4) {
          console.log('Usage: update <employee_id> <category> <field> <value>');
          console.log('Categories: personal_data, employment_data, compensation_data, statutory_data');
          break;
        }
        const { error } = await queries.updateEmployeeField(args[0], args[1], args[2], args[3]);
        console.log(error ? `Error: ${error}` : 'Updated successfully');
        break;
        
      case 'report':
        const deptReport = await queries.generateDepartmentReport();
        console.log('\nDepartment Distribution:');
        Object.entries(deptReport)
          .sort((a, b) => b[1] - a[1])
          .forEach(([dept, count]) => {
            console.log(`  ${dept}: ${count} employees`);
          });
        break;
        
      default:
        console.log('THR JSONB Query Tool\n');
        console.log('Commands:');
        console.log('  find-ic <ic>         - Find employee by IC number');
        console.log('  find-dept <dept>     - Find employees by department');
        console.log('  employee <id>        - Get employee details');
        console.log('  update <id> <category> <field> <value> - Update JSONB field');
        console.log('  report               - Generate department report');
        console.log('\nExample:');
        console.log('  ./thr-jsonb-query.js find-ic 980110095095');
        console.log('  ./thr-jsonb-query.js update TC001 personal_data phone "+60123456789"');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = queries;