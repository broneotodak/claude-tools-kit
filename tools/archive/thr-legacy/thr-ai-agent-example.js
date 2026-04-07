#!/usr/bin/env node

/**
 * Example: AI Agent (Sofia) Integration for THR
 * Shows how the system would work end-to-end
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

// Simulated AI agent workflow
async function demonstrateAIAgent() {
    console.log('🤖 THR AI Agent (Sofia) - Demonstration\n');
    console.log('=' .repeat(60) + '\n');
    
    // Example user scenarios
    const scenarios = [
        {
            user: 'HYLN027', // Regular employee
            name: 'Hanisah',
            accessLevel: 0,
            request: "Show me my leave balance and recent claims"
        },
        {
            user: 'TA001', // Department head
            name: 'Ahmad (HoD)',
            accessLevel: 1,
            request: "Show my department's leave calendar for this month"
        },
        {
            user: 'TC001', // Accounting
            name: 'Sarah (Accounting)',
            accessLevel: 5,
            request: "Generate a claims summary report for all pending approvals"
        }
    ];
    
    for (const scenario of scenarios) {
        console.log(`\n🧑 ${scenario.name} asks: "${scenario.request}"`);
        console.log('-'.repeat(60));
        
        // Step 1: Get user context
        console.log('\n1️⃣ Getting user context...');
        const userContext = await getUserContext(scenario.user);
        console.log(`   Access Level: ${scenario.accessLevel}`);
        console.log(`   Capabilities: ${JSON.stringify(userContext.modules)}`);
        
        // Step 2: Process with OpenAI (simulated)
        console.log('\n2️⃣ OpenAI processes request...');
        const intent = processIntent(scenario.request, userContext);
        console.log(`   Intent: ${intent.action}`);
        console.log(`   Entities: ${JSON.stringify(intent.entities)}`);
        
        // Step 3: Generate query/view with Claude (simulated)
        console.log('\n3️⃣ Claude generates dynamic view...');
        const view = generateDynamicView(intent, userContext);
        console.log(`   Component: ${view.component}`);
        console.log(`   Query: ${view.query}`);
        
        // Step 4: Show generated code example
        console.log('\n4️⃣ Generated React Component:');
        console.log('```jsx');
        console.log(view.code);
        console.log('```');
        
        console.log('\n' + '='.repeat(60));
    }
    
    // Show AI capabilities configuration
    console.log('\n\n📋 AI SYSTEM CAPABILITIES:\n');
    
    console.log('1. Natural Language Understanding:');
    console.log('   - Understands HR terminology');
    console.log('   - Context-aware based on user role');
    console.log('   - Multi-language support\n');
    
    console.log('2. Dynamic View Generation:');
    console.log('   - Generates React components on-the-fly');
    console.log('   - Creates appropriate Supabase queries');
    console.log('   - Respects access control automatically\n');
    
    console.log('3. Personalization:');
    console.log('   - Saves frequently used views');
    console.log('   - Learns user preferences');
    console.log('   - Custom dashboard layouts\n');
    
    // Example API endpoint structure
    console.log('📡 API ENDPOINT STRUCTURE:\n');
    console.log('```javascript');
    console.log(`// POST /api/ai/sofia
{
  "message": "Show my leave balance",
  "session_id": "uuid",
  "context": {
    "previous_messages": [],
    "current_view": "dashboard"
  }
}

// Response
{
  "response": "Here's your leave balance for 2024",
  "action": "render_view",
  "view": {
    "type": "card",
    "component": "LeaveBalanceCard",
    "data": { ... },
    "code": "// Generated React component"
  },
  "suggestions": [
    "Apply for leave",
    "View leave history",
    "Check team calendar"
  ]
}`);
    console.log('```\n');
    
    // Show example saved view
    console.log('💾 EXAMPLE SAVED VIEW:\n');
    const savedView = {
        id: 'uuid',
        employee_id: 'employee-uuid',
        view_name: 'My Leave Dashboard',
        view_type: 'dashboard',
        prompt: 'Show my leave balance and history',
        component_code: `
export const LeaveBalanceDashboard = ({ data }) => {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <Typography variant="h6">Annual Leave</Typography>
            <Typography variant="h3">{data.annual_balance}</Typography>
            <Typography color="textSecondary">days remaining</Typography>
          </CardContent>
        </Card>
      </Grid>
      {/* More components... */}
    </Grid>
  );
};`,
        data_query: `
