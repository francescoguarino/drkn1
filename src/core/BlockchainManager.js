const { EventEmitter } = require("events");
const { Level } = require("level");
const crypto = require("crypto");
const logger = require("../utils/logger");
const config = require("../config");

class BlockchainManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.chain = [];
    this.mempool = new Map();
    this.mining = false;
  }

  async initialize() {
    try {
      this.db = new Level(config.database.path, config.database.options);
      await this._loadChain();
      logger.info("Blockchain initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize blockchain:", error);
      throw error;
    }
  }

  async stop() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.mining = false;
  }

  async addBlock(block) {
    try {
      if (!this._isValidBlock(block)) {
        throw new Error("Invalid block");
      }

      await this._saveBlock(block);
      this.chain.push(block);
      this._cleanMempool(block);
      this.emit("block:added", block);

      logger.info(`Block added: ${block.hash}`);
      return block;
    } catch (error) {
      logger.error("Failed to add block:", error);
      throw error;
    }
  }

  async addTransaction(transaction) {
    try {
      if (!this._isValidTransaction(transaction)) {
        throw new Error("Invalid transaction");
      }

      const txHash = this._calculateTransactionHash(transaction);
      this.mempool.set(txHash, transaction);
      this.emit("transaction:added", transaction);

      logger.info(`Transaction added to mempool: ${txHash}`);
      return txHash;
    } catch (error) {
      logger.error("Failed to add transaction:", error);
      throw error;
    }
  }

  getStats() {
    return {
      height: this.chain.length,
      lastBlock: this.chain[this.chain.length - 1],
      mempool: this.mempool.size,
      mining: this.mining,
    };
  }

  // Metodi privati
  async _loadChain() {
    try {
      for await (const [key, value] of this.db.iterator()) {
        if (key.toString().startsWith("block:")) {
          const block = JSON.parse(value);
          this.chain.push(block);
        }
      }
      this.chain.sort((a, b) => a.height - b.height);
      logger.info(`Loaded ${this.chain.length} blocks from database`);
    } catch (error) {
      logger.error("Error loading chain from database:", error);
      throw error;
    }
  }

  async _saveBlock(block) {
    try {
      await this.db.put(`block:${block.height}`, JSON.stringify(block));
    } catch (error) {
      logger.error("Error saving block to database:", error);
      throw error;
    }
  }

  _isValidBlock(block) {
    // Verifica base del blocco
    if (
      !block.hash ||
      !block.previousHash ||
      !block.timestamp ||
      !block.transactions
    ) {
      return false;
    }

    // Verifica hash del blocco
    const calculatedHash = this._calculateBlockHash(block);
    if (calculatedHash !== block.hash) {
      return false;
    }

    // Verifica collegamento con il blocco precedente
    const previousBlock = this.chain[this.chain.length - 1];
    if (previousBlock && block.previousHash !== previousBlock.hash) {
      return false;
    }

    // Verifica transazioni
    return block.transactions.every((tx) => this._isValidTransaction(tx));
  }

  _isValidTransaction(transaction) {
    // Implementa la logica di validazione delle transazioni
    return true; // Per ora accettiamo tutte le transazioni
  }

  _calculateBlockHash(block) {
    const data = JSON.stringify({
      previousHash: block.previousHash,
      timestamp: block.timestamp,
      transactions: block.transactions,
      nonce: block.nonce,
    });
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  _calculateTransactionHash(transaction) {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(transaction))
      .digest("hex");
  }

  _cleanMempool(block) {
    block.transactions.forEach((tx) => {
      const txHash = this._calculateTransactionHash(tx);
      this.mempool.delete(txHash);
    });
  }
}

module.exports = BlockchainManager;
