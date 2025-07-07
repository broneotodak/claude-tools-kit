# Claude Tools Kit 🛠️

A comprehensive toolkit for Claude Code users to maintain context, manage memories, and work efficiently across multiple machines.

## 🎯 Key Features
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

### Tools
1. **save-memory.js** - Save memories to PGVector
2. **check-memory.js** - Query and check memories
3. **test-trigger.js** - Test database triggers
4. **analyze-activities.js** - Analyze FlowState activities

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