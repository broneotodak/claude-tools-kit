# Claude Tools Kit (CTK) - Detailed Guide 🛠️

## What is Claude Tools Kit?

Claude Tools Kit (CTK) is a comprehensive solution for maintaining context and memory continuity when using Claude Code across multiple sessions and machines. It solves the common problem of Claude starting "fresh" each time, by automatically loading your configuration, memories, and project context.

## The Problem CTK Solves

When using Claude Code, especially in WSL environments:
- Claude starts without knowing your previous conversations or context
- You have to manually explain your setup each time
- Project-specific configurations aren't remembered
- Switching between machines loses continuity

## How CTK Works

CTK creates a persistent layer between you and Claude Code by:

1. **Centralized Configuration** - Maintains a master configuration file with all your project details, preferences, and system setup
2. **Memory Bridge** - Connects to Supabase PGVector to store and retrieve contextual memories
3. **Automatic Loading** - Ensures Claude always starts with full context, no matter which terminal or machine you use
4. **FlowState Integration** - Automatically syncs your AI activities to your FlowState dashboard

## Core Components

### 1. Configuration Management (`claude.md`)
- Stores your system context, active projects, and tool preferences
- Automatically loaded on every Claude Code session
- Synced across all your machines

### 2. Memory System (Supabase PGVector)
- Stores conversation context, decisions, and project progress
- Uses embeddings for intelligent context retrieval
- Integrates with FlowState for activity tracking

### 3. Enhanced Commands
- `claude-full` - Starts Claude with complete context loaded
- `claude-memory` - Save important information to memory
- `claude-check` - View recent activities and context
- `claude-context` - Display current system status

### 4. Multi-Machine Support
- Works seamlessly across Windows/WSL, macOS, and Linux
- Normalizes machine names for consistent tracking
- Maintains separate contexts for different environments

## Use Cases

### For Individual Developers
- Continue coding sessions exactly where you left off
- Maintain project context across days or weeks
- Never re-explain your setup or preferences

### For Teams
- Share project context and decisions
- Maintain consistent AI assistance across team members
- Track AI-assisted development in FlowState

### For Multi-Project Work
- Switch between projects without losing context
- Maintain separate memory spaces for different clients
- Track time and activities per project

## Architecture

```
┌─────────────────────┐
│   Claude Code       │
│  (Terminal/CLI)     │
└──────────┬──────────┘
           │
┌──────────┴──────────┐
│   Claude Tools Kit  │
│  - Context Loader   │
│  - Memory Manager   │
│  - Command Aliases  │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
┌───┴───┐    ┌───┴────┐
│Config │    │Supabase│
│Files  │    │PGVector│
└───────┘    └────────┘
```

## Getting Started

See the main [README.md](README.md) for quick setup instructions.

## Advanced Features

### Custom Memory Embeddings
CTK uses OpenAI embeddings to create semantic search capabilities for your memories, allowing Claude to find relevant context even from vague queries.

### FlowState Activity Sync
All Claude Code activities are automatically logged to FlowState with:
- Timestamps and duration
- Project association
- Machine identification
- Activity categorization

### Trigger-Based Automation
SQL triggers ensure that memories are automatically synced to FlowState activities without manual intervention.

## Future Roadmap

- [ ] Voice command integration
- [ ] Mobile app for quick memory saves
- [ ] Team collaboration features
- [ ] Advanced analytics dashboard
- [ ] Integration with more AI tools

---

**CTK is your persistent AI memory layer, ensuring every Claude session builds on the last.**