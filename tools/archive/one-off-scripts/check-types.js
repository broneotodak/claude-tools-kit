const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.thr' });

const supabase = createClient(process.env.THR_SUPABASE_URL, process.env.THR_SERVICE_KEY);

(async () => {
  // First check the table structure
  console.log('=== Employment Types Table ===\n');
  const { data: types, error } = await supabase
    .from('thr_employment_types')
    .select('*')
    .limit(10);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  if (!types || types.length === 0) {
    console.log('No employment types found!');
    return;
  }

  console.log('Columns:', Object.keys(types[0]).join(', '));
  console.log('\n--- All Types ---\n');
  types.forEach(t => {
    console.log('ID:', t.id);
    console.log('Name:', t.name);
    console.log('Active:', t.is_active);
    console.log('---');
  });
})().catch(console.error);
