module.exports = {
  // Nodo principale (il tuo VPS)
  MAIN_NODE: {
    host: "51.89.148.92",
    port: 6001,
  },

  // Configurazione di rete predefinita
  NETWORK: {
    defaultP2PPort: 6001,
    defaultAPIPort: 3000,
    maxPeers: 50,
    channel: "drakon-mainnet",
  },

  // Percorsi predefiniti
  PATHS: {
    database: "./db/blockchain",
    wallet: "./data/wallet.json",
    logs: "./logs/node.log",
  },

  // Configurazione API
  API: {
    rateLimit: 100,
    rateWindow: "15m",
    cors: "*",
  },

  // Configurazione Mining
  MINING: {
    enabled: true,
    interval: 30000,
    reward: 50,
  },
};
