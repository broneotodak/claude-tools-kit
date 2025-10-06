#!/usr/bin/env node

/**
 * CTK MCP Server
 * Exposes Claude Tools Kit functionality via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CTK_ROOT = join(__dirname, '..');

// Load environment
dotenv.config({ path: join(CTK_ROOT, '.env') });

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Create MCP server
const server = new Server(
  {
    name: 'ctk-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

/**
 * Resources - Expose memory as readable resources
 */
server.setRequestHandler('resources/list', async () => {
  try {
    // Get recent memories as resources
    const { data: memories, error } = await supabase
      .from('claude_desktop_memory')
      .select('id, content, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return {
      resources: memories.map(m => ({
        uri: `ctk://memory/${m.id}`,
        name: `Memory: ${m.metadata?.category || 'General'} - ${new Date(m.created_at).toLocaleDateString()}`,
        description: m.content.substring(0, 100) + '...',
        mimeType: 'text/plain',
      })),
    };
  } catch (error) {
    console.error('Error listing resources:', error);
    return { resources: [] };
  }
});

server.setRequestHandler('resources/read', async (request) => {
  const url = new URL(request.params.uri);
  const memoryId = url.pathname.replace('/memory/', '');

  try {
    const { data: memory, error } = await supabase
      .from('claude_desktop_memory')
      .select('*')
      .eq('id', memoryId)
      .single();

    if (error) throw error;

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/plain',
          text: `Category: ${memory.metadata?.category || 'General'}
Title: ${memory.metadata?.title || 'Untitled'}
Created: ${new Date(memory.created_at).toLocaleString()}
Importance: ${memory.metadata?.importance || 'N/A'}

${memory.content}`,
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to read memory: ${error.message}`);
  }
});

/**
 * Tools - CTK operations as MCP tools
 */
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'save_memory',
        description: 'Save information to pgVector memory with metadata',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Category: Session, Progress, Learning, Decision, Project, Config',
              enum: ['Session', 'Progress', 'Learning', 'Decision', 'Project', 'Config'],
            },
            title: {
              type: 'string',
              description: 'Short title for this memory',
            },
            content: {
              type: 'string',
              description: 'The content to save',
            },
            importance: {
              type: 'number',
              description: 'Importance level (3-8)',
              minimum: 3,
              maximum: 8,
            },
          },
          required: ['category', 'title', 'content'],
        },
      },
      {
        name: 'search_memory',
        description: 'Search memories using semantic search',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (natural language)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
              default: 10,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'run_sql_migration',
        description: 'Execute SQL migration safely with validation',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'SQL to execute',
            },
            file_path: {
              type: 'string',
              description: 'Path to SQL file (alternative to inline SQL)',
            },
            force: {
              type: 'boolean',
              description: 'Force dangerous operations',
              default: false,
            },
          },
        },
      },
      {
        name: 'check_activities',
        description: 'Get recent activities from FlowState',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of activities to retrieve',
              default: 10,
            },
          },
        },
      },
      {
        name: 'validate_data',
        description: 'Validate data before bulk operations to prevent corruption',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description: 'Description of the operation to validate',
            },
          },
          required: ['operation'],
        },
      },
    ],
  };
});

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'save_memory': {
        const { category, title, content, importance = 5 } = args;
        const toolPath = join(CTK_ROOT, 'tools/save-memory-enhanced.js');
        const result = execSync(
          `node "${toolPath}" "${category}" "${title}" "${content}" ${importance}`,
          { encoding: 'utf8' }
        );
        return { content: [{ type: 'text', text: result }] };
      }

      case 'search_memory': {
        const { query, limit = 10 } = args;
        const toolPath = join(CTK_ROOT, 'tools/rag-semantic-search.js');
        const result = execSync(`node "${toolPath}" "${query}" --limit ${limit}`, {
          encoding: 'utf8',
        });
        return { content: [{ type: 'text', text: result }] };
      }

      case 'run_sql_migration': {
        const { sql, file_path, force = false } = args;
        const toolPath = join(CTK_ROOT, 'tools/run-sql-migration.js');
        let cmd = `node "${toolPath}"`;
        if (sql) {
          cmd += ` --sql "${sql}"`;
        } else if (file_path) {
          cmd += ` "${file_path}"`;
        }
        if (force) cmd += ' --force';
        const result = execSync(cmd, { encoding: 'utf8' });
        return { content: [{ type: 'text', text: result }] };
      }

      case 'check_activities': {
        const { limit = 10 } = args;
        const toolPath = join(CTK_ROOT, 'tools/check-latest-activities.js');
        const result = execSync(`node "${toolPath}" --limit ${limit}`, { encoding: 'utf8' });
        return { content: [{ type: 'text', text: result }] };
      }

      case 'validate_data': {
        const { operation } = args;
        const toolPath = join(CTK_ROOT, 'tools/ctk-enforcer.js');
        const result = execSync(`node "${toolPath}" "${operation}"`, { encoding: 'utf8' });
        return { content: [{ type: 'text', text: result }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

/**
 * Prompts - Expose slash commands
 */
server.setRequestHandler('prompts/list', async () => {
  return {
    prompts: [
      {
        name: 'ctk_save_memory',
        description: 'Save important information to memory',
        arguments: [
          {
            name: 'category',
            description: 'Memory category',
            required: true,
          },
          {
            name: 'content',
            description: 'Content to save',
            required: true,
          },
        ],
      },
      {
        name: 'ctk_search',
        description: 'Search memories semantically',
        arguments: [
          {
            name: 'query',
            description: 'Search query',
            required: true,
          },
        ],
      },
    ],
  };
});

server.setRequestHandler('prompts/get', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'ctk_save_memory':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Save this to memory: ${args.content}\nCategory: ${args.category}`,
            },
          },
        ],
      };

    case 'ctk_search':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Search memories for: ${args.query}`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

/**
 * Start server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CTK MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
