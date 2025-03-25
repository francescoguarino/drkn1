const { EventEmitter } = require("events");
const Swarm = require("discovery-swarm");
const defaults = require("dat-swarm-defaults");
const getPort = require("get-port");
const crypto = require("crypto");
const logger = require("../utils/logger");
const config = require("../config");
const RoutingTable = require("./RoutingTable");

class NetworkManager extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map();
    this.routingTable = new RoutingTable(config.network.maxPeers);
    this.swarm = null;
    this.myId = crypto.randomBytes(32);
    this.started = false;
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      lastMessageTime: null,
    };
  }

  async start() {
    if (this.started) {
      logger.warn("Network manager already started");
      return;
    }

    try {
      const port = await getPort({ port: config.network.defaultP2PPort });

      this.swarm = Swarm(
        defaults({
          id: this.myId,
          tcp: true,
          utp: true,
          dht: {
            bootstrap: config.network.dht.bootstrap,
          },
        })
      );

      this.swarm.listen(port);
      logger.info(`P2P network listening on port ${port}`);

      this.swarm.join(config.network.channel);
      logger.info(`Joined P2P channel: ${config.network.channel}`);

      this.swarm.on("connection", this._handleConnection.bind(this));
      this.swarm.on("error", this._handleError.bind(this));

      this.started = true;
      this.emit("started");

      // Avvia il ping periodico dei peer
      this._startPingInterval();

      // Avvia la pulizia periodica dei peer inattivi
      this._startCleanupInterval();
    } catch (error) {
      logger.error("Failed to start network manager:", error);
      throw error;
    }
  }

  async stop() {
    if (!this.started) {
      return;
    }

    try {
      // Chiudi tutte le connessioni
      for (const [peerId, peer] of this.peers.entries()) {
        this._disconnectPeer(peerId, peer);
      }

      // Ferma lo swarm
      if (this.swarm) {
        this.swarm.close();
        this.swarm = null;
      }

      this.started = false;
      this.emit("stopped");
      logger.info("Network manager stopped");
    } catch (error) {
      logger.error("Error stopping network manager:", error);
      throw error;
    }
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    let sentCount = 0;

    for (const peer of this.peers.values()) {
      try {
        peer.conn.write(message);
        this.stats.messagesSent++;
        sentCount++;
      } catch (error) {
        logger.error(`Error broadcasting to peer: ${error.message}`);
      }
    }

    logger.debug(`Broadcast ${type} message to ${sentCount} peers`);
    return sentCount;
  }

  getStats() {
    return {
      ...this.stats,
      peersCount: this.peers.size,
      routingTableSize: this.routingTable.size(),
      myId: this.myId.toString("hex"),
      channel: config.network.channel,
    };
  }

  // Metodi privati
  _handleConnection(conn, info) {
    const peerId = info.id.toString("hex");

    // Verifica se abbiamo già raggiunto il limite massimo di peer
    if (this.peers.size >= config.network.maxPeers) {
      logger.warn(
        `Rejecting connection from ${peerId}: max peers limit reached`
      );
      conn.destroy();
      return;
    }

    logger.info(`New peer connection: ${peerId}`);

    const peer = {
      conn,
      info,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      messageCount: 0,
    };

    this.peers.set(peerId, peer);
    this.routingTable.addNode(peerId, {
      address: info.host,
      port: info.port,
    });

    this.stats.totalConnections++;
    this.stats.activeConnections = this.peers.size;

    conn.on("data", (data) => this._handleMessage(data, peerId));
    conn.on("error", (error) => this._handlePeerError(error, peerId));
    conn.on("close", () => this._handlePeerDisconnect(peerId));

    this.emit("peer:connected", { peerId, info });
  }

  _handleMessage(data, peerId) {
    try {
      const message = JSON.parse(data);
      const peer = this.peers.get(peerId);

      if (peer) {
        peer.lastSeen = Date.now();
        peer.messageCount++;
      }

      this.stats.messagesReceived++;
      this.stats.lastMessageTime = Date.now();

      this.emit("message", { type: message.type, data: message.data, peerId });
      logger.debug(`Received ${message.type} message from ${peerId}`);
    } catch (error) {
      logger.error(`Error handling message from ${peerId}:`, error);
    }
  }

  _handlePeerError(error, peerId) {
    logger.error(`Peer ${peerId} error:`, error);
    this.emit("peer:error", { peerId, error });
  }

  _handlePeerDisconnect(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      this._disconnectPeer(peerId, peer);
    }
  }

  _disconnectPeer(peerId, peer) {
    try {
      peer.conn.destroy();
    } catch (error) {
      logger.error(`Error destroying connection for peer ${peerId}:`, error);
    }

    this.peers.delete(peerId);
    this.routingTable.removeNode(peerId);
    this.stats.activeConnections = this.peers.size;

    this.emit("peer:disconnected", { peerId });
    logger.info(`Peer disconnected: ${peerId}`);
  }

  _handleError(error) {
    logger.error("Network error:", error);
    this.emit("error", error);
  }

  _startPingInterval() {
    setInterval(() => {
      this.broadcast("ping", { timestamp: Date.now() });
    }, config.network.dht.interval);
  }

  _startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minuti

      for (const [peerId, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > timeout) {
          logger.info(`Removing inactive peer: ${peerId}`);
          this._disconnectPeer(peerId, peer);
        }
      }

      // Pulisci anche la tabella di routing
      this.routingTable.cleanup();
    }, 60000); // Ogni minuto
  }
}

module.exports = NetworkManager;
