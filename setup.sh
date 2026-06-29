#!/bin/bash
# foundation-v1-server setup – Node.js 14 + npm v7 + optimized stratum
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

# Stratum version to use – change to a tag or commit SHA if you prefer.
# Default: master branch (latest commit)
STRATUM_REPO="https://github.com/BlackPeter13/foundation-v1-stratum.git"
STRATUM_VERSION="master"   # or use "v0.1.0" once the tag exists

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

export PATH="/usr/local/bin:$PATH"

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

# ---------- System packages ----------
log_info "Updating system packages..."
sudo apt update && sudo apt upgrade -y

log_info "Installing required system packages..."
sudo apt install -y git curl wget build-essential tcl \
    libsodium-dev libboost-system-dev xz-utils jq   # added jq for JSON manipulation

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

# ---------- CLEAN INSTALL npm v7 ----------
log_info "Removing old npm and installing v7.24.2..."
sudo rm -rf /usr/local/lib/node_modules/npm
sudo rm -f /usr/local/bin/npm /usr/local/bin/npx

cd /tmp
curl -L https://registry.npmjs.org/npm/-/npm-7.24.2.tgz -o npm-7.24.2.tgz
sudo mkdir -p /usr/local/lib/node_modules/npm
sudo tar -xzf npm-7.24.2.tgz -C /usr/local/lib/node_modules/npm --strip-components=1
rm npm-7.24.2.tgz

sudo ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
sudo ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

npm_version=$(npm -v)
log_info "npm version (new): $npm_version"

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

# ---------- Create .gitignore ----------
log_info "Creating .gitignore file..."
sudo -u "$REAL_USER" cat > "$APP_DIR/.gitignore" << 'EOF'
# Dependencies
node_modules/

# IDE
.idea/

# Logs
npm-debug.log

# Local config (sensitive data)
config.json

# Configs – ignore everything except example files
configs/main/*
!configs/main/example.js

configs/pools/*
!configs/pools/example.js

# Certificates – ignore everything except README
certificates/*
!certificates/README.md

# Test coverage
coverage/

# macOS metadata
.DS_Store
EOF

# ---------- Create .eslintrc.js ----------
log_info "Creating .eslintrc.js configuration file..."
sudo -u "$REAL_USER" cat > "$APP_DIR/.eslintrc.js" << 'EOF'
module.exports = {
  'env': {
    'browser': true,
    'node': true,
    'jest': true,
    'es2021': true
  },
  'extends': 'eslint:recommended',
  'parserOptions': {
    'ecmaVersion': 12,
    'sourceType': 'module'
  },
  'rules': {
    'no-var': 2,
    'semi': [2, 'always'],
    'indent': ['error', 2],
    'no-multi-spaces': 2,
    'space-in-parens': 2,
    'quotes': [2, 'single'],
    'brace-style': [2, '1tbs'],
    'no-multiple-empty-lines': 2,
    'prefer-const': 2,
    'prefer-arrow-callback': 2,
    'no-use-before-define': 2
  }
};
EOF

# ---------- UPDATE PACKAGE.JSON to use optimized stratum ----------
log_info "Updating server's package.json to use optimized stratum..."
cd "$APP_DIR"
PKG_FILE="$APP_DIR/package.json"

# Backup original
sudo -u "$REAL_USER" cp "$PKG_FILE" "$PKG_FILE.bak"

# Use jq to modify package.json (adds stratum, chokidar, and other required deps)
if command -v jq &> /dev/null; then
    # Update stratum dependency
    sudo -u "$REAL_USER" jq --arg url "$STRATUM_REPO#$STRATUM_VERSION" \
        '.dependencies["foundation-stratum"] = $url' "$PKG_FILE" > "$PKG_FILE.tmp" && mv "$PKG_FILE.tmp" "$PKG_FILE"

    # Add chokidar (CommonJS compatible version) and other required deps if missing
    sudo -u "$REAL_USER" jq '.dependencies["chokidar"] = "^3.5.3"' "$PKG_FILE" > "$PKG_FILE.tmp" && mv "$PKG_FILE.tmp" "$PKG_FILE"
    # Ensure express, cors, redis are present (if not already)
    sudo -u "$REAL_USER" jq '.dependencies["express"] = "^4.18.2"' "$PKG_FILE" > "$PKG_FILE.tmp" && mv "$PKG_FILE.tmp" "$PKG_FILE"
    sudo -u "$REAL_USER" jq '.dependencies["cors"] = "^2.8.5"' "$PKG_FILE" > "$PKG_FILE.tmp" && mv "$PKG_FILE.tmp" "$PKG_FILE"
    sudo -u "$REAL_USER" jq '.dependencies["redis"] = "^4.7.0"' "$PKG_FILE" > "$PKG_FILE.tmp" && mv "$PKG_FILE.tmp" "$PKG_FILE"

    log_info "package.json updated with jq"
else
    # Fallback to sed – more complex but works (we'll just add minimal changes)
    sudo -u "$REAL_USER" sed -i \
        's|"foundation-stratum": "[^"]*"|"foundation-stratum": "git+'"$STRATUM_REPO"'#'"$STRATUM_VERSION"'"|' \
        "$PKG_FILE"
    # Add chokidar by inserting a new dependency line after the first dependency
    sudo -u "$REAL_USER" sed -i '/"dependencies": {/a \    "chokidar": "^3.5.3",' "$PKG_FILE"
    # Ensure express, cors, redis are present
    grep -q '"express"' "$PKG_FILE" || sudo -u "$REAL_USER" sed -i '/"dependencies": {/a \    "express": "^4.18.2",' "$PKG_FILE"
    grep -q '"cors"' "$PKG_FILE" || sudo -u "$REAL_USER" sed -i '/"dependencies": {/a \    "cors": "^2.8.5",' "$PKG_FILE"
    grep -q '"redis"' "$PKG_FILE" || sudo -u "$REAL_USER" sed -i '/"dependencies": {/a \    "redis": "^4.7.0",' "$PKG_FILE"
    log_info "package.json updated with sed (basic)"
fi

log_info "Updated dependency: foundation-stratum -> $STRATUM_REPO#$STRATUM_VERSION"
log_info "Added chokidar (CommonJS) and other required deps."

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

# ---------- Create systemd service ----------
log_info "Creating systemd service for Foundation pool..."

SERVICE_FILE="/etc/systemd/system/foundation-server.service"
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Foundation Mining Pool
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/node $APP_DIR/scripts/main.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable foundation-server
sudo systemctl start foundation-server

log_info "Systemd service started successfully."

log_info "Setup complete!"
log_info "--------------------------------------------------"
log_info "Installation directory: $APP_DIR"
log_info "Main config template:   $CONFIG_DIR/example.js (copy manually if needed)"
log_info "Pool configs go in:     $APP_DIR/configs/pools/"
log_info ""
log_info "Next steps:"
log_info "1. To set up main config, copy example.js to config.js and edit it."
log_info "2. Add pool configs (JSON/JS) to $APP_DIR/configs/pools/"
log_info "3. The pool will automatically restart when you edit/add pool configs (chokidar watches)."
log_info "4. View logs: sudo journalctl -u foundation-server -f"
log_info "5. Swap file (16GB) is active."
log_info "6. Redis tuned for performance."
log_info "7. Stratum module is now the optimized version from $STRATUM_REPO#$STRATUM_VERSION."
log_info "8. .gitignore, .eslintrc.js, and required npm deps (chokidar, express, cors, redis) have been added."
log_info "--------------------------------------------------"
