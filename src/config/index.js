require("dotenv").config();

const config = {
  // Informazioni di base dell'applicazione
  version: "1.0.0",
  name: "Drakon Node",
  environment: process.env.NODE_ENV || "development",

  // Configurazione di rete
  network: {
    channel: Buffer.from(process.env.CHANNEL || "drakon"),
    defaultP2PPort: parseInt(process.env.P2P_PORT) || 6001,
    defaultHTTPPort: parseInt(process.env.API_PORT) || 3000,
    maxPeers: parseInt(process.env.MAX_PEERS) || 50,
    bootstrap: process.env.BOOTSTRAP_NODES
      ? JSON.parse(process.env.BOOTSTRAP_NODES)
      : [],
    dht: {
      bootstrap: process.env.BOOTSTRAP_NODES
        ? JSON.parse(process.env.BOOTSTRAP_NODES).map(
            (node) => `${node.host}:${node.port}`
          )
        : [],
      interval: 30000,
    },
  },

  // Configurazione database
  database: {
    path: process.env.DB_PATH || "./data/chain",
    options: {
      valueEncoding: "json",
    },
  },

  // Configurazione wallet
  wallet: {
    path: process.env.WALLET_PATH || "./data/wallet",
    keyName: process.env.WALLET_KEY || "drakon",
  },

  // Configurazione mining
  mining: {
    enabled: process.env.ENABLE_MINING === "true",
    interval: parseInt(process.env.MINING_INTERVAL) || 30000,
    reward: parseInt(process.env.MINING_REWARD) || 50,
  },

  // Configurazione API
  api: {
    enabled: process.env.ENABLE_API === "true",
    port: parseInt(process.env.HTTP_PORT) || 7000,
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
    },
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minuti
      max: parseInt(process.env.API_RATE_LIMIT) || 100,
    },
  },

  // Configurazione logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    directory: process.env.LOG_DIR || "./logs",
  },
};

// Validazione della configurazione
function validateConfig() {
  // Verifica che le porte P2P e HTTP siano diverse
  if (config.network.defaultP2PPort === config.network.defaultHTTPPort) {
    throw new Error("P2P_PORT e HTTP_PORT devono essere diversi");
  }

  // Verifica che l'intervallo di mining sia ragionevole
  if (config.mining.enabled && config.mining.interval < 1000) {
    throw new Error("MINING_INTERVAL deve essere almeno 1000ms");
  }

  // Verifica che il numero massimo di peer sia ragionevole
  if (config.network.maxPeers < 1) {
    throw new Error("MAX_PEERS deve essere almeno 1");
  }

  // Verifica che il rate limit sia ragionevole
  if (config.api.rateLimiting.max < 1) {
    throw new Error("API_RATE_LIMIT deve essere almeno 1");
  }
}

try {
  validateConfig();
} catch (error) {
  console.error("Errore di configurazione:", error.message);
  process.exit(1);
}

module.exports = config;
