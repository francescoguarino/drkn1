const express = require("express");
const cors = require("cors");
const setupRoutes = require("./routes");
const logger = require("../utils/logger");

class APIServer {
  constructor(networkManager) {
    this.app = express();
    this.port = process.env.API_PORT || 3000;
    this.networkManager = networkManager;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    this.app.use("/api", setupRoutes(this.networkManager));
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`API server listening on port ${this.port}`);
          resolve();
        });
      } catch (error) {
        logger.error("Failed to start API server:", error);
        reject(error);
      }
    });
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            logger.error("Error closing API server:", err);
            reject(err);
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
}

module.exports = APIServer;
