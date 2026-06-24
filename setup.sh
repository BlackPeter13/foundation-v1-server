#!/bin/bash
# foundation-v1-server setup – installs to ~/Desktop with full Redis optimisation
# Run with: sudo ./setup.sh

set -euo pipefail

# ---------- Configuration ----------
REPO_URL="https://github.com/BlackPeter13/foundation-v1-server.git"
BRANCH="master"
REDIS_MAXCLIENTS=10000
REDIS_TCP_KEEPALIVE=60
NODE_VERSION="18"

# ---------- Determine the real user ----------
if [ -n "${SUDO_USER:-}" ]; then
    REAL_USER="$SUDO_USER"
    REAL_HOME=$(eval echo ~"$REAL_USER")
else
    REAL_USER=$(whoami)
    REAL_HOME="$HOME"
fi
APP_DIR="$REAL_HOME/Desktop/foundation-v1-server"

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

# ---------- System packages ----------
log_info "Updating system packages..."
sudo apt update && sudo apt upgrade -y

log_info "Installing required system packages..."
sudo apt install -y git curl wget build-essential tcl

# ---------- Node.js ----------
log_info "Installing Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2 nodemon

# ---------- Redis (with tuning) ----------
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

sudo systemctl restart redis-server
sudo systemctl enable redis-server

# ---------- Clone repository ----------
log_info "Cloning repository into ${APP_DIR}..."
if [ -d "$APP_DIR" ]; then
    log_warn "$APP_DIR already exists. Removing..."
    rm -rf "$APP_DIR"
fi
sudo -u "$REAL_USER" git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"

# ---------- Install dependencies ----------
log_info "Installing npm dependencies..."
cd "$APP_DIR"
sudo -u "$REAL_USER" npm install --production

# ---------- Create config from example ----------
CONFIG_DIR="$APP_DIR/configs/main"
if [ ! -f "$CONFIG_DIR/config.js" ]; then
    log_info "Copying example config to config.js..."
    sudo -u "$REAL_USER" cp "$CONFIG_DIR/example.js" "$CONFIG_DIR/config.js"
    log_warn "Default config created at $CONFIG_DIR/config.js – please edit it."
else
    log_info "Config already exists, skipping."
fi

# ---------- Patch database.js ----------
PATCH_FILE="$APP_DIR/scripts/main/database.js"
if [ -f "$PATCH_FILE" ]; then
    log_info "Applying Redis connection optimisation + MaxListeners fix..."

    # Backup
    sudo -u "$REAL_USER" cp "$PATCH_FILE" "$PATCH_FILE.bak"

    # 1. Insert retry_strategy and socket_keepalive into connectionOptions
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

    # 2. Replace the return line with a block that sets max listeners
    #    (preserves leading indentation)
    sudo -u "$REAL_USER" sed -i 's/^\(\s*\)return redis\.createClient(connectionOptions);/\1const client = redis.createClient(connectionOptions);\n\1client.setMaxListeners(0);\n\1return client;/' "$PATCH_FILE"

    log_info "Patch applied successfully (MaxListeners set to 0)."
else
    log_warn "database.js not found; skipping patch."
fi

# ---------- Start with PM2 ----------
log_info "Starting server with PM2..."
cd "$APP_DIR"
sudo -u "$REAL_USER" pm2 start scripts/main.js --name foundation-server
sudo -u "$REAL_USER" pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$REAL_USER" --hp "$REAL_HOME" || true

log_info "Setup complete!"
log_info "--------------------------------------------------"
log_info "Installation directory: $APP_DIR"
log_info "Main config:           $CONFIG_DIR/config.js"
log_info "Pool configs:          $APP_DIR/configs/pools/"
log_info ""
log_info "Next steps:"
log_info "1. Edit $CONFIG_DIR/config.js (Redis host/port/password)."
log_info "2. Place TLS certificates in $APP_DIR/certificates/ if needed."
log_info "3. Restart after config changes:"
log_info "     pm2 restart foundation-server"
log_info "4. View logs:"
log_info "     pm2 logs foundation-server"
log_info "--------------------------------------------------"
