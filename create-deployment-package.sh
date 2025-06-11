#!/bin/bash

# Create Deployment Package Script
# This script creates a deployment-ready package for Ubuntu servers

echo "📦 Creating deployment package for Autonomous AI MCP Server..."

# Get the current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create deployment directory
DEPLOY_DIR="autonomous-ai-server-deploy"
echo "Creating deployment directory: $DEPLOY_DIR"

# Remove existing deployment directory if it exists
if [ -d "$DEPLOY_DIR" ]; then
    rm -rf "$DEPLOY_DIR"
fi

mkdir -p "$DEPLOY_DIR"

# Copy essential files
echo "Copying project files..."
cp package.json "$DEPLOY_DIR/"
cp tsconfig.json "$DEPLOY_DIR/"
cp README.md "$DEPLOY_DIR/"
cp UBUNTU-SETUP.md "$DEPLOY_DIR/"
cp setup-ubuntu.sh "$DEPLOY_DIR/"
cp .gitignore "$DEPLOY_DIR/"

# Copy source directory
cp -r src "$DEPLOY_DIR/"

# Copy Docker files if they exist
if [ -f "Dockerfile" ]; then
    cp Dockerfile "$DEPLOY_DIR/"
fi
if [ -f "docker-compose.yml" ]; then
    cp docker-compose.yml "$DEPLOY_DIR/"
fi
if [ -f ".dockerignore" ]; then
    cp .dockerignore "$DEPLOY_DIR/"
fi

# Create a simple transfer script
cat > "$DEPLOY_DIR/transfer-to-server.sh" <<'EOF'
#!/bin/bash

# Transfer to Ubuntu Server Script
# Usage: ./transfer-to-server.sh username@server-ip

if [ $# -eq 0 ]; then
    echo "Usage: $0 username@server-ip"
    echo "Example: $0 ubuntu@192.168.1.100"
    exit 1
fi

SERVER=$1
echo "Transferring files to $SERVER..."

# Create archive
tar -czf autonomous-ai-server.tar.gz *

# Transfer to server
scp autonomous-ai-server.tar.gz $SERVER:~/

# Connect and extract
ssh $SERVER << 'ENDSSH'
cd ~
tar -xzf autonomous-ai-server.tar.gz
rm autonomous-ai-server.tar.gz
cd autonomous-ai-server-deploy
chmod +x setup-ubuntu.sh
echo "Files transferred successfully!"
echo "Run the following commands on the server:"
echo "  cd ~/autonomous-ai-server-deploy"
echo "  ./setup-ubuntu.sh"
ENDSSH

# Clean up local archive
rm autonomous-ai-server.tar.gz

echo "Transfer complete! SSH to your server and run:"
echo "  cd ~/autonomous-ai-server-deploy"
echo "  ./setup-ubuntu.sh"
EOF

chmod +x "$DEPLOY_DIR/transfer-to-server.sh"

# Create a quick start guide
cat > "$DEPLOY_DIR/QUICK-START.md" <<'EOF'
# Quick Start Guide

## Option 1: Automated Transfer (if you have SSH access)

```bash
# Make transfer script executable
chmod +x transfer-to-server.sh

# Transfer to your Ubuntu server
./transfer-to-server.sh username@your-server-ip

# SSH to your server and run setup
ssh username@your-server-ip
cd ~/autonomous-ai-server-deploy
./setup-ubuntu.sh
```

## Option 2: Manual Transfer

1. **Create archive:**
   ```bash
   tar -czf autonomous-ai-server.tar.gz *
   ```

2. **Upload to your Ubuntu server** (using your preferred method):
   - SCP: `scp autonomous-ai-server.tar.gz username@server-ip:~/`
   - SFTP, rsync, or web upload

3. **Extract and setup on server:**
   ```bash
   ssh username@server-ip
   cd ~
   tar -xzf autonomous-ai-server.tar.gz
   cd autonomous-ai-server-deploy
   chmod +x setup-ubuntu.sh
   ./setup-ubuntu.sh
   ```

## Option 3: Git Clone (if you have a repository)

```bash
# On your Ubuntu server
git clone https://github.com/your-username/autonomous-ai-server.git
cd autonomous-ai-server
chmod +x setup-ubuntu.sh
./setup-ubuntu.sh
```

## After Setup

The server will be running as a systemd service. You can:

- **Check status:** `sudo systemctl status autonomous-ai-mcp`
- **View logs:** `sudo journalctl -u autonomous-ai-mcp -f`
- **Restart:** `sudo systemctl restart autonomous-ai-mcp`

## Client Configuration

Add this to your local MCP configuration:

```json
{
  "mcpServers": {
    "autonomous-ai-remote": {
      "command": "ssh",
      "args": [
        "username@your-server-ip",
        "cd /home/username/autonomous-ai-server && node build/index.js"
      ],
      "env": {
        "WORKING_DIRECTORY": "/home/username/autonomous-ai-server"
      }
    }
  }
}
```

Replace `username` and `your-server-ip` with your actual values.
EOF

# Create archive
echo "Creating deployment archive..."
cd "$SCRIPT_DIR"
tar -czf autonomous-ai-server-deploy.tar.gz "$DEPLOY_DIR"

echo ""
echo "✅ Deployment package created successfully!"
echo ""
echo "📁 Package location: $SCRIPT_DIR/autonomous-ai-server-deploy.tar.gz"
echo "📁 Extracted files: $SCRIPT_DIR/$DEPLOY_DIR/"
echo ""
echo "🚀 Next steps:"
echo "1. Transfer the archive to your Ubuntu server"
echo "2. Extract: tar -xzf autonomous-ai-server-deploy.tar.gz"
echo "3. Run setup: cd autonomous-ai-server-deploy && ./setup-ubuntu.sh"
echo ""
echo "💡 Or use the automated transfer script:"
echo "   cd $DEPLOY_DIR && ./transfer-to-server.sh username@server-ip"
echo ""
echo "📖 See QUICK-START.md in the deployment directory for detailed instructions"
