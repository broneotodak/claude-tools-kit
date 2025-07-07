# Claude Tools Kit 🛠️

A comprehensive toolkit for Claude Code users to maintain context, manage memories, and work efficiently across multiple machines.

## 🚀 Quick Setup

```bash
# Clone this repository
git clone https://github.com/YOUR_USERNAME/claude-tools-kit.git ~/claude-tools-kit

# Run the setup script
cd ~/claude-tools-kit
./setup.sh
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

### 3. Claude Startup Alias
The setup script will add an alias to automatically load context:
```bash
claude  # Starts Claude Code with your context loaded
```

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

## 🤝 Contributing

Feel free to add your own tools and improvements!

---
Built with 💜 by Neo Todak