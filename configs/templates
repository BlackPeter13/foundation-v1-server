#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# generate_pool_config.sh
# Interactive generator for foundation-v1-server config.js
# ──────────────────────────────────────────────────────────

echo "=== Foundation-V1 Pool Config Generator ==="
echo ""

# ─── Basic info ──────────────────────────────────────────
read -p "Coin name (e.g. BitcoinOil): " COIN_NAME
read -p "Coin symbol/ticker (e.g. BTCO): " COIN_SYMBOL
read -p "Pool wallet address: " WALLET_ADDRESS
read -p "Node IP (e.g. 192.168.1.52): " NODE_IP
read -p "Node P2P port (mainnet): " P2P_PORT
read -p "Node RPC port (usually P2P-1): " RPC_PORT
read -p "RPC username: " RPC_USER
read -p "RPC password: " RPC_PASS

# ─── Coinbase tag ────────────────────────────────────────
read -p "Coinbase tag (ASCII, e.g. /radioactive pools/): " COINBASE_TEXT
# Convert to hex for coinbaseSig
COINBASE_HEX=$(echo -n "$COINBASE_TEXT" | xxd -p -u | tr -d '\n')
echo "  → Hex coinbaseSig: $COINBASE_HEX"

# ─── Mining algorithm ────────────────────────────────────
read -p "Mining algorithm (sha256d, scrypt, etc.): " MINING_ALGO

# ─── Chain parameters (mainnet) ─────────────────────────
echo "Enter mainnet chain parameters (from chainparams.cpp)"
read -p "Peer magic (hex string, e.g. f9beb4d9): " PEER_MAGIC

echo "Base58 prefixes (DECIMAL values, e.g. 0 for Bitcoin):"
read -p "  pubKeyHash (PUBKEY_ADDRESS): " PUBKEY_DEC
read -p "  scriptHash (SCRIPT_ADDRESS): " SCRIPT_DEC
read -p "  WIF (SECRET_KEY): " WIF_DEC

# Convert decimal to uppercase hex byte
PUBKEY_HEX=$(printf '%02X' "$PUBKEY_DEC")
SCRIPT_HEX=$(printf '%02X' "$SCRIPT_DEC")
WIF_HEX=$(printf '%02X' "$WIF_DEC")

read -p "BIP32 public key prefix (hex, e.g. 0488B21E): " BIP32_PUB
read -p "BIP32 private key prefix (hex, e.g. 0488ADE4): " BIP32_PRIV
read -p "bech32 HRP (e.g. bc): " BECH32_HRP
read -p "SegWit supported? (true/false): " SEGWIT

# ─── Testnet (optional) ─────────────────────────────────
read -p "Include testnet parameters? (y/n): " INCL_TEST
if [ "$INCL_TEST" = "y" ]; then
    echo "Testnet parameters:"
    read -p "  Peer magic: " TEST_MAGIC
    read -p "  pubKeyHash decimal: " TEST_PUBKEY_DEC
    read -p "  scriptHash decimal: " TEST_SCRIPT_DEC
    read -p "  WIF decimal: " TEST_WIF_DEC
    read -p "  BIP32 public: " TEST_BIP32_PUB
    read -p "  BIP32 private: " TEST_BIP32_PRIV
    read -p "  bech32 HRP: " TEST_BECH32
    read -p "  Testnet coin suffix (e.g. _test): " TEST_COIN_SUFFIX
    TEST_PUBKEY_HEX=$(printf '%02X' "$TEST_PUBKEY_DEC")
    TEST_SCRIPT_HEX=$(printf '%02X' "$TEST_SCRIPT_DEC")
    TEST_WIF_HEX=$(printf '%02X' "$TEST_WIF_DEC")
fi

# ─── Output file ─────────────────────────────────────────
OUTFILE="config_${COIN_SYMBOL}.js"
read -p "Output file name [$OUTFILE]: " USER_OUT
OUTFILE=${USER_OUT:-$OUTFILE}

