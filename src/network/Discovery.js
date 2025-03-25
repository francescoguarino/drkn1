const os = require("os");
const dns = require("dns").promises;
const { networkInterfaces } = require("os");
const logger = require("../utils/logger");

class Discovery {
  constructor() {
    this.masterNodes = [
      { host: "51.89.148.92", port: 6001 }, // Il tuo VPS come punto di ingresso iniziale
    ];
    this.knownPeers = new Map();
  }

  async getNetworkInfo() {
    const interfaces = networkInterfaces();
    const addresses = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Salta le interfacce di loopback e non IPv4
        if (iface.internal || iface.family !== "IPv4") continue;
        addresses.push(iface.address);
      }
    }

    return {
      hostname: os.hostname(),
      addresses,
      isPublic: await this.hasPublicIP(),
    };
  }

  async hasPublicIP() {
    try {
      const interfaces = networkInterfaces();
      for (const iface of Object.values(interfaces).flat()) {
        if (!iface.internal && iface.family === "IPv4") {
          // Verifica se l'IP è privato
          const isPrivate =
            /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(
              iface.address
            );
          if (!isPrivate) return true;
        }
      }
      return false;
    } catch (error) {
      logger.error("Errore nel controllo IP pubblico:", error);
      return false;
    }
  }

  async findBestBootstrapNodes() {
    const networkInfo = await this.getNetworkInfo();
    let bootstrapNodes = [...this.masterNodes];

    // Se siamo su un server con IP pubblico, aggiungiamoci alla lista dei bootstrap
    if (networkInfo.isPublic) {
      const myNode = {
        host: networkInfo.addresses[0],
        port: 6001,
      };
      bootstrapNodes.unshift(myNode);
      logger.info(
        `Questo nodo ha un IP pubblico (${myNode.host}), verrà usato come bootstrap node`
      );
    }

    // Ordina i nodi in base alla latenza
    bootstrapNodes = await this.sortNodesByLatency(bootstrapNodes);

    return bootstrapNodes;
  }

  async sortNodesByLatency(nodes) {
    const nodesWithLatency = await Promise.all(
      nodes.map(async (node) => {
        const latency = await this.measureLatency(node);
        return { ...node, latency };
      })
    );

    return nodesWithLatency
      .sort((a, b) => a.latency - b.latency)
      .map(({ host, port }) => ({ host, port }));
  }

  async measureLatency(node) {
    const start = Date.now();
    try {
      await dns.lookup(node.host);
      return Date.now() - start;
    } catch (error) {
      return Infinity;
    }
  }

  addKnownPeer(peerId, peerInfo) {
    this.knownPeers.set(peerId, {
      ...peerInfo,
      lastSeen: Date.now(),
    });
  }

  getKnownPeers() {
    const now = Date.now();
    const staleTime = 30 * 60 * 1000; // 30 minuti

    // Rimuovi i peer non visti di recente
    for (const [peerId, peer] of this.knownPeers.entries()) {
      if (now - peer.lastSeen > staleTime) {
        this.knownPeers.delete(peerId);
      }
    }

    return Array.from(this.knownPeers.values());
  }
}

module.exports = Discovery;
