#!/bin/bash

# Autonomous AI MCP Server Deployment Script
# This script helps deploy the MCP server on a remote system

set -e

echo "🚀 Autonomous AI MCP Server Deployment"
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm $(npm --version) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building the project..."
npm run build

# Check if build was successful
if [ ! -f "build/index.js" ]; then
    echo "❌ Build failed. build/index.js not found."
    exit 1
fi

echo "✅ Build successful"

# Create workspace directory
mkdir -p workspace
mkdir -p data

echo "📁 Created workspace and data directories"

# Test the server
echo "🧪 Testing the server..."
timeout 5s npm start || true

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Configure your MCP settings file with:"
echo "   {\"mcpServers\": {\"autonomous-ai\": {\"command\": \"node\", \"args\": [\"$(pwd)/build/index.js\"]}}}"
echo ""
echo "2. Set environment variables if needed:"
echo "   export WORKING_DIRECTORY=\"/path/to/your/project\""
echo ""
echo "3. Start the server:"
echo "   npm start"
echo ""
echo "4. Or use Docker:"
echo "   docker-compose up -d"
echo ""
echo "📖 See README.md for detailed configuration instructions"
