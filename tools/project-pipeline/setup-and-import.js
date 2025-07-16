#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase with service key for table creation
const supabase = createClient(
    'https://uzamamymfzhelvkwpvgt.supabase.co',
    process.env.FLOWSTATE_SERVICE_KEY
);

// Simple projects structure for now
const projects = [
    {
        name: 'THR Intelligence',
        description: 'AI-powered HRMS with Custom AI Dashboard',
        status: 'active',
        url: 'https://thr.neotodak.com'
    },
    {
        name: 'FlowState AI',
        description: 'Real-time AI activity monitoring',
        status: 'active',
        url: 'https://flowstate.todak.io'
    },
    {
        name: 'Claude Tools Kit',
        description: 'Memory management tools for Claude AI',
        status: 'active',
        url: 'https://github.com/broneotodak/claude-tools-kit'
    },
    {
        name: 'ATLAS AI',
        description: 'Enterprise asset management system',
        status: 'development',
        url: 'https://atlas.neotodak.com'
    },
    {
        name: 'ARS Intelligence',
        description: 'AI recruitment system with voice interviews',
        status: 'active',
        url: 'https://ars.neotodak.com'
    },
    {
        name: 'TODAK AI HQ',
        description: 'AI-powered digital headquarters',
        status: 'active',
        url: 'https://todak.ai'
    },
    {
        name: 'Venture Canvas',
        description: 'Business venture planning tool',
        status: 'development',
        url: 'https://venture-canvas.neotodak.com'
    },
    {
        name: 'Firasah AI',
        description: 'AI-powered facial analysis',
        status: 'active',
        url: 'https://firasah.neotodak.com'
    },
    {
        name: 'KENAL Admin',
        description: 'AI-enhanced admin dashboard',
        status: 'active',
        url: 'https://kenal-admin.netlify.app'
    },
    {
        name: 'n8n Integration Hub',
        description: 'Workflow automation platform',
        status: 'active',
        url: 'https://n8n.todak.io'
    },
    {
        name: 'ClaudeN',
        description: 'AI partnership system',
        status: 'active',
        url: ''
    },
    {
        name: 'Neo Mind Portal',
        description: 'Personal AI knowledge management',
        status: 'development',
        url: 'https://mind.neotodak.com'
    },
    {
        name: 'Ultimate Web Scraping',
        description: 'Web scraping toolkit',
        status: 'active',
        url: ''
    },
    {
        name: 'Mastra Game',
        description: '5v5 MOBA game with SEA culture',
        status: 'planning',
        url: 'https://www.mastragame.com'
    }
];

async function saveProjectsAsMemories() {
    console.log('💾 Saving projects as memories for automation...\n');
    
    for (const project of projects) {
        const memory = {
            user_id: 'neo_todak',
            memory_type: 'project_registry',
            category: 'Project: ' + project.name,
            content: `${project.name} (${project.status}): ${project.description}. URL: ${project.url || 'Internal'}`,
            importance: project.status === 'active' ? 8 : 6,
            source: 'claude_desktop',
            metadata: {
                project_name: project.name,
                project_status: project.status,
                project_url: project.url,
                project_description: project.description,
                is_project: true,
                auto_sync: true
            }
        };
        
        try {
            const { data, error } = await supabase
                .from('claude_desktop_memory')
                .insert([memory])
                .select()
                .single();
                
            if (error) throw error;
            
            console.log(`✅ ${project.name} - saved to memory`);
        } catch (error) {
            console.error(`❌ ${project.name} - failed:`, error.message);
        }
    }
    
    console.log('\n📊 Summary:');
    console.log(`Total projects: ${projects.length}`);
    console.log(`Active: ${projects.filter(p => p.status === 'active').length}`);
    console.log(`Development: ${projects.filter(p => p.status === 'development').length}`);
    console.log(`Planning: ${projects.filter(p => p.status === 'planning').length}`);
}

// Run
saveProjectsAsMemories()
    .then(() => {
        console.log('\n✅ All projects saved to memory!');
        console.log('🌊 Check FlowState to see project memories');
        console.log('🔄 Next: Create automation to sync these to neotodak.com');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Failed:', error);
        process.exit(1);
    });