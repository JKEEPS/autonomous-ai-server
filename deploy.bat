@echo off
setlocal enabledelayedexpansion

echo 🚀 Autonomous AI MCP Server Deployment
echo ======================================

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    echo Visit: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js detected
node --version

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ npm detected
npm --version

REM Install dependencies
echo 📦 Installing dependencies...
npm install
if errorlevel 1 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

REM Build the project
echo 🔨 Building the project...
npm run build
if errorlevel 1 (
    echo ❌ Build failed
    pause
    exit /b 1
)

REM Check if build was successful
if not exist "build\index.js" (
    echo ❌ Build failed. build\index.js not found.
    pause
    exit /b 1
)

echo ✅ Build successful

REM Create workspace directory
if not exist "workspace" mkdir workspace
if not exist "data" mkdir data

echo 📁 Created workspace and data directories

echo.
echo 🎉 Deployment completed successfully!
echo.
echo 📋 Next steps:
echo 1. Configure your MCP settings file with:
echo    {"mcpServers": {"autonomous-ai": {"command": "node", "args": ["%cd%\build\index.js"]}}}
echo.
echo 2. Set environment variables if needed:
echo    set WORKING_DIRECTORY=C:\path\to\your\project
echo.
echo 3. Start the server:
echo    npm start
echo.
echo 4. Or use Docker:
echo    docker-compose up -d
echo.
echo 📖 See README.md for detailed configuration instructions
echo.
pause
