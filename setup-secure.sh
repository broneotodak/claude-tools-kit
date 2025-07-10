#\!/bin/bash
# CTK Secure Setup - Uses centralized credentials

echo "🔐 CTK Secure Setup Starting..."

# Source secure credentials
source ~/.credentials/ctk/load-credentials.sh

# Run original setup
./setup.sh

# Link credentials to CTK
mkdir -p ~/.claudecode
ln -sf ~/.credentials/ctk/master.env ~/.claudecode/.env

# Add credential loader to shell
if \! grep -q "load_ctk_credentials" ~/.zshrc; then
    echo "" >> ~/.zshrc
    echo "# CTK Credential Loader" >> ~/.zshrc
    echo "source ~/.credentials/ctk/load-credentials.sh" >> ~/.zshrc
fi

echo "✅ CTK configured with secure credential system\!"
EOF < /dev/null