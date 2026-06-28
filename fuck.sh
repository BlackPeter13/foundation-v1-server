#!/bin/bash
# uninstall.sh – Remove foundation-v1-server and related components
# Run with: sudo ./uninstall.sh

set -euo pipefail

# Colors
log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

# Detect the user who ran sudo
if [ -n "${SUDO_USER:-}" ]; then
    REAL_USER="$SUDO_USER"
    REAL_HOME=$(eval echo ~"$REAL_USER")
else
    REAL_USER=$(whoami)
    REAL_HOME="$HOME"
fi

APP_DIR="$REAL_HOME/Desktop/foundation-v1-server"
DASHBOARD_DIR="$REAL_HOME/Desktop/foundation-mining-dashboard"

echo ""
log_warn "This script will remove the Foundation pool installation and related components."
echo "It will stop and remove:"
echo "  - systemd service: foundation-server.service"
echo "  - PM2 processes: foundation-server, mining-dashboard (if any)"
echo "  - Repository directory: $APP_DIR"
echo "  - Dashboard directory: $DASHBOARD_DIR"
echo "  - Isolated Node.js 18 installation in /opt/nodejs-18 (if present)"
echo "  - Any globally installed npm packages (pm2, nodemon) from /usr/local"
echo ""
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    log_info "Uninstall cancelled."
    exit 0
fi

# -----------------------------------------------------------------------------
# 1. Stop and disable systemd service
# -----------------------------------------------------------------------------
if systemctl list-units --full --all | grep -q "foundation-server.service"; then
    log_info "Stopping foundation-server.service..."
    sudo systemctl stop foundation-server.service 2>/dev/null || true
    sudo systemctl disable foundation-server.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/foundation-server.service
    sudo systemctl daemon-reload
    log_info "Removed systemd service."
else
    log_warn "foundation-server.service not found."
fi

# -----------------------------------------------------------------------------
# 2. Kill PM2 processes and remove PM2 if installed globally
# -----------------------------------------------------------------------------
if command -v pm2 &> /dev/null; then
    log_info "Stopping PM2 processes..."
    # Stop specific processes if they exist
    if pm2 list | grep -q "foundation-server"; then
        pm2 stop foundation-server 2>/dev/null || true
        pm2 delete foundation-server 2>/dev/null || true
    fi
    if pm2 list | grep -q "mining-dashboard"; then
        pm2 stop mining-dashboard 2>/dev/null || true
        pm2 delete mining-dashboard 2>/dev/null || true
    fi
    pm2 save --force 2>/dev/null || true
    log_info "PM2 processes removed."
else
    log_warn "PM2 not found."
fi

# -----------------------------------------------------------------------------
# 3. Remove the isolated Node.js 18 installation (if it exists)
# -----------------------------------------------------------------------------
if [ -d "/opt/nodejs-18" ]; then
    log_info "Removing isolated Node.js 18 from /opt/nodejs-18..."
    sudo rm -rf /opt/nodejs-18
    log_info "Removed /opt/nodejs-18."
else
    log_warn "Isolated Node.js 18 not found in /opt/nodejs-18."
fi

# -----------------------------------------------------------------------------
# 4. Remove globally installed npm packages (pm2, nodemon) from /usr/local
#    This is optional – we'll ask if the user wants to keep them.
# -----------------------------------------------------------------------------
read -p "Remove globally installed npm packages (pm2, nodemon) from /usr/local? (yes/no): " REMOVE_GLOBAL
if [ "$REMOVE_GLOBAL" = "yes" ]; then
    if command -v npm &> /dev/null; then
        log_info "Removing global packages..."
        sudo npm uninstall -g pm2 nodemon 2>/dev/null || true
        # Also remove npm symlinks if they were from our manual install
        sudo rm -f /usr/local/bin/npm /usr/local/bin/npx
        # If we installed a separate Node.js in /usr/local, we might want to remove it entirely
        # But we'll skip that to avoid breaking other things.
        log_info "Global packages removed."
    else
        log_warn "npm not found."
    fi
else
    log_info "Skipping removal of global packages."
fi

# -----------------------------------------------------------------------------
# 5. Remove the repository directory (ask)
# -----------------------------------------------------------------------------
read -p "Remove the pool repository directory ($APP_DIR)? (yes/no): " REMOVE_APP
if [ "$REMOVE_APP" = "yes" ]; then
    if [ -d "$APP_DIR" ]; then
        log_info "Removing $APP_DIR..."
        rm -rf "$APP_DIR"
        log_info "Removed repository."
    else
        log_warn "$APP_DIR not found."
    fi
else
    log_info "Skipping removal of repository."
fi

# -----------------------------------------------------------------------------
# 6. Remove the dashboard directory (ask)
# -----------------------------------------------------------------------------
read -p "Remove the dashboard directory ($DASHBOARD_DIR)? (yes/no): " REMOVE_DASH
if [ "$REMOVE_DASH" = "yes" ]; then
    if [ -d "$DASHBOARD_DIR" ]; then
        log_info "Removing $DASHBOARD_DIR..."
        rm -rf "$DASHBOARD_DIR"
        log_info "Removed dashboard."
    else
        log_warn "$DASHBOARD_DIR not found."
    fi
else
    log_info "Skipping removal of dashboard."
fi

# -----------------------------------------------------------------------------
# 7. Optional: Remove Node.js 14 if it was installed by our setup script
#    This is risky because the user might have other Node.js apps.
#    We'll ask.
# -----------------------------------------------------------------------------
read -p "Remove Node.js 14 from /usr/local (this might affect other apps)? (yes/no): " REMOVE_NODE14
if [ "$REMOVE_NODE14" = "yes" ]; then
    # Remove only if it's the version we installed (check for node-v14.21.3)
    if [ -x "/usr/local/bin/node" ] && /usr/local/bin/node -v 2>/dev/null | grep -q "v14.21.3"; then
        log_info "Removing Node.js 14 from /usr/local..."
        sudo rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules
        log_info "Removed Node.js 14 from /usr/local."
    else
        log_warn "Node.js 14 not found at /usr/local/bin/node or version mismatch."
    fi
else
    log_info "Skipping removal of Node.js 14."
fi

log_info "Uninstall completed."
log_info "You may also want to remove the Redis configuration changes if you made any."
log_info "The pool's Redis settings were modified in /etc/redis/redis.conf (backup saved as redis.conf.bak)."
