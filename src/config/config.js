import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const DEFAULT_CONFIG = {
  version: '1.0.0',
  node: {
    id: crypto.randomBytes(16).toString('hex'),
    name: `node-${crypto.randomBytes(4).toString('hex')}`,
    dataDir: path.join(os.homedir(), '.drakon-node')
  },
  network: {
    type: 'testnet',
    maxPeers: 50,
    port: 6001,
    dht: {
      enabled: true,
      interval: 30000
    }
  },
  p2p: {
    port: 6001,
    protocols: ['/drakon/1.0.0'],
    bootstrapNodes: [
      // Nodi bootstrap predefiniti (nodi reali attivi)
      {
        host: '34.70.102.121',
        port: 6001,
        id: '12D3KooWNF7YUcH1tbAW2Rcewy5t9z1RRDRZJ7AdrPauASxmDTr8'
      },
    ],
    discovery: {
      // Abilita discovery globale attraverso DHT
      dht: true,
      // Imposta un intervallo per l'aggiornamento periodico del DHT
      interval: 60000
    }
  },
  api: {
    enabled: true,
    port: 7001,
    host: '0.0.0.0',
    cors: {
      origin: '*'
    }
  },
  storage: {
    path: path.join(os.homedir(), '.drakon-node', 'data'),
    maxSize: 1024 * 1024 * 100, // 100MB
    options: { valueEncoding: 'json' }
  },
  mining: {
    enabled: false,
    difficulty: 4,
    threads: 1,
    interval: 30000,
    reward: 50
  },
  mempool: {
    maxSize: 1000,
    maxTransactionAge: 3600000 // 1 ora
  },
  gossip: {
    interval: 5000,
    maxPeersPerGossip: 3
  },
  sync: {
    interval: 60000, // 1 minuto
    timeout: 30000 // 30 secondi
  }
};

export class Config {
  constructor(customConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };

    // Applica le variabili d'ambiente se presenti
    this._applyEnvironmentVariables();
  }

  async initialize() {
    await this.createDirectories();
    return this.config;
  }

  async createDirectories() {
    const dirs = [this.config.node.dataDir, this.config.storage.path];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  _applyEnvironmentVariables() {
    // API
    if (process.env.API_PORT) {
      this.config.api.port = parseInt(process.env.API_PORT);
    }
    if (process.env.API_HOST) {
      this.config.api.host = process.env.API_HOST;
    }

    // P2P
    if (process.env.P2P_PORT) {
      this.config.p2p.port = parseInt(process.env.P2P_PORT);
    }

    // Percorso dati
    if (process.env.DATA_DIR) {
      this.config.node.dataDir = process.env.DATA_DIR;
      this.config.storage.path = path.join(process.env.DATA_DIR, 'data');
    }

    // Mining
    if (process.env.MINING_ENABLED) {
      this.config.mining.enabled = process.env.MINING_ENABLED === 'true';
    }

    // Bootstrap nodes
    if (process.env.BOOTSTRAP_NODES) {
      try {
        const bootstrapNodes = JSON.parse(process.env.BOOTSTRAP_NODES);
        if (Array.isArray(bootstrapNodes)) {
          this.config.p2p.bootstrapNodes = bootstrapNodes;
        }
      } catch (error) {
        console.error('Errore nel parsing dei bootstrap nodes:', error.message);
      }
    }

    // Nodo bootstrap
    if (process.env.IS_BOOTSTRAP) {
      this.config.node.isBootstrap = process.env.IS_BOOTSTRAP === 'true';
    }
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
  }
}

// Esporta un'istanza preconfigurata
const configInstance = new Config();
await configInstance.initialize();
export default configInstance.config;
