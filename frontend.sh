#!/bin/bash
# frontend-simple.sh – creates and runs a simple pool dashboard
# Usage: ./frontend-simple.sh [--clean]

set -euo pipefail

# ---------- Configuration ----------
DASHBOARD_DIR="$HOME/Desktop/foundation-mining-dashboard"
NODE_VERSION="18.20.8"
NODE_DISTRO="linux-x64"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"
NODE_INSTALL_DIR="/opt/nodejs-18"
CLEAN_INSTALL=false

for arg in "$@"; do
  case $arg in
    --clean|-c) CLEAN_INSTALL=true ;;
  esac
done

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

clean_old_installation() {
  log_info "Performing clean installation..."
  if command -v pm2 &> /dev/null && pm2 list | grep -q "mining-dashboard"; then
    pm2 stop mining-dashboard 2>/dev/null || true
    pm2 delete mining-dashboard 2>/dev/null || true
  fi
  pkill -f "node.*$DASHBOARD_DIR.*server.js" 2>/dev/null || true
  rm -rf "$DASHBOARD_DIR" 2>/dev/null || true
  sudo rm -rf "$NODE_INSTALL_DIR" 2>/dev/null || true
  log_info "Clean installation preparation complete."
}

install_nodejs18() {
  if [ -d "$NODE_INSTALL_DIR/bin" ]; then
    log_info "Node.js 18 already installed"
    return
  fi
  log_info "Installing Node.js ${NODE_VERSION}..."
  sudo mkdir -p "$NODE_INSTALL_DIR"
  cd /tmp
  wget -q "$NODE_URL"
  sudo tar -xJf "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz" -C "$NODE_INSTALL_DIR" --strip-components=1
  rm "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"
  if [ -x "$NODE_INSTALL_DIR/bin/node" ]; then
    log_info "Node.js installed: $($NODE_INSTALL_DIR/bin/node -v)"
  else
    log_error "Node.js installation failed."
  fi
}

start_dashboard() {
  cd "$DASHBOARD_DIR"
  log_info "Starting dashboard..."
  NODE_BIN="$NODE_INSTALL_DIR/bin/node"
  if command -v pm2 &> /dev/null; then
    sudo -E env "PATH=$NODE_INSTALL_DIR/bin:$PATH" pm2 start $NODE_BIN server.js --name mining-dashboard --interpreter $NODE_BIN
  else
    nohup $NODE_BIN server.js > dashboard.log 2>&1 &
  fi
}

show_url() {
  IP=$(hostname -I | awk '{print $1}')
  if [ -z "$IP" ]; then
    IP="localhost"
  fi
  echo ""
  log_info "Dashboard: http://$IP:8080"
}

