#!/usr/bin/env node

const { saveProject } = require('./save-project');

// All our existing projects with proper metadata
const existingProjects = [
    {
        name: 'THR Intelligence',
        description: 'AI-powered HRMS with Custom AI Dashboard, predictive employee analytics, automated workflows, and intelligent decision support. Features Google OAuth and dark mode.',
        status: 'active',
        category: 'saas',
        complexity: 5,
        tech_stack: ['React 18', 'Material-UI', 'Supabase', 'Chart.js', 'AI Dashboard'],
        icon: '💼',
        links: {
            live: 'https://thr.neotodak.com',
            github: 'https://github.com/broneotodak/THR'
        },
        highlights: [
            'Custom AI Dashboard with natural language widget generation',
            'Google OAuth integration',
            'Dark mode persistence',
            'Real-time employee analytics'
        ]
    },
    {
        name: 'FlowState AI',
        description: 'Real-time AI activity monitoring with Git integration, predictive analytics, intelligent task management, and team collaboration powered by machine learning.',
        status: 'active',
        category: 'ai',
        complexity: 4,
        tech_stack: ['JavaScript', 'Supabase', 'Real-time', 'Git Hooks'],
        icon: '🌊',
        links: {
            live: 'https://flowstate.todak.io',
            github: 'https://github.com/broneotodak/flowstate-ai'
        },
        metrics: {
            users: 50,
            apiCalls: 10000
        }
    },
    {
        name: 'Claude Tools Kit',
        description: 'Comprehensive memory management and automation tools for Claude AI. Features PGVector-enhanced memory, activity tracking, web scraping, and Git hooks integration.',
        status: 'active',
        category: 'tool',
        complexity: 5,
        tech_stack: ['Node.js', 'PGVector', 'Puppeteer', 'MCP Tools', 'Supabase'],
        icon: '🛠️',
        links: {
            github: 'https://github.com/broneotodak/claude-tools-kit'
        },
        highlights: [
            'PGVector-enhanced memory search',
            'Automated memory enrichment',
            'Web scraping with Puppeteer',
            'Git activity tracking'
        ]
    },
    {
        name: 'ATLAS AI',
        description: 'Enterprise asset management system with AI-powered tracking, predictive maintenance, Chart.js visualizations, and automated inventory optimization.',
        status: 'development',
        category: 'saas',
        complexity: 4,
        tech_stack: ['React 18', 'Chart.js', 'Material-UI', 'Supabase'],
        icon: '📦',
        links: {
            live: 'https://atlas.neotodak.com'
        }
    },
    {
        name: 'ARS Intelligence',
        description: 'Revolutionary AI recruitment system with autonomous candidate evaluation, voice AI interviews powered by ElevenLabs, and predictive hiring insights.',
        status: 'active',
        category: 'ai',
        complexity: 5,
        tech_stack: ['Voice AI', 'ElevenLabs', 'n8n Workflows', 'Python'],
        icon: '🤖',
        links: {
            live: 'https://ars.neotodak.com',
            github: 'https://github.com/broneotodak/ARS'
        },
        metrics: {
            users: 200,
            apiCalls: 50000
        }
    },
    {
        name: 'TODAK AI HQ',
        description: 'AI-powered digital headquarters with WhatsApp integration via Sofia bot, employee communication system, and automated admin dashboard.',
        status: 'active',
        category: 'ai',
        complexity: 5,
        tech_stack: ['WhatsApp Bot', 'n8n', 'OpenAI', 'Supabase'],
        icon: '🤖',
        links: {
            live: 'https://todak.ai'
        },
        metrics: {
            users: 500,
            apiCalls: 100000
        }
    },
    {
        name: 'Venture Canvas',
        description: 'Business venture planning tool with AI-powered insights, financial modeling, and strategic planning features for entrepreneurs and startups.',
        status: 'development',
        category: 'saas',
        complexity: 3,
        tech_stack: ['Next.js', 'TypeScript', 'Tailwind CSS', 'AI Planning'],
        icon: '📈',
        links: {
            live: 'https://venture-canvas.neotodak.com'
        }
    },
    {
        name: 'Firasah AI',
        description: 'Advanced AI-powered facial analysis combining traditional wisdom with modern computer vision, GPT-4 Vision, and Replicate AI for interpretations.',
        status: 'active',
        category: 'ai',
        complexity: 4,
        tech_stack: ['Next.js', 'GPT-4 Vision', 'Replicate AI', 'TypeScript'],
        icon: '🔮',
        links: {
            live: 'https://firasah.neotodak.com'
        },
        metrics: {
            users: 300,
            apiCalls: 20000
        }
    },
    {
        name: 'KENAL Admin',
        description: 'AI-enhanced admin dashboard with predictive user analytics, automated insights, and intelligent data visualization for system management.',
        status: 'active',
        category: 'saas',
        complexity: 3,
        tech_stack: ['React', 'AI Analytics', 'MUI', 'Admin System'],
        icon: '📊',
        links: {
            live: 'https://kenal-admin.netlify.app'
        }
    },
    {
        name: 'n8n Integration Hub',
        description: 'Workflow automation platform with custom API toolkit, cursor integration, and hundreds of pre-built workflows for enterprise automation.',
        status: 'active',
        category: 'automation',
        complexity: 4,
        tech_stack: ['n8n', 'API Toolkit', 'Webhooks', 'Automation'],
        icon: '⚡',
        links: {
            live: 'https://n8n.todak.io'
        },
        metrics: {
            users: 100,
            apiCalls: 80000
        }
    },
    {
        name: 'ClaudeN',
        description: 'AI partnership system with advanced memory management, context awareness, backup systems, dashboard, and autonomous task execution capabilities.',
        status: 'active',
        category: 'ai',
        complexity: 5,
        tech_stack: ['AI Memory', 'MCP Tools', 'Task Manager', 'Supabase'],
        icon: '💜',
        links: {},
        highlights: [
            'Advanced memory management',
            'Context-aware AI assistance',
            'Automated backup systems',
            'Task execution engine'
        ]
    },
    {
        name: 'Neo Mind Portal',
        description: 'Personal AI knowledge management system with neural network visualization, thought mapping, and intelligent information retrieval.',
        status: 'development',
        category: 'ai',
        complexity: 4,
        tech_stack: ['Knowledge Graph', 'AI Search', 'Visualization'],
        icon: '🧠',
        links: {
            live: 'https://mind.neotodak.com'
        }
    },
    {
        name: 'Ultimate Web Scraping',
        description: 'Comprehensive web scraping toolkit with AI-powered content extraction, authentication handling, dynamic page rendering with Puppeteer.',
        status: 'active',
        category: 'tool',
        complexity: 3,
        tech_stack: ['Puppeteer', 'Playwright', 'Node.js', 'AI Extraction'],
        icon: '🕷️',
        links: {
            github: 'https://github.com/broneotodak/claude-tools-kit'
        }
    },
    {
        name: 'Mastra Game',
        description: 'A 5v5 MOBA game inspired by Southeast Asian culture and mythology. Created by Lan Todak and developed by Todak Studios Sdn Bhd.',
        status: 'planning',
        category: 'game',
        complexity: 5,
        tech_stack: ['Unity', 'SEA Culture', 'Mobile Gaming'],
        icon: '🎮',
        links: {
            live: 'https://www.mastragame.com'
        }
    }
];

async function importAll() {
    console.log('🚀 Starting import of existing projects...\n');
    
    let successful = 0;
    let failed = 0;
    
    for (const project of existingProjects) {
        try {
            console.log(`📦 Importing: ${project.name}`);
            await saveProject(project);
            successful++;
            console.log('');
        } catch (error) {
            console.error(`❌ Failed to import ${project.name}:`, error.message);
            failed++;
        }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📁 Total: ${existingProjects.length}`);
}

// Run import
if (require.main === module) {
    importAll()
        .then(() => {
            console.log('\n🎉 Import completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Import failed:', error);
            process.exit(1);
        });
}