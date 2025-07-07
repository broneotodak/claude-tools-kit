#!/bin/bash

echo "📦 Setting up Claude Tools Kit GitHub Repository"
echo "=============================================="

# Initialize git repository
echo "1. Initializing git repository..."
git init

# Create initial commit
echo "2. Adding files..."
git add .
git commit -m "Initial commit: Claude Tools Kit 🛠️

A comprehensive toolkit for Claude Code users:
- Automatic context loading
- Memory management tools
- FlowState integration
- Multi-machine support
- Database triggers and functions

Built with 💜 by Neo Todak"

# Instructions for GitHub
echo ""
echo "✅ Local repository ready!"
echo ""
echo "Next steps:"
echo "=========="
echo ""
echo "1. Create a new repository on GitHub:"
echo "   - Go to: https://github.com/new"
echo "   - Repository name: claude-tools-kit"
echo "   - Description: Claude Code toolkit for context management and memory integration"
echo "   - Keep it PUBLIC (so you can clone anywhere)"
echo "   - DON'T initialize with README (we already have one)"
echo ""
echo "2. After creating the empty repository on GitHub, run these commands:"
echo ""
echo "   git remote add origin https://github.com/YOUR_USERNAME/claude-tools-kit.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "3. For private repository with credentials:"
echo "   - Use GitHub's personal access token"
echo "   - Or set up SSH key for authentication"
echo ""
echo "📌 Remember to replace YOUR_USERNAME with your actual GitHub username!"