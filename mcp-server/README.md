# CTK MCP Server

Model Context Protocol server for Claude Tools Kit - exposes CTK functionality as MCP resources, tools, and prompts.

## Features

### Resources
- Browse recent memories as `@ctk://memory/{id}` references
- Read full memory content with metadata

### Tools
- `save_memory` - Save to pgVector memory
- `search_memory` - Semantic search through memories
- `run_sql_migration` - Safe SQL execution
- `check_activities` - Recent FlowState activities
- `validate_data` - Pre-migration validation

### Prompts
- `ctk_save_memory` - Quick memory save prompt
- `ctk_search` - Search memories prompt

## Installation

```bash
cd mcp-server
npm install
```

## Configuration

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "ctk": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/broneotodak/Projects/claude-tools-kit/mcp-server/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "OPENAI_API_KEY": "your-openai-key"
      }
    }
  }
}
```

**Note:** Environment variables can also be loaded from `/Users/broneotodak/Projects/claude-tools-kit/.env`

## Usage

### Using Resources

```
@ctk://memory/123 - Reference a specific memory
```

### Using Tools

Claude Code will automatically suggest CTK tools when appropriate:
- "save this to memory" → suggests `save_memory` tool
- "search for past solutions" → suggests `search_memory` tool

### Using Prompts

Type `/` and look for CTK prompts:
- `/ctk_save_memory` - Save information
- `/ctk_search` - Search memories

## Testing

Test the MCP server locally:

```bash
node index.js
```

The server will run on stdio and wait for MCP protocol messages.

## Security

- Service role keys are required for full database access
- Ensure `.env` file is not committed to version control
- Use pre-commit hooks to prevent credential leaks

## Architecture

```
CTK MCP Server
├── Resources (Read-only memory access)
├── Tools (Execute CTK operations)
└── Prompts (Quick commands)
    │
    └─> CTK Tools
        ├── save-memory-enhanced.js
        ├── rag-semantic-search.js
        ├── run-sql-migration.js
        ├── check-latest-activities.js
        └── ctk-enforcer.js
```

## Troubleshooting

### Server not connecting
- Check Claude Code logs: `~/.claude/logs/`
- Verify environment variables are set
- Test Supabase connection manually

### Tools not appearing
- Restart Claude Code after adding MCP server
- Check server logs for errors
- Verify `mcpServers` configuration in settings.json

### Permission errors
- Ensure index.js is executable: `chmod +x index.js`
- Check file paths in configuration

## Development

To add new tools:

1. Add tool definition to `tools/list` handler
2. Implement tool logic in `tools/call` handler
3. Update this README with usage examples

## License

MIT
