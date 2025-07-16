#!/bin/bash

# CTK Guardian Setup
# This creates shell aliases and git hooks to FORCE validation

echo "🛡️ Setting up CTK Guardian - Automatic Protection"
echo "================================================"

# 1. Create guardian wrapper scripts
mkdir -p ~/claude-tools/guardians

# 2. Create migration interceptor
cat > ~/claude-tools/guardians/migration-guard.sh << 'EOF'
#!/bin/bash
echo "🛡️ CTK GUARDIAN: Migration Detected!"
echo "===================================="
echo ""
echo "STOP! You're about to run a migration script."
echo ""
echo "Required checks:"
echo "1. Have you read the source data format? (y/n)"
read -r check1
if [ "$check1" != "y" ]; then
    echo "❌ BLOCKED: Must read source data first!"
    exit 1
fi

echo "2. Have you verified the destination schema? (y/n)"
read -r check2
if [ "$check2" != "y" ]; then
    echo "❌ BLOCKED: Must verify schema first!"
    exit 1
fi

echo "3. Will you preview before bulk operations? (y/n)"
read -r check3
if [ "$check3" != "y" ]; then
    echo "❌ BLOCKED: Preview is mandatory!"
    exit 1
fi

echo ""
echo "✅ Checks passed. Proceeding with migration..."
echo ""

# Log this check
echo "$(date): Migration guard passed for $@" >> ~/claude-tools/guardian.log

# Execute the original command
exec "$@"
EOF

chmod +x ~/claude-tools/guardians/migration-guard.sh

# 3. Create SQL interceptor
cat > ~/claude-tools/guardians/sql-guard.sh << 'EOF'
#!/bin/bash
# Intercept dangerous SQL operations

if echo "$@" | grep -iE "(drop|delete|truncate|update.*set)" > /dev/null; then
    echo "🛡️ CTK GUARDIAN: Dangerous SQL Detected!"
    echo "========================================"
    echo ""
    echo "Command contains: DROP/DELETE/TRUNCATE/UPDATE"
    echo ""
    echo "Have you:"
    echo "1. Created a backup? (y/n)"
    read -r backup
    if [ "$backup" != "y" ]; then
        echo "❌ BLOCKED: Create backup first!"
        exit 1
    fi
    
    echo "2. Tested on a single record? (y/n)"
    read -r test
    if [ "$test" != "y" ]; then
        echo "❌ BLOCKED: Test on single record first!"
        exit 1
    fi
    
    echo "$(date): SQL guard passed for $@" >> ~/claude-tools/guardian.log
fi

# Execute original command
exec "$@"
EOF

chmod +x ~/claude-tools/guardians/sql-guard.sh

# 4. Create CLAUDE.md enforcer
cat > ~/claude-tools/guardians/claude-md-check.sh << 'EOF'
#!/bin/bash
# Check if CLAUDE.md exists and load it

if [ -f "./CLAUDE.md" ]; then
    echo "📋 CTK Guardian: Found CLAUDE.md in current directory"
    echo "Please ensure you've read the project-specific instructions!"
    echo ""
    head -20 ./CLAUDE.md
    echo ""
    echo "... (see full file for complete instructions)"
    echo ""
fi
EOF

chmod +x ~/claude-tools/guardians/claude-md-check.sh

# 5. Create shell aliases that intercept commands
cat >> ~/.zshrc << 'EOF'

# CTK Guardian Aliases - Protect against dangerous operations
alias migrate='~/claude-tools/guardians/migration-guard.sh'
alias import='~/claude-tools/guardians/migration-guard.sh'

# Intercept node/python scripts with certain names
node() {
    if echo "$@" | grep -iE "(migrat|import|sync|transfer)" > /dev/null; then
        ~/claude-tools/guardians/migration-guard.sh node "$@"
    else
        command node "$@"
    fi
}

python() {
    if echo "$@" | grep -iE "(migrat|import|sync|transfer)" > /dev/null; then
        ~/claude-tools/guardians/migration-guard.sh python "$@"
    else
        command python "$@"
    fi
}

# SQL protection
psql() {
    ~/claude-tools/guardians/sql-guard.sh command psql "$@"
}

# Check CLAUDE.md on directory change
cd() {
    builtin cd "$@"
    ~/claude-tools/guardians/claude-md-check.sh
}

# CTK reminder on new terminal
echo "🛡️ CTK Guardian Active - Type 'ctk-help' for protection status"

alias ctk-help='echo "CTK Guardian Protection:
- Migration scripts require validation
- SQL operations are monitored
- CLAUDE.md is auto-checked
- Logs at: ~/claude-tools/guardian.log"'

EOF

# 6. Create git pre-commit hook template
cat > ~/claude-tools/guardians/pre-commit-template << 'EOF'
#!/bin/bash
# CTK Guardian Git Hook - Prevent committing corrupted data

# Check for signs of data corruption
if git diff --cached --name-only | grep -E "\.(sql|csv|json)$" > /dev/null; then
    echo "🛡️ CTK Guardian: Data files detected in commit"
    echo ""
    echo "Have you validated the data integrity? (y/n)"
    read -r answer
    if [ "$answer" != "y" ]; then
        echo "❌ Commit blocked: Validate data first!"
        exit 1
    fi
fi

# Check for migration scripts
if git diff --cached --name-only | grep -iE "(migrat|import|sync)" > /dev/null; then
    echo "🛡️ CTK Guardian: Migration script detected"
    echo ""
    echo "Has this been tested with preview mode? (y/n)"
    read -r answer
    if [ "$answer" != "y" ]; then
        echo "❌ Commit blocked: Test with preview first!"
        exit 1
    fi
fi

EOF

# 7. Function to install git hooks in a project
cat >> ~/.zshrc << 'EOF'

ctk-protect-project() {
    if [ -d .git ]; then
        cp ~/claude-tools/guardians/pre-commit-template .git/hooks/pre-commit
        chmod +x .git/hooks/pre-commit
        echo "✅ CTK Guardian installed for this project"
    else
        echo "❌ Not a git repository"
    fi
}

EOF

echo ""
echo "✅ CTK Guardian Setup Complete!"
echo ""
echo "Protection Features Installed:"
echo "1. ✅ Migration script interceptor"
echo "2. ✅ SQL operation monitor"
echo "3. ✅ CLAUDE.md auto-checker"
echo "4. ✅ Git commit protection"
echo "5. ✅ Shell function overrides"
echo ""
echo "⚠️  IMPORTANT: Run 'source ~/.zshrc' to activate"
echo ""
echo "To protect a project: cd to project and run 'ctk-protect-project'"
echo ""