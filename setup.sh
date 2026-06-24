#!/bin/bash
# foundation-v1-server setup – Node.js 14 with npm v7, C++14 for native addon
# Run with: sudo ./setup.sh
# For CI: set SKIP_CLONE=true and APP_DIR="$PWD"

set -euo pipefail

# ---------- Configuration ----------
REPO_URL="https://github.com/BlackPeter13/foundation-v1-server.git"
BRANCH="master"
REDIS_MAXCLIENTS=10000
REDIS_TCP_KEEPALIVE=60

# Node.js version (binary tarball) – v14 LTS (compatible with the addon)
NODE_VERSION="14.21.3"
NODE_DISTRO="linux-x64"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"

# ---------- Determine the real user ----------
if [ -n "${SUDO_USER:-}" ]; then
    REAL_USER="$SUDO_USER"
    REAL_HOME=$(eval echo ~"$REAL_USER")
else
    REAL_USER=$(whoami)
    REAL_HOME="$HOME"
fi

if [ -z "${APP_DIR:-}" ]; then
    APP_DIR="$REAL_HOME/Desktop/foundation-v1-server"
fi

# Ensure PATH includes /usr/local/bin (where Node will be installed)
export PATH="/usr/local/bin:$PATH"

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

# ---------- System packages ----------
log_info "Updating system packages..."
sudo apt update && sudo apt upgrade -y

log_info "Installing required system packages..."
sudo apt install -y git curl wget build-essential tcl \
    libsodium-dev libboost-system-dev xz-utils

# ---------- Create 16GB swap file ----------
log_info "Checking for existing swap..."
if swapon --show | grep -q "^/swapfile"; then
    log_info "Swap already exists, skipping."
else
    log_info "Creating 16GB swap file..."
    sudo fallocate -l 16G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    log_info "Swap enabled."
fi

# ---------- Install Node.js from binary tarball ----------
log_info "Installing Node.js ${NODE_VERSION} from official binary..."
cd /tmp
wget -q "$NODE_URL"
sudo tar -xJf "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz" -C /usr/local --strip-components=1
rm "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"

node_version=$(node -v)
log_info "Node version: $node_version"
npm_version=$(npm -v)
log_info "npm version (old): $npm_version"

# ---------- UPGRADE npm to v7 (fixes broken npm 6) ----------
log_info "Upgrading npm to v7 (compatible with Node 14)..."
sudo env PATH="$PATH" npm install -g npm@7.24.2
npm_version=$(npm -v)
log_info "npm version (new): $npm_version"

# ---------- Install PM2 & nodemon globally ----------
log_info "Installing PM2 and nodemon globally..."
sudo env PATH="$PATH" npm install -g pm2 nodemon

# Verify PM2 is installed
if command -v pm2 &> /dev/null; then
    log_info "PM2 installed successfully: $(pm2 --version)"
else
    log_error "PM2 not found after installation. Check PATH."
fi

# ---------- PM2 log rotation ----------
log_info "Installing and configuring PM2 log rotation..."
sudo env PATH="$PATH" pm2 install pm2-logrotate
sudo env PATH="$PATH" pm2 set pm2-logrotate:max_size 100M
sudo env PATH="$PATH" pm2 set pm2-logrotate:retain 7
sudo env PATH="$PATH" pm2 set pm2-logrotate:compress true
sudo env PATH="$PATH" pm2 set pm2-logrotate:dateFormat "YYYY-MM-DD_HH-mm-ss"

# ---------- Redis ----------
log_info "Installing Redis..."
sudo apt install -y redis-server

log_info "Optimising Redis system configuration..."
REDIS_CONF="/etc/redis/redis.conf"
sudo cp "$REDIS_CONF" "$REDIS_CONF.bak"

sudo sed -i "s/^# maxclients .*/maxclients ${REDIS_MAXCLIENTS}/" "$REDIS_CONF"
sudo sed -i "s/^maxclients .*/maxclients ${REDIS_MAXCLIENTS}/" "$REDIS_CONF"
sudo sed -i "s/^# tcp-keepalive .*/tcp-keepalive ${REDIS_TCP_KEEPALIVE}/" "$REDIS_CONF"
sudo sed -i "s/^tcp-keepalive .*/tcp-keepalive ${REDIS_TCP_KEEPALIVE}/" "$REDIS_CONF"
sudo sed -i "s/^timeout .*/timeout 0/" "$REDIS_CONF"
sudo sed -i "s/^# tcp-backlog .*/tcp-backlog 511/" "$REDIS_CONF"
sudo sed -i "s/^tcp-backlog .*/tcp-backlog 511/" "$REDIS_CONF"
sudo sed -i "s/^# save .*/save \"\"/" "$REDIS_CONF"
sudo sed -i "s/^appendonly .*/appendonly no/" "$REDIS_CONF"
sudo sed -i "s/^# maxmemory .*/maxmemory 2gb/" "$REDIS_CONF"
sudo sed -i "s/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/" "$REDIS_CONF"
sudo sed -i "s/^# client-output-buffer-limit normal .*/client-output-buffer-limit normal 0 0 0/" "$REDIS_CONF"
sudo sed -i "s/^# client-output-buffer-limit pubsub .*/client-output-buffer-limit pubsub 32mb 8mb 60/" "$REDIS_CONF"

