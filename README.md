# Claude Tools Kit (CTK) 🛠️

A comprehensive toolkit for Claude Code users featuring safety systems, context management, and schema verification to prevent production incidents.

**CTK includes critical safety features that prevent database corruption and authentication failures.**

## 🆕 RAG System (Retrieval Augmented Generation)

CTK now includes a powerful RAG system that automatically retrieves relevant context from your memory database, making Claude Code truly context-aware and intelligent.

📖 **[Read the detailed guide](README-DETAILED.md)** to understand how CTK transforms your AI workflow.

## 🎯 Key Features
- **Schema Safety System** - Prevents schema assumption errors with pre-commit hooks
- **Authentication Protection** - Blocks dangerous auth schema modifications
- **JSONB Field Mapping** - Automatic validation of field locations
- **Automatic Context Loading** - Claude Code always starts with full configuration
- **Memory Integration** - Seamless connection to Supabase PGVector memories
- **Multi-Machine Support** - Works across Windows/WSL, Office PC, MacBook
- **Smart Commands** - Enhanced aliases for common operations

## 🚀 Quick Setup

```bash
# Clone this repository
git clone https://github.com/broneotodak/claude-tools-kit.git ~/claude-tools-kit

# Run the enhanced setup script
cd ~/claude-tools-kit
./setup-enhanced.sh

# Reload your shell
source ~/.bashrc

# Verify setup
./verify-setup.sh
```

## 📋 What's Included

### Core Files
- `claude.md` - Your personalized Claude configuration template
- `tools/` - Essential utility scripts for memory management
- `sql/` - Database triggers and functions for FlowState
- `.env.example` - Environment variables template

### Memory & Activity Tools
1. **save-memory-enhanced.js** - Save memories with proper metadata
2. **check-memory-health.js** - Memory system diagnostics
3. **fix-memory-null-owners.js** - Fix common memory issues
4. **analyze-activities.js** - Analyze FlowState activities

### RAG Tools (NEW!)
5. **rag-retrieve.js** - Search memories by query
6. **rag-semantic-search.js** - AI-powered semantic search
7. **rag-context-builder.js** - Auto-build context for Claude
8. **rag-embed-memories.js** - Create embeddings for semantic search
9. **claude-rag-startup.sh** - Start Claude with full RAG context

## 🔧 Configuration

### 1. Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
nano .env
```

Required variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `OPENAI_API_KEY` - OpenAI API key (for embeddings)

### 2. Machine Configuration
Edit `claude.md` to reflect your machine name:
- Windows Home PC
- Office PC
- MacBook Pro

### 3. Enhanced Commands
After setup, you'll have these commands available:

```bash
claude-full     # Start Claude Code with complete context from /mnt/h/Projects/Active/claudecode/
claude-memory   # Save a new memory (usage: claude-memory <category> <title> <content> <importance>)
claude-check    # Check recent activities from Supabase
claude-context  # Display current context and system status
cd-projects     # Navigate to /mnt/h/Projects/Active
```

**The environment is automatically loaded when you open a new terminal!**

## 🧠 Using the RAG System

### Quick Start with RAG
```bash
# Start Claude with auto-generated context
./tools/claude-rag-startup.sh

# Search for relevant memories
./tools/rag-retrieve.js "how to fix webhook error"

# Semantic search (AI-powered)
./tools/rag-semantic-search.js "database optimization techniques"

# Build context for current project
./tools/rag-context-builder.js --output
```

### First Time RAG Setup
```bash
# 1. Create embeddings for existing memories
./tools/rag-embed-memories.js

# 2. Set up semantic search function (run SQL in Supabase)
./tools/rag-semantic-search.js --help
```

### RAG Benefits
- 🎯 **Automatic Context** - Relevant memories loaded on startup
- 🔍 **Smart Search** - Find information using natural language
- 🧠 **Semantic Understanding** - AI understands meaning, not just keywords
- ⚡ **Faster Problem Solving** - Instantly access past solutions

## 🖥️ Multi-Machine Setup

This toolkit supports multiple machines:
- **Windows Home PC** (WSL Ubuntu)
- **Office PC**
- **MacBook Pro**

Machine names are automatically normalized in FlowState.

## 📊 FlowState Integration

Includes SQL scripts for:
- Automatic memory-to-activity sync trigger
- Machine name normalization
- Metadata preservation

## 🔍 Troubleshooting

### Context Not Loading Automatically?
The enhanced setup ensures Claude Code always loads the full configuration from:
- **Full Config**: `/mnt/h/Projects/Active/claudecode/claude.md`
- **Environment**: `/mnt/h/Projects/Active/claudecode/.env`

If you're having issues:
1. Run `./verify-setup.sh` to check your setup
2. Ensure the config files exist at the above locations
3. Run `source ~/.bashrc` to reload aliases
4. Use `claude-context` to see current status

### WSL Starting in Wrong Directory?
WSL always starts in `/home/neo`, but CTK handles this by:
- Creating proper symlinks to your full configuration
- Auto-loading environment variables on terminal start
- Providing quick navigation with `cd-projects`

## 🤝 Contributing

Feel free to add your own tools and improvements!

---
Built with 💜 by Neo Todak