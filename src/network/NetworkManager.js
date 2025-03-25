const { EventEmitter } = require("events");
const Swarm = require("discovery-swarm");
const defaults = require("dat-swarm-defaults");
const getPort = require("get-port");
const crypto = require("crypto");
const logger = require("../utils/logger");
const Discovery = require("./Discovery");
const RoutingTable = require("./RoutingTable");

class NetworkManager extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map();
    this.routingTable = new RoutingTable(50); // Max peers
    this.discovery = new Discovery();
    this.swarm = null;
    this.myId = crypto.randomBytes(32);
    this.started = false;
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      lastMessageTime: null,
      networkType: "unknown",
      myAddress: null,
    };
  }

  async start() {
    if (this.started) {
      logger.warn("Network manager already started");
      return;
    }

    try {
      // Ottieni informazioni sulla rete
      const networkInfo = await this.discovery.getNetworkInfo();
      this.stats.networkType = networkInfo.isPublic ? "public" : "private";
      this.stats.myAddress = networkInfo.addresses[0];

      // Trova i migliori nodi bootstrap
      const bootstrapNodes = await this.discovery.findBestBootstrapNodes();
      logger.info(`Found ${bootstrapNodes.length} bootstrap nodes`);

      // Configura e avvia lo swarm
      const port = await getPort({ port: 6001 });

      const swarmOpts = defaults({
        id: this.myId,
        tcp: true,
        utp: true,
        dht: {
          bootstrap: bootstrapNodes.map((node) => `${node.host}:${node.port}`),
        },
        hash: false,
      });

      this.swarm = new Swarm(swarmOpts);

      // Configura gli eventi dello swarm
      this.swarm.on("connection", (conn, info) =>
        this._handleConnection(conn, info)
      );
      this.swarm.on("disconnection", (conn, info) =>
        this._handlePeerDisconnect(info.id.toString("hex"))
      );
      this.swarm.on("error", (err) => this._handleError(err));

      // Avvia lo swarm
      this.swarm.listen(port);
      logger.info(`P2P network listening on port ${port}`);

      // Unisciti al canale della rete
      this.swarm.join(Buffer.from("drakon-network"));
      logger.info(`Joined P2P channel: drakon-network`);

      // Avvia il ping periodico e la pulizia
      this._startPingInterval();
      this._startCleanupInterval();

      this.started = true;
      this.emit("started", {
        networkType: this.stats.networkType,
        address: this.stats.myAddress,
        port: port,
      });
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
    try {
      const message = JSON.stringify({ type, data });
      let sentCount = 0;

      for (const [peerId, peer] of this.peers.entries()) {
        try {
          peer.conn.write(message);
          this.stats.messagesSent++;
          sentCount++;
          logger.debug(`Message sent to peer ${peerId}`);
        } catch (error) {
          logger.error(`Error sending to peer ${peerId}: ${error.message}`);
        }
      }

      logger.debug(`Broadcast ${type} message to ${sentCount} peers`);
      return sentCount > 0;
    } catch (error) {
      logger.error(`Error in broadcast: ${error.message}`);
      return false;
    }
  }

  getStats() {
    return {
      ...this.stats,
      peersCount: this.peers.size,
      routingTableSize: this.routingTable.size(),
      myId: this.myId.toString("hex"),
      channel: "drakon-network",
    };
  }

  async broadcastMessage(message) {
    try {
      const messageData = {
        content: message,
        timestamp: Date.now(),
        sender: this.myId.toString("hex"),
      };

      const success = this.broadcast("broadcast", messageData);

      if (success) {
        logger.info(`Messaggio broadcast inviato: ${message}`);
        return true;
      } else {
        logger.warn("Nessun peer disponibile per l'invio del messaggio");
        return false;
      }
    } catch (error) {
      logger.error(
        `Errore nell'invio del messaggio broadcast: ${error.message}`
      );
      return false;
    }
  }

  getConnectedPeers() {
    const peersList = [];

    for (const [peerId, peer] of this.peers.entries()) {
      peersList.push({
        id: peerId,
        address: peer.address,
        port: peer.port,
        lastSeen: new Date(peer.lastSeen).toISOString(),
        messageCount: peer.messageCount,
        isActive: Date.now() - peer.lastSeen < 300000, // 5 minuti
      });
    }

    return peersList;
  }

  // Metodi privati
  _handleConnection(conn, info) {
    const peerId = info.id.toString("hex");

    // Verifica se abbiamo già raggiunto il limite massimo di peer
    if (this.peers.size >= this.routingTable.maxPeers) {
      logger.warn(
        `Rejecting connection from ${peerId}: max peers limit reached`
      );
      conn.destroy();
      return;
    }

    logger.info(`New peer connection: ${peerId} (${info.host}:${info.port})`);

    const peer = {
      conn,
      info,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      messageCount: 0,
    };

    this.peers.set(peerId, peer);
    this.discovery.addKnownPeer(peerId, {
      host: info.host,
      port: info.port,
    });

    this.routingTable.addNode(peerId, {
      address: info.host,
      port: info.port,
    });

    this.stats.totalConnections++;
    this.stats.activeConnections = this.peers.size;

    // Configura gli handler per i messaggi
    conn.on("data", (data) => this._handleMessage(data, peerId));
    conn.on("error", (error) => this._handlePeerError(error, peerId));
    conn.on("close", () => this._handlePeerDisconnect(peerId));

    // Invia le informazioni di rete al nuovo peer
    this._sendNetworkInfo(conn);

    this.emit("peer:connected", { peerId, info });
  }

  _sendNetworkInfo(conn) {
    const knownPeers = this.discovery.getKnownPeers();
    const networkInfo = {
      type: "network-info",
      data: {
        peers: knownPeers,
        networkType: this.stats.networkType,
        address: this.stats.myAddress,
      },
    };
    conn.write(JSON.stringify(networkInfo));
  }

  _handleMessage(message, peerId) {
    try {
      const parsedMessage = JSON.parse(message);

      switch (parsedMessage.type) {
        case "broadcast":
          logger.info(
            `Messaggio ricevuto da ${parsedMessage.data.sender}: ${parsedMessage.data.content}`
          );
          this.emit("message", {
            type: "broadcast",
            sender: parsedMessage.data.sender,
            content: parsedMessage.data.content,
            timestamp: parsedMessage.data.timestamp,
          });
          break;

        case "ping":
          // ... existing code ...
          break;

        case "network-info":
          // ... existing code ...
          break;
      }
    } catch (error) {
      logger.error(`Errore nella gestione del messaggio: ${error.message}`);
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
    }, 60000); // Ogni minuto
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
