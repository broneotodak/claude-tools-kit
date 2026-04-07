#!/usr/bin/env node

/**
 * THR Organization Mapper
 * Maps HR2000 file prefixes to organization IDs
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Complete organization mappings based on user clarification
const ORGANIZATION_MAPPINGS = {
  // TODAK Brand organizations (already in database)
  'LTCM': { 
    id: '7bf98516-0582-4b6c-8231-1f693e4da9b4', 
    name: 'Lan Todak Consultation & Management',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TTK': { 
    id: '6e0cff12-3d6d-4dc2-8291-52cae49e734b', 
    name: 'Tadika Todak Kids',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TASB': { 
    id: '951492dc-a480-4391-85a6-f2738ceff92b', 
    name: 'Todak Academy Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TCSB': { 
    id: '5132ee4b-69f2-4263-8857-e56d649ac62b', 
    name: 'Todak Culture Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TDSB': { 
    id: '8b1a378b-9428-4e81-b616-8e0b25b78fca', 
    name: 'Todak Digitech Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'THSB': { 
    id: 'd0c746b5-f54f-45e1-ac9c-ae2a22c43e95', 
    name: 'Todak Holdings Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TPSB': { 
    id: 'ce34cd6f-fcd5-43f2-98b4-d9f8614fba28', 
    name: 'Todak Paygate Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TRC': { 
    id: '65c96eb4-1603-4119-ab10-2658d38764f4', 
    name: 'Todak RC Enterprise',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  'TSSB': { 
    id: '7c154cd5-4773-4f27-a136-e60ab2bfe0a2', 
    name: 'Todak Studios Sdn. Bhd.',
    brand_id: '312a09b6-34b5-4644-a79d-3b0a0f76cdd8' // TODAK
  },
  
  // My Barber Brand
  'MTSB': { 
    id: '0076fffc-282f-4966-8c26-b2483b3b1a8a', 
    name: 'My Barber Tech Sdn. Bhd.',
    brand_id: '0a31844a-ff20-48ec-9a9d-8f59ca23958c' // My Barber
  },
  
  // Organizations that need to be added
  '10C': { 
    id: null, // Will be generated
    name: '10Camp',
    brand_id: 'dbd49b72-f8ad-42ef-a2af-fe69024d2baf', // 10Camp brand
    organization_code: '10C'
  },
  'HSB': { 
    id: null, // Will be generated
    name: 'Hyleen Sdn. Bhd.',
    brand_id: '3190e8a4-0349-4fc6-8bb0-83af139a46d5', // Hyleen brand
    organization_code: 'HSB'
  },
  'MH': { 
    id: null, // Will be generated
    name: 'Muscle Hub',
    brand_id: '240f5a15-9c4a-4663-bc70-fe9fbcbbd439', // Muscle Hub brand
    organization_code: 'MH'
  },
  'STSB': { 
    id: null, // Will be generated
    name: 'Sarcom Technology Sdn. Bhd.',
    brand_id: 'ad794b56-35b5-411d-a1b3-c9e96420f0db', // SARCOM brand
    organization_code: 'STSB'
  }
};

// Add missing organizations to database
async function ensureOrganizationsExist() {
  console.log('🔍 Checking and adding missing organizations...\n');
  
  const missingOrgs = Object.entries(ORGANIZATION_MAPPINGS)
    .filter(([code, org]) => !org.id)
    .map(([code, org]) => ({
      name: org.name,
      brand_id: org.brand_id,
      organization_code: code,
      is_active: true
    }));
  
  if (missingOrgs.length > 0) {
    console.log(`📝 Adding ${missingOrgs.length} missing organizations:`);
    missingOrgs.forEach(org => console.log(`  - ${org.organization_code}: ${org.name}`));
    
    const { data, error } = await supabase
      .from('thr_organizations')
      .insert(missingOrgs)
      .select();
    
    if (error) {
      console.error('❌ Error adding organizations:', error.message);
      return false;
    }
    
    // Update mappings with new IDs
    data.forEach(org => {
      ORGANIZATION_MAPPINGS[org.organization_code].id = org.organization_id;
    });
    
    console.log('✅ Organizations added successfully\n');
  } else {
    console.log('✅ All organizations already exist\n');
  }
  
  return true;
}

// Get organization ID from file prefix
function getOrganizationId(filePrefix) {
  const mapping = ORGANIZATION_MAPPINGS[filePrefix];
  if (!mapping) {
    console.warn(`⚠️  Unknown organization prefix: ${filePrefix}`);
    return null;
  }
  return mapping.id;
}

// Display all mappings
async function displayMappings() {
  console.log('📊 Organization Mappings:\n');
  console.log('File Prefix | Organization Name                    | Organization ID');
  console.log('------------|-------------------------------------|----------------------------------------');
  
  Object.entries(ORGANIZATION_MAPPINGS).forEach(([prefix, org]) => {
    console.log(`${prefix.padEnd(11)} | ${org.name.padEnd(35)} | ${org.id || 'TO BE GENERATED'}`);
  });
}

// Main CLI
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      await ensureOrganizationsExist();
      await displayMappings();
      break;
      
    case 'verify':
      await displayMappings();
      break;
      
    case 'check':
      const prefix = process.argv[3];
      if (!prefix) {
        console.error('Please provide a file prefix to check');
        process.exit(1);
      }
      
      const org = ORGANIZATION_MAPPINGS[prefix];
      if (org) {
        console.log(`\n✅ Found mapping for ${prefix}:`);
        console.log(`   Name: ${org.name}`);
        console.log(`   ID: ${org.id || 'Not yet created'}`);
        console.log(`   Brand ID: ${org.brand_id}`);
      } else {
        console.log(`\n❌ No mapping found for prefix: ${prefix}`);
      }
      break;
      
    default:
      console.log('THR Organization Mapper\n');
      console.log('Commands:');
      console.log('  setup    - Ensure all organizations exist in database');
      console.log('  verify   - Display all organization mappings');
      console.log('  check <prefix> - Check mapping for specific file prefix');
      console.log('\nExample:');
      console.log('  ./thr-organization-mapper.js setup');
      console.log('  ./thr-organization-mapper.js check TCSB');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  ORGANIZATION_MAPPINGS,
  getOrganizationId,
  ensureOrganizationsExist
};