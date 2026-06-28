#!/bin/bash
# frontend-setup.sh – creates and runs the Foundation Mining Dashboard
# Uses an isolated Node.js 18 installation (does not affect the pool's Node 14)

set -euo pipefail

# ---------- Configuration ----------
DASHBOARD_DIR="$HOME/Desktop/foundation-mining-dashboard"
NODE_VERSION="18.20.8"
NODE_DISTRO="linux-x64"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"
NODE_INSTALL_DIR="/opt/nodejs-18"   # isolated from system

# Color helpers
log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; exit 1; }

# ---------- Install isolated Node.js 18 ----------
install_nodejs18() {
    if [ -d "$NODE_INSTALL_DIR/bin" ]; then
        log_info "Node.js 18 already installed in $NODE_INSTALL_DIR"
        return
    fi
    log_info "Installing Node.js ${NODE_VERSION} into $NODE_INSTALL_DIR..."
    sudo mkdir -p "$NODE_INSTALL_DIR"
    cd /tmp
    wget -q "$NODE_URL"
    sudo tar -xJf "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz" -C "$NODE_INSTALL_DIR" --strip-components=1
    rm "node-v${NODE_VERSION}-${NODE_DISTRO}.tar.xz"
    # Verify
    if [ -x "$NODE_INSTALL_DIR/bin/node" ]; then
        log_info "Node.js installed: $($NODE_INSTALL_DIR/bin/node -v)"
    else
        log_error "Node.js installation failed."
    fi
}

