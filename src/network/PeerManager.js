import { Logger } from '../utils/logger.js';

export class PeerManager {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('PeerManager');
    this.peers = new Map();
    this.maxPeers = config.network.maxPeers || 50;
    this.peerTimeout = config.network.peerTimeout || 30000; // 30 secondi
  }

  addPeer(peerId, connection) {
    if (this.peers.size >= this.maxPeers) {
      this.logger.warn(`Limite massimo di peer raggiunto (${this.maxPeers})`);
      return false;
    }

    this.peers.set(peerId, {
      connection,
      status: 'connected',
      lastSeen: Date.now(),
      messageCount: 0,
      metadata: {}
    });

    this.logger.info(`Nuovo peer aggiunto: ${peerId}`);
    return true;
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.connection.close();
        this.peers.delete(peerId);
        this.logger.info(`Peer rimosso: ${peerId}`);
        return true;
      } catch (error) {
        this.logger.error(`Errore nella rimozione del peer ${peerId}:`, error);
        return false;
      }
    }
    return false;
  }

  updatePeerMetadata(peerId, metadata) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.metadata = { ...peer.metadata, ...metadata };
      peer.lastSeen = Date.now();
      return true;
    }
    return false;
  }

  incrementMessageCount(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.messageCount++;
      peer.lastSeen = Date.now();
      return true;
    }
    return false;
  }

  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  getActivePeers() {
    const now = Date.now();
    return Array.from(this.peers.entries())
      .filter(([_, peer]) => now - peer.lastSeen < this.peerTimeout)
      .map(([id, peer]) => ({
        id,
        ...peer
      }));
  }

  getInactivePeers() {
    const now = Date.now();
    return Array.from(this.peers.entries())
      .filter(([_, peer]) => now - peer.lastSeen >= this.peerTimeout)
      .map(([id, peer]) => ({
        id,
        ...peer
      }));
  }

  getPeerStats() {
    return {
      totalPeers: this.peers.size,
      activePeers: this.getActivePeers().length,
      inactivePeers: this.getInactivePeers().length,
      maxPeers: this.maxPeers
    };
  }

  cleanup() {
    const inactivePeers = this.getInactivePeers();
    for (const peer of inactivePeers) {
      this.removePeer(peer.id);
    }
    return inactivePeers.length;
  }

  broadcast(message, excludePeerId = null) {
    const activePeers = this.getActivePeers();
    let sentCount = 0;

    for (const peer of activePeers) {
      if (peer.id !== excludePeerId) {
        try {
          peer.connection.write(message);
          this.incrementMessageCount(peer.id);
          sentCount++;
        } catch (error) {
          this.logger.error(`Errore nell'invio del messaggio al peer ${peer.id}:`, error);
        }
      }
    }

    return sentCount;
  }

  getPeerList() {
    return Array.from(this.peers.entries()).map(([id, peer]) => ({
      id,
      status: peer.status,
      lastSeen: new Date(peer.lastSeen).toISOString(),
      messageCount: peer.messageCount,
      metadata: peer.metadata
    }));
  }

  isPeerActive(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    return Date.now() - peer.lastSeen < this.peerTimeout;
  }

  getPeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    return peer ? peer.connection : null;
  }

  setPeerStatus(peerId, status) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.status = status;
      peer.lastSeen = Date.now();
      return true;
    }
    return false;
  }
}
