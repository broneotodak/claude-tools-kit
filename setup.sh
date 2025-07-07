#!/bin/bash

echo "🚀 Claude Tools Kit Setup"
echo "========================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current directory
TOOLS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Step 1: Check for .env file
echo -e "\n${YELLOW}Step 1: Environment Configuration${NC}"
if [ ! -f "$TOOLS_DIR/.env" ]; then
    if [ -f "$TOOLS_DIR/.env.example" ]; then
        cp "$TOOLS_DIR/.env.example" "$TOOLS_DIR/.env"
        echo "📝 Created .env file from template"
        echo "⚠️  Please edit .env with your credentials:"
        echo "   nano $TOOLS_DIR/.env"
        exit 1
    fi
else
    echo -e "${GREEN}✅ .env file found${NC}"
fi

# Step 2: Install npm dependencies
echo -e "\n${YELLOW}Step 2: Installing dependencies${NC}"
cd "$TOOLS_DIR"
if [ ! -d "node_modules" ]; then
    npm init -y > /dev/null 2>&1
    npm install @supabase/supabase-js dotenv
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Step 3: Create claude.md from template
echo -e "\n${YELLOW}Step 3: Creating claude.md${NC}"
if [ -f "$TOOLS_DIR/claude.md.template" ]; then
    # Get machine info
    MACHINE_NAME=$(grep MACHINE_NAME .env | cut -d'=' -f2 || echo "Windows Home PC")
    USERNAME=$(whoami)
    DATE=$(date +%Y-%m-%d)
    
    # Create personalized claude.md
    sed -e "s/{DATE}/$DATE/g" \
        -e "s/{MACHINE_NAME}/$MACHINE_NAME/g" \
        -e "s/{USERNAME}/$USERNAME/g" \
        -e "s/{ENVIRONMENT}/WSL Ubuntu/g" \
        "$TOOLS_DIR/claude.md.template" > "$TOOLS_DIR/claude.md"
    
    echo -e "${GREEN}✅ Created claude.md${NC}"
fi

# Step 4: Setup tools directory
echo -e "\n${YELLOW}Step 4: Setting up tools${NC}"
mkdir -p ~/claude-tools
cp -r "$TOOLS_DIR/tools/"* ~/claude-tools/ 2>/dev/null || true
echo -e "${GREEN}✅ Tools copied to ~/claude-tools${NC}"

# Step 5: Add Claude alias
echo -e "\n${YELLOW}Step 5: Setting up Claude alias${NC}"
ALIAS_CMD="alias claude='claude --chat \"I'\''m continuing from a previous Claude Code session. Please read: $TOOLS_DIR/claude.md and check recent memories. What would you like to work on?\"'"

if ! grep -q "alias claude=" ~/.bashrc; then
    echo "" >> ~/.bashrc
    echo "# Claude Code with automatic context loading" >> ~/.bashrc
    echo "$ALIAS_CMD" >> ~/.bashrc
    echo -e "${GREEN}✅ Added claude alias to .bashrc${NC}"
else
    echo -e "${GREEN}✅ Claude alias already exists${NC}"
fi

# Step 6: Create symlinks for easy access
echo -e "\n${YELLOW}Step 6: Creating convenience symlinks${NC}"
ln -sf "$TOOLS_DIR/claude.md" ~/claude.md 2>/dev/null || true
ln -sf "$TOOLS_DIR/.env" ~/claude-tools/.env 2>/dev/null || true
echo -e "${GREEN}✅ Created symlinks${NC}"

# Final instructions
echo -e "\n${GREEN}🎉 Setup Complete!${NC}"
echo -e "\nNext steps:"
echo "1. Edit your .env file with your credentials:"
echo "   nano $TOOLS_DIR/.env"
echo ""
echo "2. Reload your shell configuration:"
echo "   source ~/.bashrc"
echo ""
echo "3. Start Claude with context:"
echo "   claude"
echo ""
echo "4. To save memories:"
echo "   node ~/claude-tools/save-memory.js \"Category\" \"Title\" \"Content\" importance"
echo ""
echo "5. Push to GitHub:"
echo "   cd $TOOLS_DIR"
echo "   git init"
echo "   git add ."
echo "   git commit -m \"Initial claude-tools-kit setup\""
echo "   git remote add origin https://github.com/YOUR_USERNAME/claude-tools-kit.git"
echo "   git push -u origin main"