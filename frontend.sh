#!/bin/bash
# frontend-setup.sh – creates and runs the Foundation Mining Dashboard
# Automatically fetches pool list from local backend.
# Usage: ./frontend-setup.sh [--clean]

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
  IP=$(ip route get 1 2>/dev/null | awk '{print $NF; exit}' || hostname -I | awk '{print $1}')
  echo ""
  log_info "Dashboard: http://${IP:-localhost}:8080"
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
  mkdir -p "$DASHBOARD_DIR"/{public/{css,js/utils},tests}
  cd "$DASHBOARD_DIR"

  cat > .env << 'EOF'
API_BASE_URL=http://localhost:3001/api/v1
REFRESH_INTERVAL=30000
PORT=8080
EOF

  cat > package.json << 'PKGEOF'
{
  "name": "foundation-mining-dashboard",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "compression": "^1.7.4",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0"
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
const refreshInterval = parseInt(process.env.REFRESH_INTERVAL) || 30000;

app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", apiBaseUrl.replace(/\/api\/v1.*$/, '')],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(morgan('combined'));
app.use((req, res, next) => {
  res.locals.env = { API_BASE_URL: apiBaseUrl, REFRESH_INTERVAL: refreshInterval };
  next();
});
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
        <input type="text" id="manual-pool" placeholder="Or type pool name" style="display:none; background: var(--secondary); color: var(--text); border: 1px solid var(--accent); padding: 0.4rem 1rem; border-radius: var(--border-radius); font-size: 1rem;">
        <button id="manual-go" style="display:none; background: var(--accent); color: white; border: none; padding: 0.4rem 1rem; border-radius: var(--border-radius); cursor: pointer;">Go</button>
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
    <div id="status" role="status" aria-live="polite" class="sr-only"></div>
  </div>
  <script src="/js/app.js"></script>
</body>
</html>`;
  res.send(html);
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.listen(port, () => console.log(`Dashboard running on port ${port}`));
SERVEOF

  cat > public/css/style.css << 'CSSEOF'
:root { --primary: #1a1a2e; --secondary: #16213e; --accent: #0f3460; --highlight: #e94560; --success: #2ecc71; --warning: #f1c40f; --danger: #e74c3c; --text: #eee; --card-bg: #1e2a4a; --border-radius: 8px; --shadow: 0 4px 12px rgba(0,0,0,0.3); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--primary); color: var(--text); padding: 1rem; line-height: 1.6; }
.header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; padding: 1rem 0; border-bottom: 2px solid var(--accent); margin-bottom: 2rem; }
.header h1 { font-size: 1.8rem; color: var(--highlight); }
.pool-selector-wrapper { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.pool-selector-wrapper select, .pool-selector-wrapper input, .pool-selector-wrapper button { background: var(--card-bg); color: var(--text); border: 1px solid var(--accent); padding: 0.4rem 1rem; border-radius: var(--border-radius); font-size: 1rem; }
.pool-selector-wrapper button { background: var(--accent); color: white; cursor: pointer; border: none; }
.pool-selector-wrapper button:hover { background: var(--highlight); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 1rem; margin-bottom: 2rem; }
.stat-card { background: var(--card-bg); padding: 1rem; border-radius: var(--border-radius); text-align: center; box-shadow: var(--shadow); }
.stat-card span { display: block; font-size: 0.8rem; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
.stat-card strong { display: block; font-size: 1.6rem; margin-top: 0.2rem; }
.search-container { text-align: center; margin-bottom: 1.5rem; }
#search { width: min(100%,500px); padding: 0.8rem 1rem; border: 2px solid var(--accent); border-radius: var(--border-radius); background: var(--secondary); color: var(--text); font-size: 1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 1rem; margin: 1rem 0; }
.card { background: var(--card-bg); padding: 1.2rem; border-radius: var(--border-radius); box-shadow: var(--shadow); border-left: 4px solid var(--accent); }
.card h4 { color: var(--highlight); margin-bottom: 0.3rem; word-break: break-all; }
.card .hashrate { color: var(--success); font-weight: bold; }
#blocks-container { margin-top: 2rem; }
#blocks-container h2 { border-bottom: 1px solid var(--accent); padding-bottom: 0.3rem; margin-bottom: 1rem; }
.blocks-list { display: flex; flex-direction: column; gap: 0.5rem; }
.block-item { background: var(--card-bg); padding: 0.8rem 1.2rem; border-radius: var(--border-radius); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; }
.block-item .height { color: var(--highlight); font-weight: bold; }
.block-item .luck { color: var(--warning); }
.loader { text-align: center; padding: 2rem; display: none; }
.error { background: var(--danger); color: white; padding: 1.5rem; border-radius: var(--border-radius); text-align: center; margin: 1rem 0; display: none; }
.retry-button { margin-top: 0.5rem; padding: 0.5rem 1.5rem; background: white; color: var(--danger); border: none; border-radius: var(--border-radius); font-weight: bold; cursor: pointer; }
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap: 1rem; margin: 1rem 0; }
.skeleton-card { background: var(--card-bg); height: 120px; border-radius: var(--border-radius); opacity: 0.4; overflow: hidden; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
.skeleton-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%); animation: shimmer 1.6s infinite; }
@media (max-width: 768px) { .header { flex-direction: column; align-items: stretch; } .stats-grid { grid-template-columns: repeat(2,1fr); } .grid, .skeleton-grid { grid-template-columns: 1fr; } }
CSSEOF

  cat > public/js/app.js << 'APPEOF'
const API_BASE = window.__env?.API_BASE_URL || 'http://localhost:3001/api/v1';
const REFRESH_INTERVAL = window.__env?.REFRESH_INTERVAL || 30000;

const elements = {
  stats: document.getElementById('stats'),
  minersGrid: document.getElementById('miners-grid'),
  blocksList: document.getElementById('blocks-list'),
  loader: document.getElementById('loader'),
  error: document.getElementById('error'),
  search: document.getElementById('search'),
  skeleton: document.getElementById('skeleton'),
  status: document.getElementById('status'),
  poolSelector: document.getElementById('pool-selector'),
  manualPool: document.getElementById('manual-pool'),
  manualGo: document.getElementById('manual-go')
};

let allMiners = [], refreshTimer = null, currentPool = null;

document.addEventListener('DOMContentLoaded', () => {
  console.log('Dashboard starting, API base:', API_BASE);
  setupEventListeners();
  loadPoolList();
});

function setupEventListeners() {
  elements.search.addEventListener('input', debounce(handleSearch, 300));
  elements.poolSelector.addEventListener('change', (e) => {
    currentPool = e.target.value;
    if (currentPool) loadPoolData();
  });
  elements.manualGo.addEventListener('click', () => {
    const val = elements.manualPool.value.trim();
    if (val) { currentPool = val; loadPoolData(); }
  });
  elements.manualPool.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') elements.manualGo.click();
  });
}

async function loadPoolList() {
  try {
    const url = `${API_BASE}/pools`;
    console.log('Fetching pool list from:', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const pools = await res.json();
    console.log('Pools received:', pools);

    const select = elements.poolSelector;
    select.innerHTML = '';
    if (!Array.isArray(pools) || pools.length === 0) {
      select.innerHTML = '<option value="">No pools</option>';
      showManualInput('No pools found from backend.');
      return;
    }
    // Hide manual input if pools exist
    elements.manualPool.style.display = 'none';
    elements.manualGo.style.display = 'none';

    pools.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
    currentPool = pools[0];
    select.value = currentPool;
    loadPoolData();
    scheduleAutoRefresh();
  } catch (err) {
    console.error('Pool list error:', err);
    showError('Could not fetch pool list: ' + err.message);
    showManualInput('Enter pool name manually');
  }
}

function showManualInput(placeholder) {
  elements.manualPool.style.display = 'inline-block';
  elements.manualGo.style.display = 'inline-block';
  elements.manualPool.placeholder = placeholder || 'Enter pool name';
}

async function loadPoolData() {
  if (!currentPool) return;
  showLoading();
  const pool = currentPool;
  const statsUrl = `${API_BASE}/${pool}/`;
  const minersUrl = `${API_BASE}/${pool}/miners?method=active`;
  const blocksUrl = `${API_BASE}/${pool}/blocks`;

  console.log('Stats:', statsUrl);
  console.log('Miners:', minersUrl);
  console.log('Blocks:', blocksUrl);

  try {
    const [statsRes, minersRes, blocksRes] = await Promise.all([
      fetchWithCache(statsUrl),
      fetchWithCache(minersUrl),
      fetchWithCache(blocksUrl)
    ]);

    const statsData = statsRes.body || statsRes;
    const minersData = minersRes.body || minersRes;
    const blocksData = blocksRes.body || blocksRes;

    displayStats(statsData);
    allMiners = flattenMiners(minersData);
    displayMiners(allMiners);
    displayBlocks(blocksData);
    hideLoading();
    announce(`Updated: ${pool}`);
  } catch (err) {
    console.error('Data error:', err);
    showError(err.message);
  }
}

async function fetchWithCache(url) {
  const cached = getCachedData(url, REFRESH_INTERVAL);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText} (url: ${url})`);
  const data = await res.json();
  setCachedData(url, data);
  return data;
}