SELECT 
  leave_type,
  balance,
  used,
  pending
FROM thr_leave_balances
WHERE employee_id = auth.user_id()`,
        configuration: {
            refresh_interval: 300,
            color_scheme: 'blue',
            layout: 'grid'
        }
    };
    
    console.log(JSON.stringify(savedView, null, 2));
}

// Helper functions (simulated)
async function getUserContext(employeeNo) {
    // In real implementation, this would query thr_ai_employee_context
    return {
        modules: ['hr', 'ai'],
        scope: 'self',
        organization: 'Hyleen'
    };
}

function processIntent(request, context) {
    // In real implementation, this would call OpenAI
    return {
        action: 'view_data',
        entities: {
            data_type: 'leave_balance',
            time_period: 'current',
            scope: context.scope
        }
    };
}

function generateDynamicView(intent, context) {
    // In real implementation, this would call Claude
    const code = `
const LeaveBalanceView = ({ userId }) => {
  const { data, loading } = useQuery({
    table: 'thr_leave_balances',
    filters: { employee_id: userId },
    select: '*'
  });

  if (loading) return <Skeleton />;

  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Your Leave Balance
      </Typography>
      <Grid container spacing={2}>
        {data?.map(leave => (
          <Grid item xs={6} key={leave.id}>
            <Box>
              <Typography variant="subtitle2">{leave.type}</Typography>
              <Typography variant="h4">{leave.balance}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Card>
  );
};`;

    return {
        component: 'LeaveBalanceView',
        query: 'SELECT * FROM thr_leave_balances WHERE employee_id = $1',
        code: code
    };
}

// Architecture explanation
async function explainArchitecture() {
    console.log('\n\n🏗️ AI-INTEGRATED THR ARCHITECTURE:\n');
    console.log('```');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│                   Frontend (React)                   │');
    console.log('│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │');
    console.log('│  │ Chat Widget │  │Dynamic Views │  │ Dashboard  │ │');
    console.log('│  │   (Sofia)   │  │  (AI-Built)  │  │(Saved Views│ │');
    console.log('│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │');
    console.log('└─────────┼─────────────────┼────────────────┼────────┘');
    console.log('          │                 │                │');
    console.log('          ▼                 ▼                ▼');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│                  AI Agent Layer                      │');
    console.log('│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │');
    console.log('│  │   OpenAI    │  │    Claude    │  │  Supabase  │ │');
    console.log('│  │(Understands)│  │  (Generates) │  │   Edge Fn  │ │');
    console.log('│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │');
    console.log('└─────────┼─────────────────┼────────────────┼────────┘');
    console.log('          │                 │                │');
    console.log('          ▼                 ▼                ▼');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│              Access Control Layer                    │');
    console.log('│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │');
    console.log('│  │Access Levels│  │ Capabilities │  │Data Scoping│ │');
    console.log('│  │   (0-8)     │  │   (JSONB)    │  │  (RLS)     │ │');
    console.log('│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │');
    console.log('└─────────┼─────────────────┼────────────────┼────────┘');
    console.log('          │                 │                │');
    console.log('          ▼                 ▼                ▼');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│                  Data Layer (THR)                    │');
    console.log('│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │');
    console.log('│  │   HR Core   │  │  Accounting  │  │   ATLAS    │ │');
    console.log('│  │ (Employees) │  │   (Claims)   │  │  (Assets)  │ │');
    console.log('│  └─────────────┘  └──────────────┘  └────────────┘ │');
    console.log('└─────────────────────────────────────────────────────┘');
    console.log('```\n');
    
    console.log('🔄 WORKFLOW EXAMPLE:\n');
    console.log('1. User: "Show me pending claims from my team"');
    console.log('2. OpenAI: Extracts intent → {action: "view", entity: "claims", filter: "pending", scope: "team"}');
    console.log('3. Access Check: User is HoD (level 1) → can view department claims ✓');
    console.log('4. Claude: Generates query with proper scope filtering');
    console.log('5. Supabase: Executes query with RLS');
    console.log('6. Claude: Generates React component for display');
    console.log('7. Frontend: Renders dynamic component');
    console.log('8. User: Can save this view to dashboard\n');
}

// Run demonstration
if (require.main === module) {
    demonstrateAIAgent()
        .then(() => explainArchitecture())
        .catch(console.error);
}

module.exports = { demonstrateAIAgent };