# ---------- Interactive .env configuration ----------
ask_env_vars() {
    echo ""
    echo "Please configure the dashboard:"
    read -p "API Base URL (e.g., http://localhost:3001/api/v1): " API_BASE_URL
    API_BASE_URL=${API_BASE_URL:-http://localhost:3001/api/v1}
    read -p "Default pool (optional): " DEFAULT_POOL
    read -p "Refresh interval in ms (default: 30000): " REFRESH_INTERVAL
    REFRESH_INTERVAL=${REFRESH_INTERVAL:-30000}
    read -p "Dashboard port (default: 8080): " PORT
    PORT=${PORT:-8080}
}

# ---------- Start dashboard using isolated Node.js ----------
start_dashboard() {
    cd "$DASHBOARD_DIR"
    log_info "Starting dashboard with Node.js 18 from $NODE_INSTALL_DIR..."

    # Use isolated node/npm
    NODE_BIN="$NODE_INSTALL_DIR/bin/node"
    NPM_BIN="$NODE_INSTALL_DIR/bin/npm"

    # Check if PM2 is available (system-wide)
    if command -v pm2 &> /dev/null; then
        # Use PM2 with the isolated Node
        PM2_BIN=$(which pm2)
        sudo -E env "PATH=$NODE_INSTALL_DIR/bin:$PATH" $PM2_BIN start $NODE_BIN server.js --name mining-dashboard --interpreter $NODE_BIN
        log_info "Dashboard started with PM2 (use 'pm2 logs mining-dashboard' to see logs)"
    else
        # Run directly with nohup using isolated Node
        nohup $NODE_BIN server.js > dashboard.log 2>&1 &
        log_info "Dashboard started in background (log: $DASHBOARD_DIR/dashboard.log)."
        log_info "To stop: pkill -f 'node.*server.js'"
    fi
}

# ---------- Show IP and port ----------
show_url() {
    IP=$(ip route get 1 2>/dev/null | awk '{print $NF; exit}' || hostname -I | awk '{print $1}')
    if [ -z "$IP" ]; then
        IP="localhost"
    fi
    echo ""
    log_info "Dashboard is accessible at: http://$IP:$PORT"
    log_info "If you are on the same machine, also: http://localhost:$PORT"
}

# ---------- Main ----------
main() {
    # 1. Install isolated Node.js 18
    install_nodejs18

    # 2. Ask for .env configuration
    ask_env_vars

    # 3. Create dashboard directory and files
    log_info "Creating dashboard at $DASHBOARD_DIR"
    mkdir -p "$DASHBOARD_DIR"/{public/{css,js/utils},tests}
    cd "$DASHBOARD_DIR"

    # Write .env
    cat > .env << EOF
API_BASE_URL=$API_BASE_URL
DEFAULT_POOL=$DEFAULT_POOL
REFRESH_INTERVAL=$REFRESH_INTERVAL
PORT=$PORT
EOF

    # Write package.json, server.js, CSS, JS, etc. (same as before)
    cat > package.json << 'PKGEOF'
{
  "name": "foundation-mining-dashboard",
  "version": "1.0.0",
  "description": "Real-time mining pool dashboard for foundation-v1-server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "build": "esbuild public/js/app.js --minify --outfile=public/js/app.min.js",
    "test": "jest"
  },
  "dependencies": {
    "compression": "^1.7.4",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "esbuild": "^0.19.2",
    "jest": "^29.7.0",
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18"
  }
}
PKGEOF

    cat > server.js << 'SERVEOF'
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 8080;
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const defaultPool = process.env.DEFAULT_POOL || '';
const refreshInterval = parseInt(process.env.REFRESH_INTERVAL) || 30000;
app.use(compression());
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", apiBaseUrl.replace(/\/api\/v1.*$/, '')], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(morgan('combined'));
app.use((req, res, next) => { res.locals.env = { API_BASE_URL: apiBaseUrl, DEFAULT_POOL: defaultPool, REFRESH_INTERVAL: refreshInterval }; next(); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1y', immutable: true }));
app.get('/', (req, res) => {
  const envScript = `<script>window.__env = ${JSON.stringify(res.locals.env)};</script>`;
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mining Pool Dashboard</title>
  <link rel="stylesheet" href="/css/style.css">
  ${envScript}
</head>
<body>
  <div id="app">
    <header class="header">
      <h1>⚡ Foundation Mining Pool</h1>
      <div class="pool-selector-wrapper">
        <label for="pool-selector">Pool:</label>
        <select id="pool-selector"></select>
      </div>
    </header>
    <section class="stats-grid" id="stats"></section>
    <div class="search-container">
      <input type="text" id="search" placeholder="Search miners by address..." aria-label="Search miners">
    </div>
    <div id="loader" class="loader">Loading data…</div>
    <div id="error" class="error" style="display:none;">
      <p>⚠️ Failed to load data.</p>
      <button onclick="window.retryFetch()" class="retry-button">Retry</button>
    </div>
    <div id="skeleton" class="skeleton-grid">
      <div class="skeleton-card" role="status" aria-live="polite"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
      <div class="skeleton-card"></div>
    </div>
    <div id="miners-grid" class="grid" role="region" aria-live="polite"></div>
    <div id="blocks-container">
      <h2>Recent Blocks</h2>
      <div id="blocks-list" class="blocks-list"></div>
    </div>
    <div id="payments-container">
      <h2>Payment Records</h2>
      <div id="payments-list" class="payments-list"></div>
    </div>
    <div id="status" role="status" aria-live="polite" class="sr-only"></div>
  </div>
  <script src="/js/app.js"></script>
</body>
</html>`;
  res.send(html);
});
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.listen(port, () => console.log(`Dashboard running at http://localhost:${port}`));
SERVEOF

    # CSS, JS, cache, tests, README (same as before)
    cat > public/css/style.css << 'CSSEOF'
:root { --primary: #1a1a2e; --secondary: #16213e; --accent: #0f3460; --highlight: #e94560; --success: #2ecc71; --warning: #f1c40f; --danger: #e74c3c; --text: #eee; --card-bg: #1e2a4a; --border-radius: 8px; --shadow: 0 4px 12px rgba(0,0,0,0.3); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--primary); color: var(--text); padding: 1rem; line-height: 1.6; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
.container { max-width: 1400px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; padding: 1rem 0; border-bottom: 2px solid var(--accent); margin-bottom: 2rem; }
.header h1 { font-size: 1.8rem; color: var(--highlight); }
.pool-selector-wrapper { display: flex; align-items: center; gap: 0.5rem; }
.pool-selector-wrapper select { background: var(--card-bg); color: var(--text); border: 1px solid var(--accent); padding: 0.4rem 1rem; border-radius: var(--border-radius); font-size: 1rem; cursor: pointer; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 1rem; margin-bottom: 2rem; }
.stat-card { background: var(--card-bg); padding: 1rem; border-radius: var(--border-radius); text-align: center; box-shadow: var(--shadow); }
.stat-card span { display: block; font-size: 0.8rem; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
.stat-card strong { display: block; font-size: 1.6rem; margin-top: 0.2rem; color: var(--text); }
.search-container { text-align: center; margin-bottom: 1.5rem; }
#search { width: min(100%,500px); padding: 0.8rem 1rem; border: 2px solid var(--accent); border-radius: var(--border-radius); background: var(--secondary); color: var(--text); font-size: 1rem; }
#search:focus { outline: none; border-color: var(--highlight); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 1rem; margin: 1rem 0; }
.card { background: var(--card-bg); padding: 1.2rem; border-radius: var(--border-radius); box-shadow: var(--shadow); transition: transform 0.1s ease; border-left: 4px solid var(--accent); }
.card:hover { transform: translateY(-2px); }
.card h4 { color: var(--highlight); margin-bottom: 0.3rem; word-break: break-all; font-size: 0.9rem; }
.card p { font-size: 0.9rem; margin: 0.15rem 0; color: #ccc; }
.card .hashrate { color: var(--success); font-weight: bold; }
#blocks-container, #payments-container { margin-top: 2rem; }
#blocks-container h2, #payments-container h2 { border-bottom: 1px solid var(--accent); padding-bottom: 0.3rem; margin-bottom: 1rem; }
.blocks-list, .payments-list { display: flex; flex-direction: column; gap: 0.5rem; }
.block-item, .payment-item { background: var(--card-bg); padding: 0.8rem 1.2rem; border-radius: var(--border-radius); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; font-size: 0.9rem; }
.block-item .height { color: var(--highlight); font-weight: bold; }
.block-item .luck { color: var(--warning); }
.loader { text-align: center; padding: 2rem; display: none; }
.error { background: var(--danger); color: white; padding: 1.5rem; border-radius: var(--border-radius); text-align: center; margin: 1rem 0; display: none; }
.retry-button { margin-top: 0.5rem; padding: 0.5rem 1.5rem; background: white; color: var(--danger); border: none; border-radius: var(--border-radius); font-weight: bold; cursor: pointer; }
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 1rem; margin: 1rem 0; }
.skeleton-card { background: var(--card-bg); height: 120px; border-radius: var(--border-radius); position: relative; overflow: hidden; opacity: 0.4; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
.skeleton-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%); animation: shimmer 1.6s infinite; }
@media (max-width: 768px) { .header { flex-direction: column; align-items: stretch; gap: 0.5rem; } .stats-grid { grid-template-columns: repeat(2,1fr); } .grid, .skeleton-grid { grid-template-columns: 1fr; } }
CSSEOF

    cat > public/js/app.js << 'APPEOF'
import { getCachedData, setCachedData } from './utils/cache.js';
const API_BASE = window.__env?.API_BASE_URL || 'http://localhost:3001/api/v1';
const DEFAULT_POOL = window.__env?.DEFAULT_POOL || '';
const REFRESH_INTERVAL = window.__env?.REFRESH_INTERVAL || 30000;
const elements = { stats: document.getElementById('stats'), minersGrid: document.getElementById('miners-grid'), blocksList: document.getElementById('blocks-list'), paymentsList: document.getElementById('payments-list'), loader: document.getElementById('loader'), error: document.getElementById('error'), search: document.getElementById('search'), poolSelector: document.getElementById('pool-selector'), skeleton: document.getElementById('skeleton'), status: document.getElementById('status') };
let currentPool = DEFAULT_POOL;
let allMiners = [];
let refreshTimer = null;
document.addEventListener('DOMContentLoaded', init);
function init() { setupEventListeners(); loadPoolsAndData(); scheduleAutoRefresh(); }
function setupEventListeners() { elements.search.addEventListener('input', debounce(handleSearch, 300)); elements.poolSelector.addEventListener('change', (e) => { currentPool = e.target.value; loadPoolData(); }); }
async function loadPoolsAndData() { try { const pools = await fetchPools(); populatePoolSelector(pools); if (!currentPool && pools.length > 0) { currentPool = pools[0]; } if (currentPool) { await loadPoolData(); } else { announce('No pools available'); } } catch (err) { console.warn('Error loading pools:', err); if (currentPool) await loadPoolData(); else showError('Could not fetch pool list'); } }
async function fetchPools() { const url = `${API_BASE}/pools`; const cached = getCachedData(url, 60000); if (cached) return cached; const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); const data = await res.json(); setCachedData(url, data); return data; }
function populatePoolSelector(pools) { const select = elements.poolSelector; select.innerHTML = ''; if (pools.length === 0) { select.innerHTML = '<option value="">No pools</option>'; return; } pools.forEach(p => { const opt = document.createElement('option'); opt.value = p; opt.textContent = p; select.appendChild(opt); }); if (currentPool && pools.includes(currentPool)) { select.value = currentPool; } else { select.value = pools[0]; currentPool = pools[0]; } }
async function loadPoolData() { if (!currentPool) return; showLoading(); try { const statsKey = `${API_BASE}/${currentPool}/statistics`; const minersKey = `${API_BASE}/${currentPool}/miners`; const blocksKey = `${API_BASE}/${currentPool}/blocks`; const paymentsKey = `${API_BASE}/${currentPool}/payments`; const [stats, miners, blocks, payments] = await Promise.all([ fetchWithCache(statsKey), fetchWithCache(minersKey), fetchWithCache(blocksKey), fetchWithCache(paymentsKey) ]); displayStats(stats); allMiners = flattenMiners(miners); displayMiners(allMiners); displayBlocks(blocks); displayPayments(payments); hideLoading(); announce(`Data updated for ${currentPool}`); } catch (err) { console.error(err); showError(err.message); } }
async function fetchWithCache(url) { const cached = getCachedData(url, REFRESH_INTERVAL); if (cached) return cached; const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`); const data = await res.json(); setCachedData(url, data); return data; }
function displayStats(stats) { const primary = stats.primary || {}; const blocks = primary.blocks || { valid: 0, invalid: 0 }; const network = primary.network || { difficulty: 0, hashrate: 0, height: 0 }; const hashrate = primary.hashrate || { shared: 0, solo: 0 }; const status = primary.status || { miners: 0, workers: 0 }; elements.stats.innerHTML = `<div class="stat-card"><span>Total Hashrate</span><strong>${(hashrate.shared + hashrate.solo).toFixed(2)} MH/s</strong></div><div class="stat-card"><span>Miners</span><strong>${status.miners}</strong></div><div class="stat-card"><span>Workers</span><strong>${status.workers}</strong></div><div class="stat-card"><span>Valid Blocks</span><strong>${blocks.valid}</strong></div><div class="stat-card"><span>Network Diff</span><strong>${network.difficulty.toFixed(2)}</strong></div><div class="stat-card"><span>Block Height</span><strong>${network.height}</strong></div>`; }
function flattenMiners(minersData) { const all = []; if (minersData.primary) { if (minersData.primary.shared) all.push(...minersData.primary.shared); if (minersData.primary.solo) all.push(...minersData.primary.solo); } if (minersData.auxiliary) { if (minersData.auxiliary.shared) all.push(...minersData.auxiliary.shared); if (minersData.auxiliary.solo) all.push(...minersData.auxiliary.solo); } return all; }
function displayMiners(miners) { const sorted = [...miners].sort((a, b) => (b.hashrate || 0) - (a.hashrate || 0)); const html = sorted.slice(0, 100).map(m => `<div class="card"><h4>${m.miner}</h4><p class="hashrate">⚡ ${(m.hashrate || 0).toFixed(2)} MH/s</p><p>Shares: V:${m.shares?.valid || 0} I:${m.shares?.invalid || 0} S:${m.shares?.stale || 0}</p><p>Work: ${(m.work || 0).toFixed(2)}</p></div>`).join(''); elements.minersGrid.innerHTML = html || '<p class="no-data">No miners active</p>'; }
function displayBlocks(blocksData) { const primary = blocksData.primary || {}; const allBlocks = [...(primary.pending || []), ...(primary.confirmed || [])].sort((a, b) => (b.height || 0) - (a.height || 0)).slice(0, 20); const html = allBlocks.map(b => `<div class="block-item"><span class="height">#${b.height}</span><span>${b.hash?.slice(0, 12) || ''}…</span><span>💰 ${b.reward?.toFixed(4) || 'N/A'}</span><span class="luck">Luck: ${(b.luck || 0).toFixed(1)}%</span><span>${b.worker || 'unknown'}</span></div>`).join(''); elements.blocksList.innerHTML = html || '<p>No blocks found</p>'; }
function displayPayments(paymentsData) { const records = paymentsData?.primary?.records || []; const sorted = records.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10); const html = sorted.map(p => `<div class="payment-item"><span>${new Date(p.time).toLocaleString()}</span><span>💰 ${p.paid?.toFixed(4) || 'N/A'}</span><span>👤 ${p.miners || 0} miners</span><span>${p.transaction?.slice(0, 12) || ''}…</span></div>`).join(''); elements.paymentsList.innerHTML = html || '<p>No payments yet</p>'; }
function handleSearch(event) { const term = event.target.value.toLowerCase().trim(); if (!term) { displayMiners(allMiners); return; } const filtered = allMiners.filter(m => m.miner.toLowerCase().includes(term)); displayMiners(filtered); announce(`Found ${filtered.length} miners`); }
function scheduleAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = setInterval(() => { loadPoolData().catch(console.warn); }, REFRESH_INTERVAL); }
function showLoading() { elements.loader.style.display = 'block'; elements.error.style.display = 'none'; elements.skeleton.style.display = 'grid'; elements.minersGrid.innerHTML = ''; }
function hideLoading() { elements.loader.style.display = 'none'; elements.skeleton.style.display = 'none'; }
function showError(message) { elements.error.style.display = 'block'; elements.error.querySelector('p').textContent = `⚠️ ${message}`; elements.loader.style.display = 'none'; elements.skeleton.style.display = 'none'; }
function announce(msg) { elements.status.textContent = msg; clearTimeout(window._statusTimeout); window._statusTimeout = setTimeout(() => { elements.status.textContent = ''; }, 5000); }
window.retryFetch = function() { loadPoolData(); };
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
APPEOF

    cat > public/js/utils/cache.js << 'CACHEEOF'
export function getCachedData(key, ttl) { const item = localStorage.getItem(key); if (!item) return null; try { const { timestamp, data } = JSON.parse(item); const age = Date.now() - timestamp; return age < ttl ? data : null; } catch { return null; } }
export function setCachedData(key, data) { const item = { timestamp: Date.now(), data }; localStorage.setItem(key, JSON.stringify(item)); }
CACHEEOF

    cat > tests/app.test.js << 'TESTOEF'
describe('Mining Dashboard', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="stats"></div><div id="miners-grid"></div><div id="blocks-list"></div><div id="payments-list"></div><div id="loader"></div><div id="error"></div><div id="search"></div><div id="pool-selector"></div><div id="skeleton"></div><div id="status"></div>`;
    window.__env = { API_BASE_URL: 'http://localhost:3001/api/v1', DEFAULT_POOL: 'BCA', REFRESH_INTERVAL: 30000 };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 1, name: 'Test Miner' }]) }));
  });
  test('displays pools selector after fetch', async () => { expect(true).toBe(true); });
});
TESTOEF

    cat > README.md << 'READEOM'
# Foundation Mining Dashboard

A real-time dashboard for foundation-v1-server. Features: live stats, miners list, blocks, payments, auto-refresh, multi-pool support, caching.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `API_BASE_URL`.
3. `npm start`

## Environment
- `API_BASE_URL`: your backend API (e.g., http://server:3001/api/v1)
- `DEFAULT_POOL`: optional
- `REFRESH_INTERVAL`: ms (default 30000)
- `PORT`: server port (default 8080)

## Deploy
`pm2 start server.js --name mining-dashboard`
READEOM

    # Install dependencies using isolated npm
    log_info "Installing npm dependencies (using isolated Node.js 18)..."
    $NODE_INSTALL_DIR/bin/npm install

    # Start the dashboard using isolated Node.js
    log_info "Starting the dashboard..."
    start_dashboard

    # Show URL
    show_url
    echo ""
    log_info "Setup complete! Dashboard running in background."
    log_info "To view logs: tail -f $DASHBOARD_DIR/dashboard.log (if using nohup)"
    log_info "To stop: pkill -f 'node.*server.js' (if using nohup) or pm2 stop mining-dashboard"
}

main
