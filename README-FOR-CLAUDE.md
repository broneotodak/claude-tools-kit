# CTK Implementation Guide for Claude/AI

This document is specifically written for Claude or any AI assistant to understand and implement the Claude Tools Kit (CTK) system on any machine.

## 🤖 What is CTK?

CTK (Claude Tools Kit) is a system that gives Claude Code persistent memory and context awareness across sessions. It transforms Claude from a stateless tool into a context-aware coding partner.

## 🎯 Core Components

1. **Memory System** - Supabase PGVector database for semantic memory storage
2. **RAG System** - Retrieval Augmented Generation for automatic context loading
3. **Automated Commands** - Shell commands that integrate memory operations
4. **Configuration Files** - `claude.md` and `.env` for system settings

## 📋 Implementation Steps for Any Machine

### Step 1: Check Prerequisites

```bash
# Check if this is macOS, Linux, or WSL
uname -a

# Check if git is installed
git --version

# Check if Node.js is installed
node --version

# Check if the user has a home directory
echo $HOME
```

### Step 2: Clone CTK Repository

```bash
# Clone the CTK repository
cd ~
git clone https://github.com/broneotodak/claude-tools-kit.git

# Navigate to CTK
cd claude-tools-kit
```

### Step 3: Set Up Configuration

#### Create `.env` file:
```bash
# Copy the example
cp .env.example .env

# The .env file needs these values:
# SUPABASE_URL=https://uzamamymfzhelvkwpvgt.supabase.co
# SUPABASE_ANON_KEY=<get from user or existing .env>
# SUPABASE_SERVICE_ROLE_KEY=<get from user or existing .env>
# OPENAI_API_KEY=<get from user or existing .env>
```

#### Create or update `claude.md`:
```bash
# Copy template
cp claude.md.template ~/claude.md

# Update with machine-specific info:
# - Machine name (detect with: hostname)
# - User (detect with: whoami)
# - OS (detect with: uname -s)
```

### Step 4: Run Setup Script

```bash
# For enhanced setup with all features
./setup-enhanced.sh

# This will:
# - Install dependencies
# - Set up command aliases
# - Configure shell integration
# - Create necessary symlinks
```

### Step 5: Platform-Specific Adjustments

#### For macOS:
```bash
# Use .zshrc instead of .bashrc
sed -i '' 's/.bashrc/.zshrc/g' setup-enhanced.sh
sed -i '' 's/bash/zsh/g' setup-ctk-commands.sh

# Install GNU coreutils if needed
brew install coreutils
```

#### For Linux (Direct Terminal):
```bash
# Everything should work as-is
# Just ensure .bashrc is sourced
```

#### For WSL (Windows):
```bash
# Ensure access to Windows drives
# Project path might be /mnt/c/ or /mnt/h/
# Update paths in claude.md accordingly
```

### Step 6: Install CTK Commands

```bash
# Run the CTK commands setup
./setup-ctk-commands.sh

# Reload shell
source ~/.bashrc  # or ~/.zshrc on macOS
```

## 🔧 How to Use CTK (For Claude)

### When Starting a New Session:

1. **Check if CTK is installed:**
```bash
# Look for these indicators:
ls -la ~/claude-tools-kit
cat ~/.ctk-installed
type ctk
```

2. **If CTK is installed, use these commands:**
```bash
# Check system status
ctk status

# Search memories
ctk memory <search term>

# Read configuration
ctk claude.md

# Start with RAG context
ctk start
```

3. **Understanding Memory Search:**
```bash
# Simple search
ctk memory "webhook error"

# Project-specific search
ctk memory --project "FlowState AI" 

# Recent memories
ctk memory --days 7

# Semantic search (if embeddings exist)
./tools/rag-semantic-search.js "database optimization"
```

### Memory Structure:
```javascript
{
  user_id: "neo_todak",          // Required
  memory_type: "technical_solution", // Required
  content: "The actual memory",   // Required
  category: "Bug Fix",           // Required
  source: "claude_desktop",      // Required (must be "claude_desktop")
  metadata: {                    // Optional but recommended
    project: "ProjectName",
    machine: "MachineName",
    tool: "claude_code",
    feature: "feature_name"
  },
  importance: 5                  // 1-10 scale
}
```

### Saving New Memories:
```bash
# Use the enhanced save tool
./tools/save-memory-enhanced.js \
  --project "ProjectName" \
  --importance 7 \
  --category "Technical" \
  "Memory content here"
```

## 🚨 Common Issues and Solutions

### Issue: "ctk: command not found"
```bash
# Solution: Source the shell config
source ~/.bashrc  # or ~/.zshrc

# Or run setup again
./setup-ctk-commands.sh
```

### Issue: "Supabase not configured"
```bash
# Solution: Check .env file
cat ~/.env

# Ensure all required keys are present
# If missing, ask user for credentials
```

### Issue: "No memories found"
```bash
# Solution: Check connection
./tools/check-memory-health.js

# Try direct query
./tools/check-latest-activities.js
```

## 📱 Platform Detection Script

When implementing CTK, use this to detect the platform:

```bash
#!/bin/bash
# Detect platform and adjust CTK setup

if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "macOS detected"
    SHELL_RC="$HOME/.zshrc"
    SHELL_NAME="zsh"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if grep -q Microsoft /proc/version; then
        echo "WSL detected"
        SHELL_RC="$HOME/.bashrc"
        SHELL_NAME="bash"
    else
        echo "Linux detected"
        SHELL_RC="$HOME/.bashrc"
        SHELL_NAME="bash"
    fi
fi
```

## 🔄 Daily Workflow with CTK

1. **Start of session:**
   - Run `ctk status` to verify system
   - Run `ctk memory` to see recent context
   - Run `ctk start` to generate startup prompt

2. **During work:**
   - Use `ctk memory <query>` to find relevant past solutions
   - Save important decisions with `save-memory`

3. **End of session:**
   - Important findings are automatically saved
   - Run `ctk memory --days 1` to review

## 📌 Key Points for Claude to Remember

1. **CTK is already installed** on neo's Windows WSL at `~/claude-tools-kit`
2. **Memory database** is Supabase project: uzamamymfzhelvkwpvgt
3. **Default user** is "neo_todak"
4. **Primary machines**: Windows Home PC (WSL), MacBook Pro
5. **Always check** `ctk status` first when starting

## 🎯 Quick Start for Claude

When user mentions CTK or asks about memory:

```bash
# 1. Check if CTK exists
ls -la ~/claude-tools-kit

# 2. Check status
ctk status 2>/dev/null || echo "CTK not set up"

# 3. Search relevant memories
ctk memory <topic> 2>/dev/null || echo "Run setup first"

# 4. If not working, guide through setup
cat ~/claude-tools-kit/README-FOR-CLAUDE.md
```

---

This guide should be read by Claude at the start of any session where CTK implementation or usage is needed.