import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import crypto from 'crypto';
import os from 'os';

/**
 * Implementazione semplificata di una DHT basata su Kademlia
 * Questa classe gestisce la tabella di routing distribuita per i nodi nella rete
 */
export class DHTManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config || {};
    this.logger = new Logger('DHT');
    this.nodeId = null; // Inizializzato a null, sarà impostato in initialize()
    this.routingTable = new Map(); // peerId -> {ip, port, lastSeen, metadata}
    this.buckets = Array(160)
      .fill()
      .map(() => new Map());
    this.k = 20; // Numero massimo di nodi per bucket
    this.initialized = false;
    this.networkInterface = this._getNetworkInterface();
    this.myIp = this._getMyIp();
    this.myPort = config.p2p?.port || 6001;
  }

  /**
   * Inizializza la DHT
   */
  async initialize(nodeId) {
    // Usa il nodeId fornito, se presente
    if (nodeId) {
      this.nodeId = nodeId;
    } else if (this.config.node?.id) {
      this.nodeId = this.config.node.id;
    } else {
      // Solo come fallback generiamo un nuovo ID
      this.nodeId = this._generateNodeId();
      this.logger.warn('Nessun nodeId fornito, generato nuovo ID: ' + this.nodeId);
    }

    this.logger.info(`Inizializzazione DHT con nodeId: ${this.nodeId}`);
    this.logger.info(`Indirizzo IP locale: ${this.myIp}`);

    // Aggiungi questo nodo alla DHT
    this.addNode(this.nodeId, {
      ip: this.myIp,
      port: this.myPort,
      metadata: {
        isBootstrap: this.config.node?.isBootstrap || false,
        publicKey: this.config.node?.publicKey,
        name: this.config.node?.name
      }
    });

    // Se ci sono bootstrap nodes, aggiungiamoli
    if (this.config.p2p?.bootstrapNodes) {
      for (const node of this.config.p2p.bootstrapNodes) {
        if (node.host && node.port) {
          // Generiamo un ID temporaneo per il bootstrap node se non lo conosciamo ancora
          const tempId = this._hashAddress(`${node.host}:${node.port}`);
          this.addNode(tempId, {
            ip: node.host,
            port: node.port,
            metadata: {
              isBootstrap: true
            }
          });
          this.logger.info(`Aggiunto bootstrap node: ${node.host}:${node.port} con ID: ${tempId}`);
        }
      }
    }

    this.initialized = true;
    return true;
  }

  /**
   * Aggiunge un nodo alla DHT
   */
  addNode(nodeId, info) {
    try {
      if (!nodeId) {
        this.logger.warn('Tentativo di aggiungere un nodo senza ID');
        return false;
      }

      // Assicurati che routingTable sia inizializzata
      if (!this.routingTable) {
        this.routingTable = new Map();
      }

      // Aggiungi o aggiorna il nodo nella tabella di routing
      this.routingTable.set(nodeId, {
        ...info,
        lastSeen: Date.now()
      });

      // Se ci sono i bucket, aggiorna anche quelli
      if (this.buckets) {
        // Calcola l'indice del bucket
        const bucketIndex = this._getBucketIndex(nodeId);
        if (bucketIndex >= 0 && bucketIndex < this.buckets.length) {
          this.buckets[bucketIndex].set(nodeId, {
            ...info,
            lastSeen: Date.now()
          });
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Errore nell'aggiunta del nodo ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Aggiorna un nodo esistente nella DHT
   */
  updateNode(nodeId, info) {
    try {
      if (!nodeId) {
        this.logger.warn('Tentativo di aggiornare un nodo senza ID');
        return false;
      }

      // Assicurati che routingTable sia inizializzata
      if (!this.routingTable) {
        this.routingTable = new Map();
        this.logger.warn('Inizializzazione forzata di routingTable durante updateNode');
      }

      // Se il nodo non esiste, aggiungilo
      if (!this.routingTable.has(nodeId)) {
        return this.addNode(nodeId, info);
      }

      // Aggiorna il nodo esistente
      this.routingTable.set(nodeId, {
        ...this.routingTable.get(nodeId),
        ...info,
        lastSeen: Date.now()
      });

      // Se ci sono i bucket, aggiorna anche quelli
      if (this.buckets) {
        const bucketIndex = this._getBucketIndex(nodeId);
        if (bucketIndex >= 0 && bucketIndex < this.buckets.length) {
          this.buckets[bucketIndex].set(nodeId, {
            ...(this.buckets[bucketIndex].get(nodeId) || {}),
            ...info,
            lastSeen: Date.now()
          });
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Errore nell'aggiornamento del nodo ${nodeId}:`, error);
      return false;
    }
  }

  /**
   * Rimuove un nodo dalla DHT
   */
  removeNode(nodeId) {
    if (this.routingTable.has(nodeId)) {
      const nodeInfo = this.routingTable.get(nodeId);
      this.routingTable.delete(nodeId);

      // Rimuovi anche dal bucket
      const bucketIndex = this._getBucketIndex(nodeId);
      this.buckets[bucketIndex].delete(nodeId);

      this.logger.debug(`Rimosso nodo dalla DHT: ${nodeId}`);
      this.emit('node:removed', { nodeId, nodeInfo });
    }
  }

  /**
   * Ottiene un nodo dalla DHT
   */
  getNode(nodeId) {
    return this.routingTable.get(nodeId);
  }

  /**
   * Ottiene i nodi più vicini a un determinato ID
   */
  getClosestNodes(targetId, count = 20) {
    if (this.routingTable.size === 0) return [];

    // Calcola la distanza da tutti i nodi
    const nodesWithDistance = Array.from(this.routingTable.entries())
      .map(([nodeId, info]) => ({
        nodeId,
        info,
        distance: this._calculateDistance(targetId, nodeId)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);

    return nodesWithDistance.map(({ nodeId, info }) => ({ nodeId, ...info }));
  }

  /**
   * Ottiene tutti i nodi nella DHT
   */
  getAllNodes() {
    return Array.from(this.routingTable.entries()).map(([nodeId, info]) => ({ nodeId, ...info }));
  }

  /**
   * Verifica se un nodo è ancora attivo
   */
  isNodeAlive(nodeId) {
    const node = this.routingTable.get(nodeId);
    if (!node) return false;

    const now = Date.now();
    const ttl = 1000 * 60 * 30; // 30 minuti

    return now - node.lastSeen < ttl;
  }

  /**
   * Pulisce i nodi non più attivi
   */
  cleanupStaleNodes() {
    const now = Date.now();
    const ttl = 1000 * 60 * 30; // 30 minuti

    for (const [nodeId, info] of this.routingTable.entries()) {
      if (now - info.lastSeen > ttl) {
        this.removeNode(nodeId);
      }
    }
  }

  /**
   * Genera il NodeID di questo nodo
   */
  _generateNodeId() {
    // Usa una combinazione di dati unici per generare l'ID
    const hostname = os.hostname();
    const networkInterfaceMac = this._getMacAddress();
    const timestamp = Date.now();
    const random = Math.random().toString();

    const data = `${hostname}-${networkInterfaceMac}-${timestamp}-${random}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Ottieni l'indirizzo MAC della prima interfaccia di rete non-loopback
   */
  _getMacAddress() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac;
        }
      }
    }

    return crypto.randomBytes(6).toString('hex');
  }

  /**
   * Ottieni l'indirizzo IP di questo nodo
   */
  _getMyIp() {
    const interfaces = os.networkInterfaces();

    // Prima cerca un IP pubblico
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (
          !iface.internal &&
          iface.family === 'IPv4' &&
          !iface.address.startsWith('10.') &&
          !iface.address.startsWith('192.168.') &&
          !iface.address.startsWith('172.16.')
        ) {
          return iface.address;
        }
      }
    }

    // Altrimenti restituisci il primo IP privato non-loopback
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address;
        }
      }
    }

    // Fallback a localhost
    return '127.0.0.1';
  }

  /**
   * Ottieni l'interfaccia di rete principale
   */
  _getNetworkInterface() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.family === 'IPv4') {
          return name;
        }
      }
    }

    return Object.keys(interfaces)[0] || 'unknown';
  }

  /**
   * Calcola l'indice del bucket in cui inserire un nodeId
   */
  _getBucketIndex(nodeId) {
    const distance = this._calculateDistance(this.nodeId, nodeId);
    const bucketIndex = Math.floor(Math.log2(distance));
    return Math.min(Math.max(0, bucketIndex), 159); // Assicurati che sia nel range [0, 159]
  }

  /**
   * Calcola la distanza XOR tra due nodeId (algoritmo Kademlia)
   */
  _calculateDistance(nodeId1, nodeId2) {
    // Converti gli ID in buffer
    const id1 = Buffer.from(nodeId1, 'hex');
    const id2 = Buffer.from(nodeId2, 'hex');

    // Calcola la distanza XOR
    let distance = 0;
    const length = Math.min(id1.length, id2.length);

    for (let i = 0; i < length; i++) {
      distance = (distance << 8) | (id1[i] ^ id2[i]);
    }

    return distance;
  }

  /**
   * Genera un hash da un indirizzo ip:port
   */
  _hashAddress(address) {
    return crypto.createHash('sha256').update(address).digest('hex');
  }

  async updateNodeId(newNodeId) {
    if (newNodeId && newNodeId !== this.nodeId) {
      this.logger.info(`Aggiornamento nodeId da ${this.nodeId} a ${newNodeId}`);
      this.nodeId = newNodeId;
    }
  }
}
