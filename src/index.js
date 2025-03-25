require("dotenv").config();
const { EventEmitter } = require("events");
const logger = require("./utils/logger");
const config = require("./config");
const NetworkManager = require("./network/NetworkManager");
const BlockchainManager = require("./core/BlockchainManager");
const APIServer = require("./api/APIServer");
const WalletManager = require("./core/WalletManager");
const { showBanner, showNodeInfo } = require("./utils/banner");

class DrakonNode extends EventEmitter {
  constructor() {
    super();
    this.network = new NetworkManager();
    this.blockchain = new BlockchainManager();
    this.wallet = new WalletManager();
    this.api = new APIServer(this);

    this.setupEventHandlers();
  }

  async start() {
    try {
      showBanner();
      logger.info("Starting Drakon Node...");

      // Inizializza il wallet
      await this.wallet.initialize();
      logger.info("Wallet initialized");

      // Inizializza la blockchain
      await this.blockchain.initialize();
      logger.info("Blockchain initialized");

      // Avvia il network manager
      await this.network.start();
      logger.info("Network manager started");

      // Avvia il server API se abilitato
      if (config.api.enabled) {
        await this.api.start();
        logger.info(`API server listening on port ${config.api.port}`);
      }

      this.emit("started");
      logger.info("Drakon Node started successfully");

      // Mostra le informazioni del nodo
      showNodeInfo(this.getNodeInfo());

      // Aggiorna le informazioni ogni minuto
      setInterval(() => {
        showNodeInfo(this.getNodeInfo());
      }, 60000);
    } catch (error) {
      logger.error("Failed to start Drakon Node:", error);
      throw error;
    }
  }

  async stop() {
    try {
      logger.info("Stopping Drakon Node...");

      if (config.api.enabled) {
        await this.api.stop();
      }

      await this.network.stop();
      await this.blockchain.stop();

      this.emit("stopped");
      logger.info("Drakon Node stopped successfully");
    } catch (error) {
      logger.error("Error stopping Drakon Node:", error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Gestione eventi di rete
    this.network.on("peer:connected", (peer) => {
      logger.info(`Peer connected: ${peer.id}`);
      this.emit("peer:connected", peer);
    });

    this.network.on("peer:disconnected", (peer) => {
      logger.info(`Peer disconnected: ${peer.id}`);
      this.emit("peer:disconnected", peer);
    });

    // Gestione eventi blockchain
    this.blockchain.on("block:added", (block) => {
      logger.info(`New block added: ${block.hash}`);
      this.network.broadcast("block", block);
      this.emit("block:added", block);
    });

    this.blockchain.on("chain:updated", () => {
      logger.info("Blockchain updated");
      this.emit("chain:updated");
    });

    // Gestione errori
    this.on("error", (error) => {
      logger.error("Node error:", error);
    });
  }

  getNodeInfo() {
    return {
      version: config.version,
      network: this.network.getStats(),
      blockchain: this.blockchain.getStats(),
      wallet: this.wallet.getInfo(),
      uptime: process.uptime(),
    };
  }
}

// Gestione graceful shutdown
process.on("SIGINT", async () => {
  try {
    const node = global.drakonNode;
    if (node) {
      logger.info("Received SIGINT signal. Shutting down...");
      await node.stop();
    }
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
});

// Avvio del nodo
async function main() {
  try {
    const node = new DrakonNode();
    global.drakonNode = node;
    await node.start();
  } catch (error) {
    logger.error("Failed to start node:", error);
    process.exit(1);
  }
}

main();