function displayStats(data) {
  const p = data.primary || {};
  const blocks = p.blocks || { valid:0 };
  const network = p.network || { difficulty:0, hashrate:0, height:0 };
  const hashrate = p.hashrate || { shared:0, solo:0 };
  const status = p.status || { miners:0, workers:0 };
  elements.stats.innerHTML = `
    <div class="stat-card"><span>Total Hashrate</span><strong>${(hashrate.shared+hashrate.solo).toFixed(2)} MH/s</strong></div>
    <div class="stat-card"><span>Miners</span><strong>${status.miners}</strong></div>
    <div class="stat-card"><span>Workers</span><strong>${status.workers}</strong></div>
    <div class="stat-card"><span>Valid Blocks</span><strong>${blocks.valid}</strong></div>
    <div class="stat-card"><span>Network Diff</span><strong>${network.difficulty?.toFixed(2)||'N/A'}</strong></div>
    <div class="stat-card"><span>Block Height</span><strong>${network.height||'N/A'}</strong></div>
  `;
}

function flattenMiners(data) {
  const p = data.primary || {};
  return [...(p.shared||[]), ...(p.solo||[])];
}

function displayMiners(miners) {
  if (!miners || miners.length===0) {
    elements.minersGrid.innerHTML = '<p>No active miners</p>';
    return;
  }
  const sorted = [...miners].sort((a,b)=>(b.hashrate||0)-(a.hashrate||0));
  const html = sorted.slice(0,100).map(m => `
    <div class="card">
      <h4>${m.miner}</h4>
      <p class="hashrate">⚡ ${(m.hashrate||0).toFixed(2)} MH/s</p>
      <p>Shares: V:${m.shares?.valid||0} I:${m.shares?.invalid||0} S:${m.shares?.stale||0}</p>
      <p>Work: ${(m.work||0).toFixed(2)}</p>
    </div>
  `).join('');
  elements.minersGrid.innerHTML = html;
}

