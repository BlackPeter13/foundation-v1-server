#!/bin/bash
set -e  # Exit on any error

# ============================================================
#  foundation-v1-server + Dashboard Installer
#  Ubuntu 20.04 / 22.04
# ============================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

print_green() { echo -e "${GREEN}$1${NC}"; }
print_red() { echo -e "${RED}$1${NC}"; }
print_yellow() { echo -e "${YELLOW}$1${NC}"; }

# ------------------------------------------------------------
# 1. System Update & Prerequisites
# ------------------------------------------------------------
print_green "===> Updating system packages..."
sudo apt update && sudo apt upgrade -y

print_green "===> Installing essential build tools and dependencies..."
sudo apt install -y \
  build-essential \
  curl \
  wget \
  git \
  libssl-dev \
  pkg-config \
  software-properties-common \
  python3 \
  gnupg \
  lsb-release

# ------------------------------------------------------------
# 2. Install Node.js 18.x (LTS)
# ------------------------------------------------------------
print_green "===> Installing Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version
npm --version

# ------------------------------------------------------------
# 3. Install Redis (with TLS support if needed)
# ------------------------------------------------------------
print_green "===> Installing Redis..."
sudo apt install -y redis-server

# Enable and start Redis
sudo systemctl enable redis-server
sudo systemctl start redis-server

# (Optional) Enable Redis TLS – you can uncomment and adapt later
# print_yellow "To enable TLS, edit /etc/redis/redis.conf and restart."

# ------------------------------------------------------------
# 4. Install PM2 globally
# ------------------------------------------------------------
print_green "===> Installing PM2..."
sudo npm install -g pm2

# ------------------------------------------------------------
# 5. Clone or copy the backend (foundation-v1-server)
# ------------------------------------------------------------
print_green "===> Setting up foundation-v1-server..."

# If you already have the code, skip cloning and just copy
if [ ! -d "foundation-v1-server" ]; then
  print_yellow "Cloning foundation-v1-server from GitHub..."
  git clone https://github.com/BlackPeter13/foundation-v1-server.git
else
  print_yellow "foundation-v1-server directory already exists. Skipping clone."
fi

cd foundation-v1-server

# Install backend dependencies
print_green "===> Installing backend npm dependencies..."
npm install

# Create certificates directory (for TLS)
mkdir -p certificates

# Create configs directory and sample config if missing
mkdir -p configs/main
if [ ! -f configs/main/config.js ]; then
  print_yellow "Creating default config.js from example..."
  cp configs/main/example.config.js configs/main/config.js || \
    cp configs/portal.example.js configs/main/config.js || \
    echo "// Please create configs/main/config.js manually" > configs/main/config.js
fi

# Create pools config directory
mkdir -p configs/pools

cd ..

# ------------------------------------------------------------
# 6. Clone or copy the frontend (foundation-mining-dashboard)
# ------------------------------------------------------------
print_green "===> Setting up foundation-mining-dashboard..."

# If the user doesn't have a separate repo, we can create from our script
if [ ! -d "foundation-mining-dashboard" ]; then
  print_yellow "Creating foundation-mining-dashboard from provided structure..."
  mkdir -p foundation-mining-dashboard/{public/{css,js/utils},tests}
  cd foundation-mining-dashboard
  # ... (here you would either clone a repo or copy the files we created earlier)
  # For simplicity, we assume you have the files locally or will clone later.
  # We'll provide a clone option:
  # git clone https://github.com/your-username/foundation-mining-dashboard.git .
  # But since we don't have a repo, we'll just create the structure and tell user to add files.
  print_yellow "Please place the frontend files into foundation-mining-dashboard/ manually."
  print_yellow "You can copy from your local machine or create them as described."
else
  print_yellow "foundation-mining-dashboard directory already exists. Skipping."
  cd foundation-mining-dashboard
fi

# Install frontend dependencies
if [ -f package.json ]; then
  print_green "===> Installing frontend npm dependencies..."
  npm install
else
  print_red "No package.json found in foundation-mining-dashboard. Please add the frontend files."
fi

cd ..

# ------------------------------------------------------------
# 7. Environment Configuration
# ------------------------------------------------------------
print_green "===> Setting up environment files..."

# Backend: config.js editing hint
print_yellow "Edit backend config at foundation-v1-server/configs/main/config.js"
print_yellow " - Set Redis host/port, server port, etc."
print_yellow " - Add your pool configs in configs/pools/*.js"

# Frontend: create .env from example
if [ -f foundation-mining-dashboard/.env.example ] && [ ! -f foundation-mining-dashboard/.env ]; then
  cp foundation-mining-dashboard/.env.example foundation-mining-dashboard/.env
  print_yellow "Edit foundation-mining-dashboard/.env and set API_BASE_URL to your backend address."
fi

# ------------------------------------------------------------
# 8. Start Services with PM2
# ------------------------------------------------------------
print_green "===> Starting services with PM2..."

# Start backend (assuming main entry is scripts/main.js)
cd foundation-v1-server
pm2 start scripts/main.js --name foundation-server
cd ..

# Start frontend (if server.js exists)
if [ -f foundation-mining-dashboard/server.js ]; then
  cd foundation-mining-dashboard
  pm2 start server.js --name mining-dashboard
  cd ..
fi

# Save PM2 process list
pm2 save
pm2 startup systemd -u $USER --hp $HOME

# ------------------------------------------------------------
# 9. Final Instructions
# ------------------------------------------------------------
print_green "=================================================="
print_green " Installation completed successfully!"
print_green "=================================================="
echo ""
print_yellow "Next steps:"
echo "1. Configure your pool(s) in foundation-v1-server/configs/pools/"
echo "2. Update foundation-v1-server/configs/main/config.js with your Redis and server settings."
echo "3. If you used TLS, place certificates in foundation-v1-server/certificates/."
echo "4. For the frontend, edit foundation-mining-dashboard/.env to point to your backend API."
echo "5. Restart services with: pm2 restart all"
echo "6. Check logs with: pm2 logs"
echo ""
print_yellow "Access the dashboard at http://$(hostname -I | awk '{print $1}'):8080 (or your configured port)"
echo ""
print_green "Happy mining! ⛏️"
