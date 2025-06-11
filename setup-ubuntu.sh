#!/bin/bash

# Autonomous AI MCP Server - Ubuntu Setup Script
# This script sets up the server on a fresh Ubuntu system

set -e  # Exit on any error

echo "🚀 Setting up Autonomous AI MCP Server on Ubuntu..."

# Determine the directory containing this script before any changes
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user with sudo privileges."
   exit 1
fi

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install essential packages
print_status "Installing essential packages..."
sudo apt install -y curl wget git build-essential software-properties-common

# Install Node.js 20.x (LTS)
print_status "Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify Node.js installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
print_success "Node.js installed: $NODE_VERSION"
print_success "npm installed: $NPM_VERSION"

# Install additional dependencies for Puppeteer
print_status "Installing Puppeteer dependencies..."

# libasound2 was renamed to libasound2t64 starting with Ubuntu 24.04.
# Check for the new package first and fall back to libasound2 on older systems.
if apt-cache show libasound2t64 >/dev/null 2>&1; then
    ALSA_PACKAGE="libasound2t64"
else
    ALSA_PACKAGE="libasound2"
fi

sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    "$ALSA_PACKAGE" \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

# Install Git (if not already installed)
print_status "Ensuring Git is installed..."
sudo apt install -y git

# Create project directory
PROJECT_DIR="$HOME/autonomous-ai-server"
print_status "Creating project directory at $PROJECT_DIR..."

if [ -d "$PROJECT_DIR" ]; then
    print_warning "Directory $PROJECT_DIR already exists. Backing up..."
    mv "$PROJECT_DIR" "$PROJECT_DIR.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Copy project files from the original script location
print_status "Copying project files from $SCRIPT_DIR..."

# Copy all necessary files
cp "$SCRIPT_DIR/package.json" .
cp "$SCRIPT_DIR/tsconfig.json" .
cp "$SCRIPT_DIR/README.md" .
cp "$SCRIPT_DIR/.gitignore" .
cp -r "$SCRIPT_DIR/src" .

# Copy Docker files if they exist
if [ -f "$SCRIPT_DIR/Dockerfile" ]; then
    cp "$SCRIPT_DIR/Dockerfile" .
fi
if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    cp "$SCRIPT_DIR/docker-compose.yml" .
fi
if [ -f "$SCRIPT_DIR/.dockerignore" ]; then
    cp "$SCRIPT_DIR/.dockerignore" .
fi

# Install npm dependencies
print_status "Installing npm dependencies..."
npm install

# Build the project
print_status "Building the project..."
npm run build

# Create systemd service file
print_status "Creating systemd service with auto-start configuration..."
sudo tee /etc/systemd/system/autonomous-ai-mcp.service > /dev/null <<EOF
[Unit]
Description=Autonomous AI MCP Server
Documentation=https://github.com/your-repo/autonomous-ai-server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
Environment=WORKING_DIRECTORY=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/build/index.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
TimeoutStartSec=30
TimeoutStopSec=30
KillMode=process
StandardOutput=journal
StandardError=journal
SyslogIdentifier=autonomous-ai-mcp

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$PROJECT_DIR

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service for auto-start
print_status "Enabling systemd service for auto-start on boot..."
sudo systemctl daemon-reload
sudo systemctl enable autonomous-ai-mcp

# Verify the service is enabled for auto-start
if sudo systemctl is-enabled autonomous-ai-mcp >/dev/null 2>&1; then
    print_success "Service enabled for auto-start on boot!"
else
    print_error "Failed to enable service for auto-start"
    exit 1
fi

# Create startup script
print_status "Creating startup script..."
cat > "$PROJECT_DIR/start-server.sh" <<EOF
#!/bin/bash
cd "$PROJECT_DIR"
node build/index.js
EOF
chmod +x "$PROJECT_DIR/start-server.sh"

# Create environment configuration
print_status "Creating environment configuration..."
cat > "$PROJECT_DIR/.env" <<EOF
# Autonomous AI MCP Server Configuration
NODE_ENV=production
WORKING_DIRECTORY=$PROJECT_DIR
PORT=3000

# Optional: Set custom working directory for file operations
# WORKING_DIRECTORY=/path/to/your/projects

# Optional: Enable debug logging
# DEBUG=true
EOF

# Create MCP configuration example
print_status "Creating MCP configuration example..."
cat > "$PROJECT_DIR/mcp-config-remote.json" <<EOF
{
  "mcpServers": {
    "autonomous-ai-remote": {
      "command": "ssh",
      "args": [
        "your-username@your-server-ip",
        "cd $PROJECT_DIR && node build/index.js"
      ],
      "env": {
        "WORKING_DIRECTORY": "$PROJECT_DIR"
      }
    }
  }
}
EOF

# Set up firewall (if ufw is available)
if command -v ufw &> /dev/null; then
    print_status "Configuring firewall..."
    sudo ufw allow ssh
    sudo ufw allow 3000/tcp
    print_warning "Firewall configured. Enable with: sudo ufw enable"
fi

