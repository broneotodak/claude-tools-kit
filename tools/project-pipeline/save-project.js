#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.FLOWSTATE_URL;
const SUPABASE_KEY = process.env.FLOWSTATE_SERVICE_KEY || 
                     process.env.SUPABASE_SERVICE_KEY || 
                     process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function saveProject(projectData) {
    // Generate project_id from name
    const project_id = projectData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    const project = {
        project_id,
        name: projectData.name,
        description: projectData.description,
        category: projectData.category || 'tool',
        status: projectData.status || 'development',
        complexity: projectData.complexity || 3,
        tech_stack: projectData.tech_stack || [],
        links: projectData.links || {},
        metrics: projectData.metrics || {},
        icon: projectData.icon || '🚀',
        highlights: projectData.highlights || [],
        challenges: projectData.challenges || [],
        outcomes: projectData.outcomes || [],
        source: 'cli',
        metadata: {
            ...projectData.metadata,
            saved_by: 'claude_tools_kit',
            saved_at: new Date().toISOString()
        }
    };

    try {
        const { data, error } = await supabase
            .from('projects')
            .upsert(project, { onConflict: 'project_id' })
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Project saved successfully!');
        console.log(`📁 Project ID: ${data.project_id}`);
        console.log(`📊 Status: ${data.status}`);
        console.log(`🏷️  Category: ${data.category}`);
        
        // Also save to memory for tracking
        await saveToMemory(data);
        
        return data;
    } catch (error) {
        console.error('❌ Error saving project:', error.message);
        throw error;
    }
}

async function saveToMemory(project) {
    const memory = {
        user_id: 'neo_todak',
        memory_type: 'project_update',
        category: `Project: ${project.name}`,
        content: `Project ${project.name} (${project.status}): ${project.description}`,
        importance: project.status === 'active' ? 8 : 6,
        source: 'project_pipeline',
        metadata: {
            project_id: project.project_id,
            project_name: project.name,
            status: project.status,
            category: project.category,
            tech_stack: project.tech_stack,
            links: project.links
        }
    };

    try {
        await supabase.from('claude_desktop_memory').insert([memory]);
        console.log('📝 Saved to memory for FlowState tracking');
    } catch (error) {
        console.error('⚠️  Could not save to memory:', error.message);
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Usage: save-project.js <name> <description> <status> [category] [tech,stack,comma,separated]');
        console.log('Status: idea, planning, development, beta, active, maintenance, archived');
        console.log('Category: ai, automation, saas, tool, integration, research, game');
        process.exit(1);
    }

    const [name, description, status, category = 'tool', techStack = ''] = args;
    
    const projectData = {
        name,
        description,
        status,
        category,
        tech_stack: techStack ? techStack.split(',') : []
    };

    saveProject(projectData)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { saveProject };