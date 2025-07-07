#!/bin/bash
# Verify Claude Tools Kit Setup

echo "🔍 Claude Tools Kit - Setup Verification"
echo "========================================"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check functions
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✅ $2${NC}"
        return 0
    else
        echo -e "${RED}❌ $2 - Not found at: $1${NC}"
        return 1
    fi
}

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✅ $2${NC}"
        return 0
    else
        echo -e "${RED}❌ $2 - Command not found: $1${NC}"
        return 1
    fi
}

check_env_var() {
    if [ ! -z "${!1}" ]; then
        echo -e "${GREEN}✅ $2 is set${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  $2 is not set${NC}"
        return 1
    fi
}

echo -e "\n${YELLOW}1. Checking core files:${NC}"
check_file "/mnt/h/Projects/Active/claudecode/claude.md" "Full configuration"
check_file "/mnt/h/Projects/Active/claudecode/.env" "Environment file"
check_file "$HOME/claude.md" "Home directory symlink"
check_file "$HOME/claude-tools-kit/tools/claude-startup.sh" "Startup script"

echo -e "\n${YELLOW}2. Checking commands:${NC}"
check_command "node" "Node.js"
check_command "npm" "NPM"
check_command "git" "Git"

echo -e "\n${YELLOW}3. Checking environment variables:${NC}"
# Source the env file if it exists
if [ -f "/mnt/h/Projects/Active/claudecode/.env" ]; then
    export $(cat /mnt/h/Projects/Active/claudecode/.env | grep -v '^#' | xargs) 2>/dev/null
fi
check_env_var "SUPABASE_URL" "SUPABASE_URL"
check_env_var "SUPABASE_ANON_KEY" "SUPABASE_ANON_KEY"
check_env_var "OPENAI_API_KEY" "OPENAI_API_KEY"

echo -e "\n${YELLOW}4. Checking aliases:${NC}"
if grep -q "claude-full" ~/.bashrc; then
    echo -e "${GREEN}✅ Enhanced aliases configured${NC}"
else
    echo -e "${RED}❌ Enhanced aliases not found - run setup-enhanced.sh${NC}"
fi

echo -e "\n${YELLOW}5. Checking Node modules:${NC}"
if [ -d "$HOME/claude-tools-kit/node_modules" ]; then
    echo -e "${GREEN}✅ Node modules installed${NC}"
else
    echo -e "${RED}❌ Node modules not installed${NC}"
fi

echo -e "\n${YELLOW}6. Testing database connection:${NC}"
if [ ! -z "$SUPABASE_URL" ] && [ -f "$HOME/claude-tools-kit/tools/check-latest-activities.js" ]; then
    cd "$HOME/claude-tools-kit"
    if timeout 5s node tools/check-latest-activities.js > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not connect to database${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Cannot test - missing configuration${NC}"
fi

echo -e "\n📊 Summary:"
echo "Run './setup-enhanced.sh' to fix any issues"
echo "Then 'source ~/.bashrc' to reload configuration"