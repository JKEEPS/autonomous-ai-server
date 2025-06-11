# Ubuntu Server Setup Guide

This guide will help you set up the Autonomous AI MCP Server on a fresh Ubuntu server for remote use.

## Quick Setup (Recommended)

### 1. Download and Run Setup Script

```bash
# Download the project files
wget https://github.com/your-repo/autonomous-ai-server/archive/main.zip
unzip main.zip
cd autonomous-ai-server-main

# Make setup script executable and run it
chmod +x setup-ubuntu.sh
./setup-ubuntu.sh
```

The setup script will automatically:
- Install Node.js 20.x LTS
- Install all system dependencies
- Install Puppeteer dependencies for browser automation
- Set up the project in `~/autonomous-ai-server`
- **Create a systemd service with auto-start on boot/restart**
- **Configure automatic restart on failure**
- Configure firewall rules
- Build and start the server
- **Verify auto-start configuration**

## Manual Setup

If you prefer to set up manually:

### 1. System Requirements

- Ubuntu 20.04 LTS or newer
- 2GB+ RAM (4GB recommended for browser automation)
- 10GB+ disk space
- Internet connection

### 2. Install Node.js 20.x

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install System Dependencies

```bash
# Essential packages
sudo apt install -y curl wget git build-essential

# Puppeteer dependencies for browser automation
sudo apt install -y \
    ca-certificates fonts-liberation libappindicator3-1 \
    # libasound2t64 is used on Ubuntu 24.04. Older releases use libasound2.
    \
    $(apt-cache show libasound2t64 >/dev/null 2>&1 && echo libasound2t64 || echo libasound2) \
    libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release \
    wget xdg-utils
```

### 4. Set Up Project

```bash
# Create project directory
mkdir -p ~/autonomous-ai-server
cd ~/autonomous-ai-server

# Copy project files (upload via scp, git clone, etc.)
# Then install dependencies
npm install

# Build the project
npm run build
```

### 5. Create Systemd Service

```bash
# Create service file
sudo tee /etc/systemd/system/autonomous-ai-mcp.service > /dev/null <<EOF
[Unit]
Description=Autonomous AI MCP Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/autonomous-ai-server
Environment=NODE_ENV=production
Environment=WORKING_DIRECTORY=$HOME/autonomous-ai-server
ExecStart=/usr/bin/node $HOME/autonomous-ai-server/build/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=autonomous-ai-mcp

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable autonomous-ai-mcp
sudo systemctl start autonomous-ai-mcp
```

## Configuration

### Environment Variables

Create a `.env` file in the project directory:

```bash
# Autonomous AI MCP Server Configuration
NODE_ENV=production
WORKING_DIRECTORY=/home/yourusername/autonomous-ai-server

# Optional: Set custom working directory for file operations
# WORKING_DIRECTORY=/path/to/your/projects

# Optional: Enable debug logging
# DEBUG=true
```

### Firewall Configuration

```bash
# Allow SSH and MCP server port
sudo ufw allow ssh
sudo ufw allow 3000/tcp

# Enable firewall (optional)
sudo ufw enable
```

## Client Configuration

### SSH-based Connection

Add this to your local MCP configuration:

```json
{
  "mcpServers": {
    "autonomous-ai-remote": {
      "command": "ssh",
      "args": [
        "your-username@your-server-ip",
        "cd /home/your-username/autonomous-ai-server && node build/index.js"
      ],
      "env": {
        "WORKING_DIRECTORY": "/home/your-username/autonomous-ai-server"
      }
    }
  }
}
```

### SSH Key Setup (Recommended)

```bash
# On your local machine, generate SSH key if you don't have one
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

# Copy public key to server
ssh-copy-id your-username@your-server-ip

# Test connection
ssh your-username@your-server-ip
```

## Auto-Start Configuration

The MCP server is configured to **automatically start on boot/restart** and **restart automatically if it crashes**.

### Verify Auto-Start Status

```bash
# Check if service is enabled for auto-start
sudo systemctl is-enabled autonomous-ai-mcp

# Should return: enabled
```

### Auto-Start Verification Script

The setup creates a verification script:

```bash
# Run the verification script
~/autonomous-ai-server/verify-autostart.sh
```

### Manual Auto-Start Configuration

If auto-start is not working:

```bash
# Enable auto-start
sudo systemctl enable autonomous-ai-mcp

# Verify it's enabled
sudo systemctl is-enabled autonomous-ai-mcp

# Test by rebooting
sudo reboot
```

### Test Auto-Start

To test that auto-start works:

```bash
# Method 1: Reboot the server
sudo reboot

# After reboot, check if service started automatically
sudo systemctl status autonomous-ai-mcp

# Method 2: Simulate crash and restart
sudo systemctl stop autonomous-ai-mcp
sudo systemctl start autonomous-ai-mcp
```

## Management Commands

### Service Management

```bash
# Start service
sudo systemctl start autonomous-ai-mcp

# Stop service
sudo systemctl stop autonomous-ai-mcp

# Restart service
sudo systemctl restart autonomous-ai-mcp

# Check status
sudo systemctl status autonomous-ai-mcp

# Check if enabled for auto-start
sudo systemctl is-enabled autonomous-ai-mcp

# View logs
sudo journalctl -u autonomous-ai-mcp -f

# View recent logs
sudo journalctl -u autonomous-ai-mcp -n 50
```

### Manual Start (for testing)

```bash
cd ~/autonomous-ai-server
node build/index.js
```

### Update Server

```bash
cd ~/autonomous-ai-server
sudo systemctl stop autonomous-ai-mcp
git pull  # or upload new files
npm install
npm run build
sudo systemctl start autonomous-ai-mcp
```

## Troubleshooting

### Common Issues

1. **Service won't start**
   ```bash
   # Check logs
   sudo journalctl -u autonomous-ai-mcp -n 50
   
   # Check if port is in use
   sudo netstat -tlnp | grep 3000
   ```

2. **Puppeteer issues**
   ```bash
   # Install missing dependencies
   sudo apt install -y chromium-browser
   
   # Set Puppeteer to use system Chromium
   export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
   ```

3. **Permission issues**
   ```bash
   # Fix ownership
   sudo chown -R $USER:$USER ~/autonomous-ai-server
   
   # Fix permissions
   chmod +x ~/autonomous-ai-server/start-server.sh
   ```

4. **Memory issues**
   ```bash
   # Check memory usage
   free -h
   
   # Add swap if needed
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

### Performance Optimization

1. **For production use:**
   ```bash
   # Increase file descriptor limits
   echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
   echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
   ```

2. **For browser automation:**
   ```bash
   # Install additional fonts for better rendering
   sudo apt install -y fonts-noto fonts-noto-cjk fonts-noto-color-emoji
   ```

## Security Considerations

1. **SSH Security:**
   - Use SSH keys instead of passwords
   - Change default SSH port
   - Configure fail2ban

2. **Firewall:**
   - Only open necessary ports
   - Consider VPN for additional security

3. **Updates:**
   - Keep system updated: `sudo apt update && sudo apt upgrade`
   - Monitor security advisories

## Support

If you encounter issues:

1. Check the logs: `sudo journalctl -u autonomous-ai-mcp -f`
2. Verify all dependencies are installed
3. Ensure the service user has proper permissions
4. Test manual startup to isolate issues

For additional help, refer to the main README.md file.
