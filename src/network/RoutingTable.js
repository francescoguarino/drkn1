const { EventEmitter } = require("events");
const logger = require("../utils/logger");

class RoutingTable extends EventEmitter {
  constructor(maxSize = 1000) {
    super();
    this.maxSize = maxSize;
    this.nodes = new Map();
    this.lastSeen = new Map();
  }

  addNode(nodeId, info) {
    if (this.nodes.size >= this.maxSize && !this.nodes.has(nodeId)) {
      this._removeOldestNode();
    }

    this.nodes.set(nodeId, info);
    this.lastSeen.set(nodeId, Date.now());
    this.emit("node:added", { nodeId, info });
    logger.debug(`Node added to routing table: ${nodeId}`);
  }

  removeNode(nodeId) {
    if (this.nodes.has(nodeId)) {
      const info = this.nodes.get(nodeId);
      this.nodes.delete(nodeId);
      this.lastSeen.delete(nodeId);
      this.emit("node:removed", { nodeId, info });
      logger.debug(`Node removed from routing table: ${nodeId}`);
    }
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getAllNodes() {
    return Array.from(this.nodes.entries()).map(([nodeId, info]) => ({
      nodeId,
      info,
      lastSeen: this.lastSeen.get(nodeId),
    }));
  }

  getClosestNodes(nodeId, count = 20) {
    return this.getAllNodes()
      .sort(
        (a, b) =>
          this._distance(nodeId, a.nodeId) - this._distance(nodeId, b.nodeId)
      )
      .slice(0, count);
  }

  updateNode(nodeId, info) {
    if (this.nodes.has(nodeId)) {
      this.nodes.set(nodeId, { ...this.nodes.get(nodeId), ...info });
      this.lastSeen.set(nodeId, Date.now());
      this.emit("node:updated", { nodeId, info });
      logger.debug(`Node updated in routing table: ${nodeId}`);
    }
  }

  hasNode(nodeId) {
    return this.nodes.has(nodeId);
  }

  size() {
    return this.nodes.size;
  }

  clear() {
    this.nodes.clear();
    this.lastSeen.clear();
    this.emit("table:cleared");
    logger.debug("Routing table cleared");
  }

  cleanup(maxAge = 3600000) {
    // Default: 1 hour
    const now = Date.now();
    for (const [nodeId, lastSeen] of this.lastSeen.entries()) {
      if (now - lastSeen > maxAge) {
        this.removeNode(nodeId);
      }
    }
  }

  // Metodi privati
  _removeOldestNode() {
    let oldestNode = null;
    let oldestTime = Date.now();

    for (const [nodeId, time] of this.lastSeen.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestNode = nodeId;
      }
    }

    if (oldestNode) {
      this.removeNode(oldestNode);
    }
  }

  _distance(nodeId1, nodeId2) {
    // Implementa una funzione di distanza XOR per la DHT
    const id1 = Buffer.from(nodeId1, "hex");
    const id2 = Buffer.from(nodeId2, "hex");
    let distance = 0;

    for (let i = 0; i < id1.length; i++) {
      distance += id1[i] ^ id2[i];
    }

    return distance;
  }
}

module.exports = RoutingTable;