function displayBlocks(data) {
  const p = data.primary || {};
  const all = [...(p.pending||[]), ...(p.confirmed||[])]
    .sort((a,b)=>(b.height||0)-(a.height||0))
    .slice(0,20);
  if (all.length===0) { elements.blocksList.innerHTML = '<p>No blocks</p>'; return; }
  const html = all.map(b => `
    <div class="block-item">
      <span class="height">#${b.height}</span>
      <span>${b.hash?.slice(0,12)||''}…</span>
      <span>💰 ${b.reward?.toFixed(4)||'N/A'}</span>
      <span class="luck">Luck: ${(b.luck||0).toFixed(1)}%</span>
      <span>${b.worker||'unknown'}</span>
    </div>
  `).join('');
  elements.blocksList.innerHTML = html;
}

function handleSearch(e) {
  const term = e.target.value.toLowerCase().trim();
  if (!term) { displayMiners(allMiners); return; }
  const filtered = allMiners.filter(m => m.miner.toLowerCase().includes(term));
  displayMiners(filtered);
  announce(`Found ${filtered.length} miners`);
}

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadPoolData().catch(console.warn), REFRESH_INTERVAL);
}

function showLoading() {
  elements.loader.style.display = 'block';
  elements.error.style.display = 'none';
  elements.skeleton.style.display = 'grid';
  elements.minersGrid.innerHTML = '';
}
function hideLoading() {
  elements.loader.style.display = 'none';
  elements.skeleton.style.display = 'none';
}
function showError(msg) {
  elements.error.style.display = 'block';
  elements.error.querySelector('p').textContent = '⚠️ ' + msg;
  elements.loader.style.display = 'none';
  elements.skeleton.style.display = 'none';
}
function announce(msg) {
  elements.status.textContent = msg;
  clearTimeout(window._statusTimeout);
  window._statusTimeout = setTimeout(() => elements.status.textContent = '', 5000);
}
window.retryFetch = function() { loadPoolData(); };

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
function getCachedData(key, ttl) {
  const item = localStorage.getItem(key);
  if (!item) return null;
  try {
    const { timestamp, data } = JSON.parse(item);
    return (Date.now() - timestamp) < ttl ? data : null;
  } catch { return null; }
}
function setCachedData(key, data) {
  localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
}
APPEOF

  log_info "Installing npm dependencies..."
  $NODE_INSTALL_DIR/bin/npm install

  log_info "Starting dashboard..."
  start_dashboard
  show_url
  echo ""
  log_info "Dashboard ready – open your browser."
  log_info "Check console (F12) for debug logs."
}

main
