const { EventEmitter } = require("events");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");
const logger = require("../utils/logger");
const config = require("../config");

class WalletManager extends EventEmitter {
  constructor() {
    super();
    this.keyPair = null;
    this.address = null;
    this.balance = 0;
  }

  async initialize() {
    try {
      await this._ensureWalletDirectory();
      await this._loadOrCreateWallet();
      logger.info("Wallet initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize wallet:", error);
      throw error;
    }
  }

  getInfo() {
    return {
      address: this.address,
      balance: this.balance,
      isLocked: !this.keyPair,
    };
  }

  async signTransaction(transaction) {
    if (!this.keyPair) {
      throw new Error("Wallet is locked");
    }

    const sign = crypto.createSign("SHA256");
    sign.update(JSON.stringify(transaction.data));
    return sign.sign(this.keyPair.privateKey, "hex");
  }

  // Metodi privati
  async _ensureWalletDirectory() {
    try {
      await fs.mkdir(config.wallet.path, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  async _loadOrCreateWallet() {
    const keyPath = path.join(
      config.wallet.path,
      `${config.wallet.keyName}.json`
    );

    try {
      const exists = await fs
        .access(keyPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = await fs.readFile(keyPath, "utf8");
        const wallet = JSON.parse(data);
        this._importWallet(wallet);
        logger.info("Wallet loaded from file");
      } else {
        await this._createNewWallet(keyPath);
        logger.info("New wallet created");
      }
    } catch (error) {
      logger.error("Error loading/creating wallet:", error);
      throw error;
    }
  }

  async _createNewWallet(keyPath) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    const wallet = {
      publicKey,
      privateKey,
      address: this._generateAddress(publicKey),
    };

    await fs.writeFile(keyPath, JSON.stringify(wallet, null, 2));
    this._importWallet(wallet);
  }

  _importWallet(wallet) {
    this.keyPair = {
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
    };
    this.address = wallet.address;
  }

  _generateAddress(publicKey) {
    const hash = crypto.createHash("sha256").update(publicKey).digest("hex");
    return `DRK${hash.substring(0, 40)}`;
  }
}

module.exports = WalletManager;