sudo systemctl restart redis-server
sudo systemctl enable redis-server

# ---------- Clone repository (unless SKIP_CLONE=true) ----------
if [ "${SKIP_CLONE:-false}" != "true" ]; then
    log_info "Cloning repository into ${APP_DIR}..."
    if [ -d "$APP_DIR" ]; then
        log_warn "$APP_DIR already exists. Removing..."
        rm -rf "$APP_DIR"
    fi
    sudo -u "$REAL_USER" git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
else
    log_info "Skipping clone (SKIP_CLONE=true) – using existing code at $APP_DIR"
    if [ ! -d "$APP_DIR" ]; then
        log_error "APP_DIR ($APP_DIR) does not exist, but SKIP_CLONE is true. Aborting."
    fi
fi

# ---------- Install dependencies with C++14 flag ----------
log_info "Installing npm dependencies (forcing C++14 for native addon)..."
cd "$APP_DIR"
export CXXFLAGS="-std=c++14"
sudo -u "$REAL_USER" env PATH="$PATH" CXXFLAGS="$CXXFLAGS" npm install --production

# ---------- Configuration handling (DO NOT copy example.js) ----------
CONFIG_DIR="$APP_DIR/configs/main"
if [ -f "$CONFIG_DIR/example.js" ]; then
    log_info "Example config available at $CONFIG_DIR/example.js – copy it manually if needed."
    log_info "Pool configs are loaded from $APP_DIR/configs/pools/ – add your coin JSON/JS files there."
else
    log_warn "No example.js found – ensure you have a valid config structure."
fi

# ---------- Patch database.js (retry + max listeners) ----------
PATCH_FILE="$APP_DIR/scripts/main/database.js"
if [ -f "$PATCH_FILE" ]; then
    log_info "Applying Redis connection optimisation + MaxListeners fix..."

    sudo -u "$REAL_USER" cp "$PATCH_FILE" "$PATCH_FILE.bak"

    sudo -u "$REAL_USER" sed -i '/return redis\.createClient(connectionOptions);/i \
        // --- Optimised Redis connection settings ---\
        connectionOptions.retry_strategy = function(options) {\
            if (options.error && options.error.code === "ECONNREFUSED") {\
                console.error("Redis connection refused. Retrying...");\
                return 5000;\
            }\
            if (options.total_retry_time > 60000) {\
                console.error("Redis retry time exhausted.");\
                return new Error("Redis retry time exhausted");\
            }\
            if (options.attempt > 10) {\
                console.error("Redis max retry attempts reached.");\
                return new Error("Redis max retry attempts reached");\
            }\
            return Math.min(options.attempt * 100, 3000);\
        };\
        connectionOptions.socket_keepalive = true;\
        connectionOptions.socket_keepalive_initial_delay = 30000;\
        // --- End optimised settings ---' "$PATCH_FILE"

    sudo -u "$REAL_USER" sed -i 's/^\(\s*\)return redis\.createClient(connectionOptions);/\1const client = redis.createClient(connectionOptions);\n\1client.setMaxListeners(0);\n\1return client;/' "$PATCH_FILE"

    log_info "Patch applied successfully."
else
    log_warn "database.js not found; skipping patch."
fi

# ---------- Start with PM2 ----------
log_info "Starting server with PM2..."
cd "$APP_DIR"
sudo -u "$REAL_USER" env PATH="$PATH" pm2 start scripts/main.js --name foundation-server
sudo -u "$REAL_USER" env PATH="$PATH" pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$REAL_USER" --hp "$REAL_HOME" || true

log_info "Setup complete!"
log_info "--------------------------------------------------"
log_info "Installation directory: $APP_DIR"
log_info "Main config template:   $CONFIG_DIR/example.js (copy manually if needed)"
log_info "Pool configs go in:     $APP_DIR/configs/pools/"
log_info ""
log_info "Next steps:"
log_info "1. To set up main config, copy example.js to config.js and edit it."
log_info "2. Add pool configs (JSON/JS) to $APP_DIR/configs/pools/"
log_info "3. Restart after changes: pm2 restart foundation-server"
log_info "4. View logs: pm2 logs foundation-server"
log_info "5. Swap file (16GB) is active."
log_info "6. Redis tuned for performance; PM2 logs rotate at 100MB, keep 7 files."
log_info "--------------------------------------------------"