main() {
  if [ "$CLEAN_INSTALL" = true ]; then
    clean_old_installation
  else
    if [ -d "$DASHBOARD_DIR" ]; then
      echo ""
      log_warn "Existing dashboard found. Remove it? (yes/no): "
      read -r REMOVE_OLD
      if [[ "$REMOVE_OLD" =~ ^[Yy](es)?$ ]]; then
        clean_old_installation
      fi
    fi
  fi

  install_nodejs18

  log_info "Creating dashboard at $DASHBOARD_DIR"
  mkdir -p "$DASHBOARD_DIR"/public
  cd "$DASHBOARD_DIR"

  # Simple server.js – serves static files and a health endpoint
  cat > server.js << 'SERVEOF'
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 8080;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(port, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${port}`);
});
SERVEOF

  # The main HTML page – fetches all pools and displays stats
  cat > public/index.html << 'HTMLEOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mining Pool Dashboard</title>
  <style>
    body { font-family: 'Courier New', monospace; background: #0d0d0d; color: #00ff41; padding: 20px; }
    h1 { text-shadow: 0 0 10px #00ff41; border-bottom: 2px solid #00ff41; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #00ff41; padding: 8px 12px; text-align: left; }
    th { background: #1a1a1a; text-transform: uppercase; letter-spacing: 2px; }
    tr:nth-child(even) { background: #0a0a0a; }
    tr:hover { background: #1a2a1a; }
    .hashrate { color: #2ecc71; }
    .error { color: #ff4444; }
    .footer { margin-top: 20px; font-size: 0.8rem; color: #666; }
    .refresh { cursor: pointer; color: #00ff41; text-decoration: underline; }
    .refresh:hover { color: #fff; }
    .status { margin: 10px 0; }
  </style>
</head>
<body>
  <h1>⚡ Foundation Pool Dashboard</h1>
  <div id="status" class="status">Loading pool list…</div>
  <div id="content"></div>
  <div class="footer">
    Auto‑refresh every 30 seconds &nbsp;|&nbsp; <span class="refresh" onclick="fetchData()">⟳ Refresh now</span>
  </div>

  <script>
    const API_BASE = 'http://localhost:3001/api/v1';

    async function fetchData() {
      const status = document.getElementById('status');
      const content = document.getElementById('content');
      status.textContent = 'Fetching pool list…';
      content.innerHTML = '';

      try {
        // 1. Get pool list
        const poolRes = await fetch(`${API_BASE}/pools`);
        if (!poolRes.ok) throw new Error(`HTTP ${poolRes.status} – ${poolRes.statusText}`);
        const pools = await poolRes.json();
        if (!Array.isArray(pools) || pools.length === 0) {
          status.textContent = '⚠️ No pools found.';
          content.innerHTML = '<p>No pools are defined on the backend.</p>';
          return;
        }

        status.textContent = `Fetching data for ${pools.length} pool(s)…`;

        // 2. Fetch stats for each pool
        const statsPromises = pools.map(async (pool) => {
          try {
            const res = await fetch(`${API_BASE}/${pool}/`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { pool, data: data.primary || data.body?.primary || {} };
          } catch (err) {
            return { pool, error: err.message };
          }
        });

        const results = await Promise.all(statsPromises);

        // 3. Build table
        let html = `<table>
          <thead>
            <tr>
              <th>Pool</th>
              <th>Hashrate (MH/s)</th>
              <th>Miners</th>
              <th>Workers</th>
              <th>Valid Blocks</th>
              <th>Network Difficulty</th>
              <th>Block Height</th>
            </tr>
          </thead>
          <tbody>`;

        let hasData = false;
        for (const result of results) {
          if (result.error) {
            html += `<tr><td>${result.pool}</td><td colspan="6" class="error">⚠️ ${result.error}</td></tr>`;
            continue;
          }
          const p = result.data;
          const hashrate = p.hashrate || { shared: 0, solo: 0 };
          const totalHash = (hashrate.shared || 0) + (hashrate.solo || 0);
          const blocks = p.blocks || { valid: 0 };
          const network = p.network || { difficulty: 'N/A', height: 'N/A' };
          const statusObj = p.status || { miners: 0, workers: 0 };
          html += `<tr>
            <td><strong>${result.pool}</strong></td>
            <td class="hashrate">${totalHash.toFixed(2)}</td>
            <td>${statusObj.miners || 0}</td>
            <td>${statusObj.workers || 0}</td>
            <td>${blocks.valid || 0}</td>
            <td>${typeof network.difficulty === 'number' ? network.difficulty.toFixed(2) : network.difficulty}</td>
            <td>${network.height || 'N/A'}</td>
          </tr>`;
          hasData = true;
        }

        html += `</tbody></table>`;
        if (!hasData) html = '<p>No pool data received.</p>';
        content.innerHTML = html;
        status.textContent = `✅ Updated at ${new Date().toLocaleTimeString()} (${pools.length} pools)`;
      } catch (err) {
        status.textContent = `❌ Error: ${err.message}`;
        content.innerHTML = `<p class="error">Failed to load data. Please check the backend.</p>`;
        console.error(err);
      }
    }

    // Auto‑refresh every 30 seconds
    fetchData();
    setInterval(fetchData, 30000);
  </script>
</body>
</html>
HTMLEOF

  # Write a simple package.json (only express as dependency)
  cat > package.json << 'PKGEOF'
{
  "name": "foundation-mining-dashboard",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.18.2"
  }
}
PKGEOF

  log_info "Installing npm dependencies (using isolated Node.js 18)..."
  $NODE_INSTALL_DIR/bin/node $NODE_INSTALL_DIR/bin/npm install

  log_info "Starting dashboard..."
  start_dashboard
  show_url
  echo ""
  log_info "Dashboard ready – open your browser."
  log_info "The page shows all pools in a single table and auto‑refreshes every 30 seconds."
}

main