# Create update script
print_status "Creating update script..."
cat > "$PROJECT_DIR/update-server.sh" <<EOF
#!/bin/bash
cd "$PROJECT_DIR"
echo "Stopping service..."
sudo systemctl stop autonomous-ai-mcp
echo "Pulling latest changes..."
git pull
echo "Installing dependencies..."
npm install
echo "Building project..."
npm run build
echo "Starting service..."
sudo systemctl start autonomous-ai-mcp
echo "Update complete!"
EOF
chmod +x "$PROJECT_DIR/update-server.sh"

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"

# Test the installation
print_status "Testing the installation..."
if npm run build; then
    print_success "Build successful!"
else
    print_error "Build failed. Please check the error messages above."
    exit 1
fi

# Start the service
print_status "Starting the service..."
sudo systemctl start autonomous-ai-mcp

# Wait a moment for service to start
sleep 3

# Check service status
if sudo systemctl is-active --quiet autonomous-ai-mcp; then
    print_success "Service is running!"
else
    print_error "Service failed to start. Check logs with: sudo journalctl -u autonomous-ai-mcp -f"
    exit 1
fi

# Verify auto-start configuration
print_status "Verifying auto-start configuration..."
ENABLED_STATUS=$(sudo systemctl is-enabled autonomous-ai-mcp 2>/dev/null || echo "disabled")
if [ "$ENABLED_STATUS" = "enabled" ]; then
    print_success "✅ Auto-start on boot: ENABLED"
else
    print_error "❌ Auto-start on boot: DISABLED"
    print_status "Attempting to re-enable..."
    sudo systemctl enable autonomous-ai-mcp
    if sudo systemctl is-enabled autonomous-ai-mcp >/dev/null 2>&1; then
        print_success "✅ Auto-start on boot: NOW ENABLED"
    else
        print_error "❌ Failed to enable auto-start"
    fi
fi

# Test service restart to verify auto-start functionality
print_status "Testing service restart functionality..."
sudo systemctl restart autonomous-ai-mcp
sleep 5
if sudo systemctl is-active --quiet autonomous-ai-mcp; then
    print_success "✅ Service restart: SUCCESSFUL"
else
    print_error "❌ Service restart: FAILED"
fi

# Create auto-start verification script
print_status "Creating auto-start verification script..."
cat > "$PROJECT_DIR/verify-autostart.sh" <<EOF
#!/bin/bash
echo "🔍 Verifying Autonomous AI MCP Server auto-start configuration..."
echo ""
echo "Service Status:"
sudo systemctl status autonomous-ai-mcp --no-pager -l
echo ""
echo "Auto-start Status:"
if sudo systemctl is-enabled autonomous-ai-mcp >/dev/null 2>&1; then
    echo "✅ Service is ENABLED for auto-start on boot"
else
    echo "❌ Service is NOT enabled for auto-start"
    echo "Run: sudo systemctl enable autonomous-ai-mcp"
fi
echo ""
echo "To test auto-start manually:"
echo "1. sudo systemctl stop autonomous-ai-mcp"
echo "2. sudo systemctl start autonomous-ai-mcp"
echo "3. sudo systemctl status autonomous-ai-mcp"
EOF
chmod +x "$PROJECT_DIR/verify-autostart.sh"

# Display completion message
echo ""
echo "🎉 Setup Complete!"
echo ""
echo "🚀 AUTO-START CONFIGURATION:"
echo "   ✅ Service will automatically start on server boot/restart"
echo "   ✅ Service will restart automatically if it crashes"
echo "   ✅ Service is configured with proper dependencies"
echo ""
echo "📋 Next Steps:"
echo "1. Configure your client to connect to this server"
echo "2. Update the MCP configuration with your server details"
echo "3. Test the connection"
echo "4. Optionally reboot to test auto-start: sudo reboot"
echo ""
echo "📁 Project Location: $PROJECT_DIR"
echo "🔧 Service Name: autonomous-ai-mcp"
echo "📝 Configuration: $PROJECT_DIR/.env"
echo ""
echo "🛠️  Useful Commands:"
echo "   Start service:      sudo systemctl start autonomous-ai-mcp"
echo "   Stop service:       sudo systemctl stop autonomous-ai-mcp"
echo "   Restart service:    sudo systemctl restart autonomous-ai-mcp"
echo "   Check status:       sudo systemctl status autonomous-ai-mcp"
echo "   View logs:          sudo journalctl -u autonomous-ai-mcp -f"
echo "   Verify auto-start:  $PROJECT_DIR/verify-autostart.sh"
echo "   Update server:      $PROJECT_DIR/update-server.sh"
echo ""
echo "🌐 Remote MCP Configuration:"
echo "   Use the configuration in: $PROJECT_DIR/mcp-config-remote.json"
echo "   Update the server IP and username as needed"
echo ""
echo "🔄 AUTO-START VERIFICATION:"
echo "   The service is now configured to start automatically on boot."
echo "   To test: sudo reboot (the service will start automatically)"
echo "   To verify: $PROJECT_DIR/verify-autostart.sh"
echo ""
print_success "Autonomous AI MCP Server is ready for remote use with auto-start enabled!"
