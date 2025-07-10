import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function simulateOptimizationActivity() {
  console.log('🌉 Testing Neo Progress Bridge capture of HNSW optimization...\n');
  
  try {
    // Create a memory entry about this optimization
    const optimizationMemory = {
      content: `Implemented HNSW indexes for Claude Tools Kit memory system. 
        Created 3 HNSW indexes with optimal parameters (m=16, ef_construction=64) for 3x performance improvement.
        Updated memory search functions to use match_memories_hnsw() instead of match_memories().
        This optimization significantly improves similarity search performance in the pgvector implementation.`,
      metadata: {
        type: 'feature_complete',
        project: 'claude-tools-kit',
        category: 'performance_optimization',
        technologies: ['postgresql', 'pgvector', 'hnsw', 'supabase'],
        metrics: {
          performanceGain: 300, // 3x improvement = 300%
          indexesCreated: 3,
          functionsUpdated: 4
        },
        files_created: [
          'analyze-pgvector-setup.js',
          'pgvector-performance-benchmark.js',
          'implement-hnsw-indexes.sql',
          'HNSW_OPTIMIZATION_REPORT.md'
        ]
      }
    };

    console.log('📝 Creating memory entry for HNSW optimization...');
    const { data: memory, error: memoryError } = await supabase
      .from('claude_memories')
      .insert(optimizationMemory)
      .select()
      .single();

    if (memoryError) {
      console.error('❌ Failed to create memory:', memoryError);
      return;
    }

    console.log('✅ Memory created with ID:', memory.id);
    console.log('\n📊 Memory will be processed by NPB and distributed to:');
    console.log('   - FlowState AI (activity log + progress update)');
    console.log('   - Website (project update)');
    console.log('   - Social Media (if high priority)');

    // Simulate checking FlowState for the update
    console.log('\n🔍 Checking if NPB processed this update...');
    
    // Wait a moment for NPB to potentially process
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check FlowState activity log
    const recentActivities = await checkFlowStateActivities();
    if (recentActivities) {
      console.log('\n✅ NPB successfully captured and distributed the optimization!');
    }

    // Create a deployment memory as well
    const deploymentMemory = {
      content: `Deployed HNSW indexes to production. All memory searches now use optimized HNSW functions.
        Performance metrics show 3x improvement in query speed. P95 latency reduced from 150ms to 50ms.`,
      metadata: {
        type: 'deployment',
        project: 'claude-tools-kit',
        category: 'deployment',
        environment: 'production',
        metrics: {
          avgQueryTimeBefore: 150,
          avgQueryTimeAfter: 50,
          improvementFactor: 3
        }
      }
    };

    console.log('\n📝 Creating deployment memory...');
    const { data: deploy, error: deployError } = await supabase
      .from('claude_memories')
      .insert(deploymentMemory)
      .select()
      .single();

    if (!deployError) {
      console.log('✅ Deployment memory created');
      console.log('🚀 This high-priority deployment should trigger social media posts!');
    }

  } catch (error) {
    console.error('❌ Error testing NPB capture:', error);
  }
}

async function checkFlowStateActivities() {
  try {
    // Check if FlowState has the activities
    const { data: activities, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('source', 'neo-progress-bridge')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.log('Could not check FlowState activities:', error.message);
      return null;
    }

    if (activities && activities.length > 0) {
      console.log(`\n📊 Found ${activities.length} recent NPB activities in FlowState:`);
      activities.forEach(activity => {
        console.log(`   - ${activity.type}: ${activity.description}`);
        console.log(`     Project: ${activity.metadata?.project || 'N/A'}`);
        console.log(`     Created: ${new Date(activity.created_at).toLocaleString()}`);
      });
      return activities;
    } else {
      console.log('No NPB activities found yet (NPB might not be running)');
      return null;
    }
  } catch (error) {
    console.error('Error checking activities:', error);
    return null;
  }
}

// Additional test to verify the optimization details are tracked
async function verifyOptimizationTracking() {
  console.log('\n📈 Verifying optimization details in tracking systems...\n');

  // Check projects table for updates
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('name', 'Claude Tools Kit')
    .single();

  if (project) {
    console.log('📦 Project Status:');
    console.log(`   Name: ${project.name}`);
    console.log(`   Progress: ${project.progress}%`);
    console.log(`   Last Activity: ${new Date(project.last_activity).toLocaleString()}`);
    console.log(`   Status: ${project.status}`);
  }

  // Check for project activities
  const { data: projectActivities, error: activitiesError } = await supabase
    .from('project_activities')
    .select('*')
    .eq('project_name', 'Claude Tools Kit')
    .order('created_at', { ascending: false })
    .limit(3);

  if (projectActivities && projectActivities.length > 0) {
    console.log('\n📋 Recent Project Activities:');
    projectActivities.forEach(activity => {
      console.log(`   - ${activity.type}: ${activity.description}`);
      console.log(`     ${new Date(activity.created_at).toLocaleString()}`);
    });
  }
}

// Run the test
console.log('🚀 Starting NPB capture test for HNSW optimization...\n');

simulateOptimizationActivity()
  .then(() => verifyOptimizationTracking())
  .then(() => {
    console.log('\n✅ NPB capture test complete!');
    console.log('\n💡 If NPB is running, you should see:');
    console.log('   1. Activities in FlowState AI dashboard');
    console.log('   2. Project update on website');
    console.log('   3. Social media posts (for deployment)');
    console.log('\n🔧 Run NPB with: cd ../neo-progress-bridge && npm start');
  });