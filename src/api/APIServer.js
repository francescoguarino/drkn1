const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bodyParser = require("body-parser");
const logger = require("../utils/logger");
const config = require("../config");

class APIServer {
  constructor(node) {
    this.node = node;
    this.app = express();
    this.server = null;
    this._setupMiddleware();
    this._setupRoutes();
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(config.network.defaultHTTPPort, () => {
          logger.info(
            `API server listening on port ${config.network.defaultHTTPPort}`
          );
          resolve();
        });
      } catch (error) {
        logger.error("Failed to start API server:", error);
        reject(error);
      }
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((error) => {
          if (error) {
            logger.error("Error closing API server:", error);
            reject(error);
          } else {
            logger.info("API server stopped");
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  _setupMiddleware() {
    // CORS
    this.app.use(cors(config.api.cors));

    // Rate limiting
    const limiter = rateLimit(config.api.rateLimiting);
    this.app.use(limiter);

    // Body parsing
    this.app.use(bodyParser.json());

    // Logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      logger.error("API Error:", err);
      res.status(500).json({ error: "Internal Server Error" });
    });
  }

  _setupRoutes() {
    // Info route
    this.app.get("/info", (req, res) => {
      res.json(this.node.getNodeInfo());
    });

    // Blockchain routes
    this.app.get("/blocks", (req, res) => {
      const { limit = 10, offset = 0 } = req.query;
      const blocks = this.node.blockchain.chain
        .slice(offset, offset + limit)
        .map((block) => ({
          height: block.height,
          hash: block.hash,
          timestamp: block.timestamp,
          transactions: block.transactions.length,
        }));

      res.json({
        blocks,
        total: this.node.blockchain.chain.length,
      });
    });

    this.app.get("/block/:hash", (req, res) => {
      const block = this.node.blockchain.chain.find(
        (b) => b.hash === req.params.hash
      );
      if (!block) {
        return res.status(404).json({ error: "Block not found" });
      }
      res.json(block);
    });

    // Transaction routes
    this.app.get("/mempool", (req, res) => {
      const transactions = Array.from(this.node.blockchain.mempool.values());
      res.json({
        transactions,
        count: transactions.length,
      });
    });

    this.app.post("/transaction", async (req, res) => {
      try {
        const txHash = await this.node.blockchain.addTransaction(req.body);
        res.json({ hash: txHash });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Wallet routes
    this.app.get("/wallet", (req, res) => {
      res.json(this.node.wallet.getInfo());
    });

    // Network routes
    this.app.get("/peers", (req, res) => {
      res.json(this.node.network.getNetworkStats());
    });
  }
}

module.exports = APIServer;
