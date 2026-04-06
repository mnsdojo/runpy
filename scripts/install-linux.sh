#!/usr/bin/env bash

# RunPy - Linux Installation Script (Curl-Ready)
# This script installs system dependencies, Rust, and then builds the app.

set -e

APP_NAME="RunPy"
REPO_URL="https://github.com/mnsdojo/runpy"
WORK_DIR="$(pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting $APP_NAME Installation for Linux...${NC}"

# --- Check if we are inside the repo ---
if [[ ! -f "src-tauri/tauri.conf.json" ]]; then
    echo -e "${BLUE}Not in repository folder. Cloning $APP_NAME to /tmp/runpy-install...${NC}"
    rm -rf /tmp/runpy-install
    git clone $REPO_URL /tmp/runpy-install
    cd /tmp/runpy-install
    WORK_DIR="/tmp/runpy-install"
fi

# --- System Dependencies (Debian/Ubuntu) ---
echo -e "${BLUE}Checking for system dependencies...${NC}"
if command -v apt-get &> /dev/null; then
    # Ignore update errors (often due to unrelated broken repos)
    sudo apt-get update || true
    sudo apt-get install -y \
        libwebkit2gtk-4.1-dev \
        build-essential \
        curl \
        wget \
        file \
        libssl-dev \
        libgtk-3-dev \
        libayatana-indicator3-dev \
        librsvg2-dev \
        python3 \
        python3-pip \
        nodejs \
        npm \
        git
else
    echo -e "${RED}Warning: Package manager not recognized. Please ensure all Tauri dependencies are installed.${NC}"
fi

# --- Install Rust (if not present) ---
if ! command -v rustc &> /dev/null; then
    echo -e "${BLUE}Installing Rust...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
else
    echo -e "${GREEN}Rust is already installed.${NC}"
fi

# --- Install Node dependencies ---
echo -e "${BLUE}Installing frontend dependencies...${NC}"
npm install

# --- Build the App ---
echo -e "${BLUE}Building $APP_NAME (Debian package only)...${NC}"
npm run tauri build -- --bundle deb

# --- Locate and Install the .deb package ---
DEB_PACKAGE=$(find src-tauri/target/release/bundle/deb -name "*.deb" | head -n 1)

if [[ -f "$DEB_PACKAGE" ]]; then
    echo -e "${BLUE}Installing $APP_NAME via dpkg...${NC}"
    sudo dpkg -i "$DEB_PACKAGE"
    sudo apt-get install -f # Fix missing dependencies if any
    echo -e "${GREEN}Installation successful! You can now find $APP_NAME in your application menu.${NC}"
else
    echo -e "${RED}Error: Could not find build artifact (.deb package). Build might have failed.${NC}"
    exit 1
fi

echo -e "${GREEN}RunPy has been successfully installed!${NC}"