# ─── Generate config.js ─────────────────────────────────
cat > "$OUTFILE" <<EOF
/*
 * ${COIN_NAME} (${COIN_SYMBOL}) Pool Configuration – foundation-v1-server
 * Custom coinbase tag: "${COINBASE_TEXT}"
 */

// Main Configuration
////////////////////////////////////////////////////////////////////////////////

// Miscellaneous Configuration
const config = {};
config.enabled = true;
config.name = '${COIN_NAME}_Pool';
config.coins = ['${COIN_SYMBOL^^}'];

// Banning Configuration
config.banning = {};
config.banning.time = 600;
config.banning.invalidPercent = 0.5;
config.banning.checkThreshold = 500;
config.banning.purgeInterval = 300;

// Port Configuration
config.ports = [];

const ports1 = {};
ports1.port = 3002;
ports1.enabled = true;
ports1.type = 'shared';
ports1.tls = false;
ports1.difficulty = {};
ports1.difficulty.initial = 32;
ports1.difficulty.minimum = 8;
ports1.difficulty.maximum = 512;
ports1.difficulty.targetTime = 15;
ports1.difficulty.retargetTime = 90;
ports1.difficulty.variance = 0.3;
config.ports.push(ports1);

const ports2 = {};
ports2.port = 3003;
ports2.enabled = true;
ports2.type = 'solo';
ports2.tls = false;
ports2.difficulty = {};
ports2.difficulty.initial = 32;
ports2.difficulty.minimum = 8;
ports2.difficulty.maximum = 512;
ports2.difficulty.targetTime = 15;
ports2.difficulty.retargetTime = 90;
ports2.difficulty.variance = 0.3;
config.ports.push(ports2);

// P2P Configuration
config.p2p = {};
config.p2p.enabled = true;
config.p2p.host = '${NODE_IP}';
config.p2p.port = ${P2P_PORT};

// Statistics Configuration
config.statistics = {};
config.statistics.blocksInterval = 20; // s
config.statistics.hashrateInterval = 20; // s
config.statistics.historicalInterval = 1800; // s
config.statistics.refreshInterval = 20; // s
config.statistics.paymentsInterval = 20; // s
config.statistics.hashrateWindow = 300; // s
config.statistics.historicalWindow = 86400; // s

// Settings Configuration
config.settings = {};
config.settings.blockRefreshInterval = 1000; // ms
config.settings.connectionTimeout = 600; // s
config.settings.jobRebroadcastTimeout = 60; // s
config.settings.tcpProxyProtocol = false;

// Primary Configuration
////////////////////////////////////////////////////////////////////////////////

// Miscellaneous Configuration
config.primary = {};
config.primary.address = '${WALLET_ADDRESS}';

// Coin Configuration
config.primary.coin = {};
config.primary.coin.name = '${COIN_NAME}';
config.primary.coin.symbol = '${COIN_SYMBOL^^}';
config.primary.coin.asicboost = true;
config.primary.coin.getinfo = false;
config.primary.coin.hybrid = false;
config.primary.coin.parameters = {};

// --- CUSTOM COINBASE TAG ---
config.primary.coin.coinbaseSig = '${COINBASE_HEX}'; // hex of "${COINBASE_TEXT}"
config.primary.coin.coinbase = '${COINBASE_TEXT}';

config.primary.coin.segwit = ${SEGWIT,,};
config.primary.coin.version = 4;

// Algorithm Configuration
config.primary.coin.algorithms = {};
config.primary.coin.algorithms.mining = '${MINING_ALGO}';
config.primary.coin.algorithms.block = '${MINING_ALGO}';
config.primary.coin.algorithms.coinbase = '${MINING_ALGO}';

// Rewards Configuration
config.primary.coin.rewards = {};
config.primary.coin.rewards.type = '';
config.primary.coin.rewards.addresses = [];

// Mainnet Configuration
config.primary.coin.mainnet = {};
config.primary.coin.mainnet.bech32 = '${BECH32_HRP}';

