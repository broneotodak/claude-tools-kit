# 🚀 CTK Quick Start for Claude

## If user says "I have CTK installed" or mentions CTK:

```bash
# 1. First, always check:
ctk status

# 2. Load recent memories:
ctk memory

# 3. Search specific topic:
ctk memory <topic>
```

## Common User Requests:

### "Check my memory"
```bash
ctk memory
```

### "What did we work on last time?"
```bash
ctk memory --days 3
```

### "Find information about [topic]"
```bash
ctk memory [topic]
# or for AI-powered search:
~/claude-tools-kit/tools/rag-semantic-search.js "[topic]"
```

### "Save this for later"
```bash
save-memory "content to save"
```

### "Set up CTK on my Mac"
```bash
# Read the full guide:
cat ~/claude-tools-kit/README-FOR-CLAUDE.md
```

## 🔑 Key Locations:
- CTK Install: `~/claude-tools-kit/`
- Config: `~/claude.md`
- Env: `~/.env`
- Commands: `ctk <command>`

## 📱 Platform Check:
```bash
# macOS uses .zshrc
# Linux/WSL uses .bashrc
echo $SHELL
```

## ⚡ Emergency Fix:
```bash
source ~/.bashrc  # or ~/.zshrc on Mac
```

---
💡 Show this to any Claude: `cat ~/claude-tools-kit/CLAUDE-QUICK-START.md`