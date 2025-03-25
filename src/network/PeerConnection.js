const { EventEmitter } = require("events");
const logger = require("../utils/logger");

class PeerConnection extends EventEmitter {
  constructor(socket, info) {
    super();
    this.socket = socket;
    this.info = info;
    this.id = info.id.toString("hex");
    this.connected = true;
    this.lastSeen = Date.now();
    this.messageQueue = [];
    this.processingQueue = false;

    this._setupSocketHandlers();
  }

  send(message) {
    if (!this.connected) {
      throw new Error("Connection is closed");
    }

    this.messageQueue.push(message);
    this._processMessageQueue();
  }

  async destroy() {
    if (!this.connected) return;

    this.connected = false;
    this.socket.destroy();
    this.emit("close");
  }

  // Metodi privati
  _setupSocketHandlers() {
    this.socket
      .on("data", this._handleData.bind(this))
      .on("error", this._handleError.bind(this))
      .on("close", this._handleClose.bind(this));
  }

  _handleData(data) {
    try {
      this.lastSeen = Date.now();
      this.emit("message", data.toString());
    } catch (error) {
      logger.error(`Error handling data from peer ${this.id}:`, error);
      this.emit("error", error);
    }
  }

  _handleError(error) {
    logger.error(`Socket error for peer ${this.id}:`, error);
    this.emit("error", error);
  }

  _handleClose() {
    this.connected = false;
    this.emit("close");
  }

  async _processMessageQueue() {
    if (this.processingQueue || this.messageQueue.length === 0) return;

    this.processingQueue = true;

    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        await new Promise((resolve, reject) => {
          this.socket.write(message, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    } catch (error) {
      logger.error(
        `Error processing message queue for peer ${this.id}:`,
        error
      );
      this.emit("error", error);
    } finally {
      this.processingQueue = false;
    }
  }
}

module.exports = PeerConnection;