config.primary.coin.mainnet.bip32 = {};
config.primary.coin.mainnet.bip32.public  = Buffer.from('${BIP32_PUB}', 'hex').readUInt32LE(0);
config.primary.coin.mainnet.bip32.private = Buffer.from('${BIP32_PRIV}', 'hex').readUInt32LE(0);

config.primary.coin.mainnet.peerMagic = '${PEER_MAGIC}';

// base58Prefixes: PUBKEY=${PUBKEY_DEC} (0x${PUBKEY_HEX}), SCRIPT=${SCRIPT_DEC} (0x${SCRIPT_HEX}), SECRET=${WIF_DEC} (0x${WIF_HEX})
config.primary.coin.mainnet.pubKeyHash = Buffer.from('${PUBKEY_HEX}', 'hex').readUInt8(0);
config.primary.coin.mainnet.scriptHash = Buffer.from('${SCRIPT_HEX}', 'hex').readUInt8(0);
config.primary.coin.mainnet.wif        = Buffer.from('${WIF_HEX}', 'hex').readUInt8(0);

config.primary.coin.mainnet.coin = '${COIN_SYMBOL,,}';
EOF

# Add testnet block if requested
if [ "$INCL_TEST" = "y" ]; then
    cat >> "$OUTFILE" <<EOF

// Testnet Configuration
config.primary.coin.testnet = {};
config.primary.coin.testnet.bech32 = '${TEST_BECH32}';

config.primary.coin.testnet.bip32 = {};
config.primary.coin.testnet.bip32.public  = Buffer.from('${TEST_BIP32_PUB}', 'hex').readUInt32LE(0);
config.primary.coin.testnet.bip32.private = Buffer.from('${TEST_BIP32_PRIV}', 'hex').readUInt32LE(0);

config.primary.coin.testnet.peerMagic = '${TEST_MAGIC}';

config.primary.coin.testnet.pubKeyHash = Buffer.from('${TEST_PUBKEY_HEX}', 'hex').readUInt8(0);
config.primary.coin.testnet.scriptHash = Buffer.from('${TEST_SCRIPT_HEX}', 'hex').readUInt8(0);
config.primary.coin.testnet.wif        = Buffer.from('${TEST_WIF_HEX}', 'hex').readUInt8(0);

config.primary.coin.testnet.coin = '${COIN_SYMBOL,,}${TEST_COIN_SUFFIX}';
EOF
fi

# Add daemon, payments, recipients and export
cat >> "$OUTFILE" <<EOF

// Daemon Configuration
config.primary.daemons = [];

const daemons1 = {};
daemons1.host = '${NODE_IP}';
daemons1.port = ${RPC_PORT};
daemons1.username = '${RPC_USER}';
daemons1.password = '${RPC_PASS}';
config.primary.daemons.push(daemons1);

// Payment Configuration
config.primary.payments = {};
config.primary.payments.enabled = true;
config.primary.payments.checkInterval = 20;            // s
config.primary.payments.paymentInterval = 7200;        // s
config.primary.payments.minConfirmations = 10;
config.primary.payments.minPayment = 0.005;
config.primary.payments.transactionFee = 0.0004;
config.primary.payments.daemon = {};
config.primary.payments.daemon.host = '${NODE_IP}';
config.primary.payments.daemon.port = ${RPC_PORT};
config.primary.payments.daemon.username = '${RPC_USER}';
config.primary.payments.daemon.password = '${RPC_PASS}';

// Recipients Configuration
config.primary.recipients = [];

// Example donation recipient (uncomment and edit if desired)
// const recipient1 = {};
// recipient1.address = 'donation_address_here';
// recipient1.percentage = 0.01;
// config.primary.recipients.push(recipient1);

// Export Configuration
module.exports = config;
EOF

echo ""
echo "✔  Config written to $OUTFILE"
echo "   Remember to set the correct mining algorithm and adjust payment settings if needed."
