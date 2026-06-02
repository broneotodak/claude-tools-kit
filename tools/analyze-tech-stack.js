#!/usr/bin/env node

/**
 * Analyze Neo's actual tech stack from memories
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// DEPRECATED 2026-06-01: scanned the FROZEN legacy `claude_desktop_memory` archive
// via process.env.SUPABASE_URL. Superseded by the @todak/memory SDK (packages/memory).
// Client built lazily so the legacy URL is only touched behind --force-legacy.
let _supabase = null;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

async function getTechStack() {
  // Search for tech stack mentions in memories
  const { data: memories } = await supabase()
    .from('claude_desktop_memory')
    .select('content, category')
    .limit(500);

  // Tech to look for
  const techs = [
    'React', 'Next.js', 'Vue', 'Laravel', 'WordPress', 'Vite',
    'TypeScript', 'JavaScript', 'Supabase', 'PostgreSQL', 'n8n',
    'Python', 'Node.js', 'Tailwind', 'Material-UI', 'MUI',
    'Express', 'FastAPI', 'HTML', 'CSS', 'Unity', 'C#',
    'OpenAI', 'Claude', 'GPT', 'ElevenLabs', 'Replicate',
    'Netlify', 'Vercel', 'Docker', 'Git', 'GitHub',
    'shadcn', 'Radix', 'Framer Motion', 'Chart.js', 'Recharts'
  ];

  // Count tech mentions
  const techCount = {};
  const techByProject = {};

  memories?.forEach(m => {
    if (!m.content) return;
    const content = m.content.toLowerCase();
    const category = m.category || 'General';

    techs.forEach(tech => {
      const techLower = tech.toLowerCase();
      if (content.includes(techLower)) {
        techCount[tech] = (techCount[tech] || 0) + 1;

        if (!techByProject[category]) techByProject[category] = new Set();
        techByProject[category].add(tech);
      }
    });
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              NEO\'S TECH STACK ANALYSIS                        ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('📊 TECHNOLOGIES BY USAGE FREQUENCY:\n');
  const sorted = Object.entries(techCount).sort((a, b) => b[1] - a[1]);

  sorted.slice(0, 20).forEach(([tech, count], i) => {
    const bar = '█'.repeat(Math.min(Math.round(count / 3), 25));
    console.log(`${(i+1).toString().padStart(2)}. ${tech.padEnd(15)} ${bar} (${count})`);
  });

  console.log('\n📁 TECH STACK BY PROJECT:\n');

  // Sort projects by number of techs
  const projectsSorted = Object.entries(techByProject)
    .sort((a, b) => b[1].size - a[1].size);

  projectsSorted.forEach(([project, techs]) => {
    const techList = Array.from(techs);
    console.log(`${project}:`);
    console.log(`   ${techList.join(', ')}\n`);
  });

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📝 SUMMARY:\n');

  const frontendTechs = sorted.filter(([t]) =>
    ['React', 'Next.js', 'Vue', 'TypeScript', 'Tailwind', 'Material-UI', 'MUI', 'shadcn', 'Vite'].includes(t)
  );
  const backendTechs = sorted.filter(([t]) =>
    ['Supabase', 'PostgreSQL', 'Node.js', 'Python', 'FastAPI', 'Express', 'n8n'].includes(t)
  );
  const aiTechs = sorted.filter(([t]) =>
    ['OpenAI', 'Claude', 'GPT', 'ElevenLabs', 'Replicate'].includes(t)
  );

  console.log('🎨 Frontend:', frontendTechs.map(([t]) => t).join(', ') || 'N/A');
  console.log('⚙️  Backend:', backendTechs.map(([t]) => t).join(', ') || 'N/A');
  console.log('🤖 AI/ML:', aiTechs.map(([t]) => t).join(', ') || 'N/A');
  console.log('☁️  Deployment:', sorted.filter(([t]) => ['Netlify', 'Vercel', 'Docker'].includes(t)).map(([t]) => t).join(', ') || 'N/A');
}

if (!process.argv.includes('--force-legacy')) {
  console.error('DEPRECATED: analyze-tech-stack.js targeted the frozen legacy memory archive (claude_desktop_memory); use the @todak/memory SDK (packages/memory). Re-run with --force-legacy to override.');
  process.exit(1);
}

getTechStack().catch(console.error);
