require("dotenv").config();
const { EventEmitter } = require("events");
const logger = require("./utils/logger");
const config = require("./config");
const NetworkManager = require("./network/NetworkManager");
const BlockchainManager = require("./core/BlockchainManager");
const APIServer = require("./api/APIServer");
const WalletManager = require("./core/WalletManager");
const { showBanner, showNodeInfo } = require("./utils/banner");
const clear = require("clear");

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
      // Pulisci lo schermo e mostra il banner
      clear();
      showBanner();

      logger.info("Inizializzazione Drakon Node...");

      // Inizializza il wallet
      await this.wallet.initialize();
      logger.info("✓ Wallet inizializzato");

      // Inizializza la blockchain
      await this.blockchain.initialize();
      logger.info("✓ Blockchain inizializzata");

      // Avvia il network manager
      await this.network.start();
      logger.info("✓ Network manager avviato");

      // Avvia il server API
      await this.api.start();
      logger.info("✓ API server in ascolto sulla porta 3000");

      this.emit("started");
      logger.info("Drakon Node avviato con successo!");

      // Mostra le informazioni del nodo
      this._updateNodeInfo();

      // Aggiorna le informazioni ogni minuto
      setInterval(() => this._updateNodeInfo(), 60000);
    } catch (error) {
      logger.error("Errore durante l'avvio di Drakon Node:", error);
      throw error;
    }
  }

  async stop() {
    try {
      logger.info("Arresto Drakon Node...");

      await this.api.stop();
      await this.network.stop();
      await this.blockchain.stop();

      this.emit("stopped");
      logger.info("Drakon Node arrestato con successo");
    } catch (error) {
      logger.error("Errore durante l'arresto:", error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Eventi di rete
    this.network.on("peer:connected", ({ peerId, info }) => {
      logger.info(`Nuovo peer connesso: ${peerId} (${info.host}:${info.port})`);
      this._updateNodeInfo();
    });

    this.network.on("peer:disconnected", ({ peerId }) => {
      logger.info(`Peer disconnesso: ${peerId}`);
      this._updateNodeInfo();
    });

    // Eventi blockchain
    this.blockchain.on("block:added", (block) => {
      logger.info(`Nuovo blocco aggiunto: ${block.hash}`);
      this.network.broadcast("block", block);
      this._updateNodeInfo();
    });

    this.blockchain.on("chain:updated", () => {
      logger.info("Blockchain aggiornata");
      this._updateNodeInfo();
    });

    // Gestione errori
    this.on("error", (error) => {
      logger.error("Errore del nodo:", error);
    });
  }

  _updateNodeInfo() {
    const info = {
      network: this.network.getStats(),
      blockchain: this.blockchain.getStats(),
      wallet: this.wallet.getInfo(),
      uptime: process.uptime(),
    };
    showNodeInfo(info);
  }
}

// Gestione graceful shutdown
process.on("SIGINT", async () => {
  try {
    const node = global.drakonNode;
    if (node) {
      logger.info("Ricevuto segnale SIGINT. Arresto in corso...");
      await node.stop();
    }
    process.exit(0);
  } catch (error) {
    logger.error("Errore durante l'arresto:", error);
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
    logger.error("Errore durante l'avvio del nodo:", error);
    process.exit(1);
  }
}

main();
