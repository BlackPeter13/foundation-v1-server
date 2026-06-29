#!/bin/bash
# frontend-simple.sh – full dashboard with payments
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

  # Server.js
  cat > server.js << 'SERVEOF'
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 8080;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(port, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${port}`);
});
SERVEOF

  # Full HTML with stats, blocks, miners, and payments
  cat > public/index.html << 'HTMLEOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ Foundation Pool Dashboard</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #0a0a0a;
      color: #33ff33;
      padding: 20px;
      margin: 0;
      text-shadow: 0 0 5px #33ff33;
    }
    h1 {
      font-size: 2.5rem;
      border-bottom: 2px solid #33ff33;
      padding-bottom: 10px;
      text-shadow: 0 0 15px #33ff33;
      letter-spacing: 4px;
    }
    .status {
      margin: 10px 0;
      font-size: 0.9rem;
      color: #88ff88;
    }
    .refresh {
      cursor: pointer;
      color: #33ff33;
      text-decoration: underline;
    }
    .refresh:hover { color: #ffffff; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 0.85rem;
    }
    th, td {
      border: 1px solid #33ff33;
      padding: 5px 8px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      background: #111;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: normal;
      color: #88ff88;
      white-space: nowrap;
    }
    tr:nth-child(even) { background: #0d0d0d; }
    tr:hover { background: #1a2a1a; }
    .hashrate { color: #2ecc71; font-weight: bold; }
    .error { color: #ff4444; font-weight: bold; }
    .footer {
      margin-top: 30px;
      font-size: 0.8rem;
      color: #666;
      border-top: 1px solid #33ff33;
      padding-top: 15px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    @media (max-width: 768px) {
      h1 { font-size: 1.8rem; }
      table { font-size: 0.7rem; }
    }
  </style>
</head>
<body>
  <h1>⚡ Foundation Pool Dashboard</h1>
  <div id="status" class="status">⏳ Loading pool data…</div>
  <div id="content"></div>
  <div class="footer">
    <span>🔄 Refresh: <span id="intervalDisplay">60</span>s</span>
    <span class="refresh" onclick="fetchData()">⟳ Refresh now</span>
  </div>

  <script>
    const API_BASE = 'http://localhost:3001/api/v1';
    const REFRESH_INTERVAL = 60000; // 60 seconds

    async function fetchData() {
      const status = document.getElementById('status');
      const content = document.getElementById('content');
      status.textContent = '⏳ Fetching pool list…';
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

        status.textContent = `⏳ Fetching data for ${pools.length} pool(s)…`;

        // 2. For each pool, fetch stats, blocks, miners, and payments
        const results = await Promise.all(pools.map(async (pool) => {
          try {
            const [statsRes, blocksRes, minersRes, paymentsRes] = await Promise.all([
              fetch(`${API_BASE}/${pool}/`),
              fetch(`${API_BASE}/${pool}/blocks`),
              fetch(`${API_BASE}/${pool}/miners?method=active`),
              fetch(`${API_BASE}/${pool}/payments`)
            ]);
            if (!statsRes.ok) throw new Error(`Stats HTTP ${statsRes.status}`);
            if (!blocksRes.ok) throw new Error(`Blocks HTTP ${blocksRes.status}`);
            if (!minersRes.ok) throw new Error(`Miners HTTP ${minersRes.status}`);
            if (!paymentsRes.ok) throw new Error(`Payments HTTP ${paymentsRes.status}`);

            const stats = await statsRes.json();
            const blocks = await blocksRes.json();
            const miners = await minersRes.json();
            const payments = await paymentsRes.json();

            return {
              pool,
              stats: stats.primary || stats.body?.primary || {},
              blocks: blocks.primary || blocks.body?.primary || {},
              miners: miners.primary || miners.body?.primary || {},
              payments: payments.primary || payments.body?.primary || {}
            };
          } catch (err) {
            return { pool, error: err.message };
          }
        }));

        // 3. Build table with all columns
        let html = `<table>
          <thead>
            <tr>
              <th>Pool</th>
              <th>Hashrate (MH/s)</th>
              <th>Miners</th>
              <th>Workers</th>
              <th>Valid Blocks</th>
              <th>Pending Blocks</th>
              <th>Shares (V/S/I)</th>
              <th>Network Diff</th>
              <th>Height</th>
              <th>Reward</th>
              <th>Fee</th>
              <th>Payment Interval</th>
              <th>Last Block</th>
              <th>Effort (%)</th>
              <th>Pending Balance</th>
              <th>Total Paid</th>
            </tr>
          </thead>
          <tbody>`;

        let hasData = false;
        for (const r of results) {
          if (r.error) {
            html += `<tr><td>${r.pool}</td><td colspan="15" class="error">⚠️ ${r.error}</td></tr>`;
            continue;
          }
          const s = r.stats;
          const b = r.blocks;
          const p = r.payments;
          const config = s.config || {};
          const hashrate = s.hashrate || { shared: 0, solo: 0 };
          const totalHash = (hashrate.shared || 0) + (hashrate.solo || 0);
          const blocks = s.blocks || { valid: 0 };
          const shares = s.shares || { valid: 0, stale: 0, invalid: 0 };
          const network = s.network || { difficulty: 'N/A', height: 'N/A' };
          const statusObj = s.status || { miners: 0, workers: 0, effort: 0 };
          const reward = config.coinbasevalue || 'N/A';
          const fee = config.recipientFee ? (config.recipientFee * 100).toFixed(2) + '%' : 'N/A';
          const paymentInterval = config.paymentInterval ? (config.paymentInterval / 60).toFixed(0) + ' min' : 'N/A';

          // Pending blocks
          const pendingCount = b.pending ? b.pending.length : 0;

          // Last block
          const confirmed = b.confirmed || [];
          let lastBlock = 'N/A';
          if (confirmed.length > 0) {
            const last = confirmed.sort((a,b) => (b.height||0) - (a.height||0))[0];
            lastBlock = `#${last.height} (${new Date(last.time*1000).toLocaleTimeString()})`;
          }

          // Effort
          const effort = statusObj.effort ? (statusObj.effort * 100).toFixed(1) : 'N/A';

          // Payments: balances, generate, immature, paid
          const balances = p.balances || {};
          const generate = p.generate || {};
          const immature = p.immature || {};
          const paid = p.paid || {};
          // Sum all balances (across all miners)
          const totalBalance = Object.values(balances).reduce((a,b) => a + b, 0) +
                               Object.values(generate).reduce((a,b) => a + b, 0) +
                               Object.values(immature).reduce((a,b) => a + b, 0);
          const totalPaid = Object.values(paid).reduce((a,b) => a + b, 0);

          // Format with 8 decimals
          const pendingBalance = totalBalance ? totalBalance.toFixed(8) : '0';
          const paidTotal = totalPaid ? totalPaid.toFixed(8) : '0';

          html += `<tr>
            <td><strong>${r.pool}</strong></td>
            <td class="hashrate">${totalHash.toFixed(2)}</td>
            <td>${statusObj.miners || 0}</td>
            <td>${statusObj.workers || 0}</td>
            <td>${blocks.valid || 0}</td>
            <td>${pendingCount}</td>
            <td>${shares.valid||0} / ${shares.stale||0} / ${shares.invalid||0}</td>
            <td>${typeof network.difficulty === 'number' ? network.difficulty.toFixed(2) : network.difficulty}</td>
            <td>${network.height || 'N/A'}</td>
            <td>${reward}</td>
            <td>${fee}</td>
            <td>${paymentInterval}</td>
            <td>${lastBlock}</td>
            <td>${effort}</td>
            <td>${pendingBalance}</td>
            <td>${paidTotal}</td>
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

    fetchData();
    setInterval(fetchData, REFRESH_INTERVAL);
    document.getElementById('intervalDisplay').textContent = REFRESH_INTERVAL / 1000;
  </script>
</body>
</html>
HTMLEOF

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
  log_info "Now showing: all previous stats plus 'Pending Balance' and 'Total Paid' from payments endpoint."
  log_info "Auto‑refresh interval: 60 seconds (change REFRESH_INTERVAL in public/index.html)."
}

main
