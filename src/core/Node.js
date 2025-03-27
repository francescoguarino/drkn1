import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { PeerManager } from '../network/PeerManager.js';
import { Blockchain } from './Blockchain.js';
import { Wallet } from './Wallet.js';
import { Miner } from '../consensus/Miner.js';
import { SyncManager } from '../consensus/SyncManager.js';
import { GossipManager } from '../consensus/GossipManager.js';
import { Mempool } from '../consensus/Mempool.js';
import { BlockchainDB } from '../storage/BlockchainDB.js';
import { BlockchainEventEmitter } from '../utils/BlockchainEventEmitter.js';
import { APIServer } from '../api/server.js';
import { NodeStorage } from '../utils/NodeStorage.js';
import crypto from 'crypto';
import path from 'path';
import { DHTManager } from '../network/DHT.js';

export class Node extends EventEmitter {
  constructor(config) {
    super();
    if (!config) {
      throw new Error('La configurazione è richiesta');
    }

    this.config = this._validateAndEnrichConfig(config);
    this.logger = new Logger('Node');
    this.storage = new NodeStorage(this.config);

    // Usa il flag dalla configurazione se presente, altrimenti inizializza a false
    this.bannerDisplayed = config.bannerDisplayed || false;

    if (config.bannerDisplayed) {
      this.logger.debug('Banner già mostrato, non verrà visualizzato di nuovo');
    }

    // Debug info
    this.logger.debug(
      'Inizializzazione del nodo con la configurazione:',
      JSON.stringify(
        {
          nodeId: this.config.node?.id,
          p2pPort: this.config.p2p?.port,
          apiPort: this.config.api?.port,
          mining: this.config.mining,
          blockchain: this.config.blockchain
        },
        null,
        2
      )
    );

    try {
      this.networkManager = new NetworkManager(this.config, this.storage);
      this.peerManager = new PeerManager(this.config);
      this.blockchainDB = new BlockchainDB(this.config);

      // Debug info blockchain
      this.logger.debug(
        'Configurazione blockchain prima della creazione:',
        JSON.stringify(this.config.blockchain, null, 2)
      );

      this.blockchain = new Blockchain(this.config, this.blockchainDB);
      this.wallet = new Wallet(this.config);
      this.mempool = new Mempool(this.config, this.blockchain);
      this.miner = new Miner(this.config, this.blockchain, this.wallet, this.mempool);
      this.syncManager = new SyncManager(this.config, this.blockchain, this.networkManager);
      this.gossipManager = new GossipManager(
        this.config,
        this.networkManager,
        this.mempool,
        this.blockchain
      );
      this.eventEmitter = new BlockchainEventEmitter();
      this.apiServer = new APIServer(this.config, this);
      this.isRunning = false;

      this._setupEventHandlers();
    } catch (error) {
      this.logger.error("Errore durante l'inizializzazione del nodo:", error);
      throw error;
    }
  }

  /**
   * Valida e arricchisce la configurazione per garantire che tutte le proprietà necessarie esistano
   * @param {Object} config - Configurazione iniziale
   * @returns {Object} - Configurazione validata e arricchita
   */
  _validateAndEnrichConfig(config) {
    // Copia profonda per non modificare l'oggetto originale
    const validatedConfig = JSON.parse(JSON.stringify(config));

    // Assicurati che tutte le sezioni di configurazione principali esistano
    // Node
    if (!validatedConfig.node) {
      validatedConfig.node = {
        id: crypto.randomBytes(16).toString('hex'),
        name: `node-${crypto.randomBytes(4).toString('hex')}`
      };
    } else if (!validatedConfig.node.id) {
      // Se esiste la sezione node ma manca id, generalo
      validatedConfig.node.id = crypto.randomBytes(16).toString('hex');
    }

    // Blockchain
    if (!validatedConfig.blockchain) {
      validatedConfig.blockchain = {
        difficulty: 4,
        miningReward: 50,
        maxTransactionsPerBlock: 10,
        blockInterval: 10000
      };
    }

    // Wallet
    if (!validatedConfig.wallet) {
      validatedConfig.wallet = {
        path: path.join(validatedConfig.node.dataDir || process.cwd(), 'wallet'),
        saveToFile: true
      };
    } else {
      if (!validatedConfig.wallet.path) {
        validatedConfig.wallet.path = path.join(
          validatedConfig.node.dataDir || process.cwd(),
          'wallet'
        );
      }
      if (validatedConfig.wallet.saveToFile === undefined) {
        validatedConfig.wallet.saveToFile = true;
      }
    }

    // Storage
    if (!validatedConfig.storage) {
      validatedConfig.storage = {
        path: path.join(process.cwd(), 'db', validatedConfig.node.id || 'node'),
        maxSize: 1024 * 1024 * 100, // 100MB
        options: { valueEncoding: 'json' }
      };
    } else {
      if (!validatedConfig.storage.maxSize) {
        validatedConfig.storage.maxSize = 1024 * 1024 * 100; // 100MB
      }
      if (!validatedConfig.storage.options) {
        validatedConfig.storage.options = { valueEncoding: 'json' };
      }
    }

    // Mempool
    if (!validatedConfig.mempool) {
      validatedConfig.mempool = {
        maxSize: 1000,
        maxTransactionAge: 3600000 // 1 ora
      };
    } else if (!validatedConfig.mempool.maxSize) {
      validatedConfig.mempool.maxSize = 1000;
    }

    // Gossip
    if (!validatedConfig.gossip) {
      validatedConfig.gossip = {
        interval: 5000,
        maxPeersPerGossip: 3
      };
    }

    // Network
    if (!validatedConfig.network) {
      validatedConfig.network = {
        type: 'testnet',
        maxPeers: 50,
        peerTimeout: 30000
      };
    } else {
      if (!validatedConfig.network.maxPeers) {
        validatedConfig.network.maxPeers = 50;
      }
      if (!validatedConfig.network.peerTimeout) {
        validatedConfig.network.peerTimeout = 30000;
      }
    }

    return validatedConfig;
  }

  async start() {
    try {
      this.logger.info('Avvio del nodo Drakon...');

      // Carica le informazioni esistenti
      const savedInfo = await this.storage.loadNodeInfo();

      if (savedInfo && savedInfo.nodeId) {
        this.logger.info(`Caricate informazioni del nodo esistenti con ID: ${savedInfo.nodeId}`);
        // Usa le informazioni salvate
        this.nodeId = savedInfo.nodeId;

        // Importante: aggiorna la configurazione
        this.config.node.id = this.nodeId;

        // Carica anche le porte, se disponibili
        if (savedInfo.p2pPort) {
          this.logger.info(`Usando porta P2P salvata: ${savedInfo.p2pPort}`);
          this.config.p2p.port = savedInfo.p2pPort;
        }

        if (savedInfo.apiPort) {
          this.logger.info(`Usando porta API salvata: ${savedInfo.apiPort}`);
          if (!this.config.api) this.config.api = {};
          this.config.api.port = savedInfo.apiPort;
        }

        this.createdAt = new Date(savedInfo.createdAt);
        this.lastUpdated = new Date(savedInfo.lastUpdated);

        // Se c'è un PeerId salvato, assicurati di usare quello
        if (savedInfo.peerId) {
          this.config.peerId = savedInfo.peerId;
        }
      } else {
        this.logger.info(
          'Nessuna informazione del nodo trovata, verranno create nuove informazioni'
        );

        // Se l'ID è già impostato in configurazione, usa quello invece di generarne uno nuovo
        if (this.config.node && this.config.node.id) {
          this.logger.info(
            `Utilizzo ID nodo esistente dalla configurazione: ${this.config.node.id}`
          );
          this.nodeId = this.config.node.id;
        } else {
          // Genera un nuovo nodeId solo se non è presente in configurazione
          this.nodeId = crypto.randomBytes(16).toString('hex');
          this.config.node.id = this.nodeId; // Assicurati che l'ID sia coerente in tutta la configurazione
        }

        this.createdAt = new Date();
        this.lastUpdated = new Date();
      }

      // Passa il nodeId alla DHT prima di inizializzarla
      this.dht = new DHTManager({
        ...this.config,
        node: {
          ...this.config.node,
          id: this.nodeId
        }
      });

      // Inizializza il database blockchain
      await this.blockchainDB.init();

      // Inizializza la blockchain
      await this.blockchain.init();

      // Inizializza il wallet
      await this.wallet.init();

      // Aggiorna il NetworkManager per usare il nodeId già generato
      this.networkManager.nodeId = this.nodeId;

      // Inizializza il network manager
      await this.networkManager.start();

      // Inizializza il gossip manager
      await this.gossipManager.start();

      // Inizializza il sync manager
      await this.syncManager.start();

      // Avvia il server API
      if (this.config.api?.enabled !== false) {
        await this.apiServer.start();

        // Salva la porta API nelle informazioni del nodo
        if (this.config.api?.port) {
          await this.storage.saveNodeInfo({
            apiPort: this.config.api.port
          });
        }
      }

      // Salva le informazioni del nodo
      const nodeInfo = {
        nodeId: this.nodeId,
        peerId: this.networkManager.peerId ? this.networkManager.peerId.toJSON() : null,
        walletAddress: this.wallet.address,
        createdAt: this.createdAt.toISOString(),
        lastUpdated: new Date().toISOString(),
        network: this.config.node.network,
        p2pPort: this.config.p2p.port,
        apiPort: this.config.api.port,
        mining: {
          enabled: this.config.mining.enabled,
          maxWorkers: this.config.mining.maxWorkers,
          targetBlockTime: this.config.mining.targetBlockTime
        }
      };

      await this.storage.saveNodeInfo(nodeInfo);
      this.logger.info('Nodo Drakon avviato con successo');
    } catch (error) {
      this.logger.error("Errore durante l'avvio del nodo:", error);
      throw error;
    }
  }

  async stop() {
    try {
      this.logger.info('Arresto del nodo Drakon...');

      // Ferma il server API
      if (this.apiServer && this.config.api?.enabled !== false) {
        await this.apiServer.stop();
      }

      // Ferma il miner
      if (this.miner && this.miner.isMining) {
        await this.miner.stop();
      }

      // Ferma il gossip manager
      if (this.gossipManager) {
        await this.gossipManager.stop();
      }

      // Ferma il sync manager
      if (this.syncManager) {
        await this.syncManager.stop();
      }

      // Ferma il network manager
      if (this.networkManager) {
        await this.networkManager.stop();
      }

      // Chiudi il database
      if (this.blockchainDB) {
        await this.blockchainDB.close();
      }

      this.isRunning = false;
      this.logger.info('Nodo Drakon arrestato con successo!');
    } catch (error) {
      this.logger.error("Errore durante l'arresto del nodo:", error);
      throw error;
    }
  }

  _setupEventHandlers() {
    // Eventi di rete
    this.networkManager.on('peer:discovery', peer => {
      this.emit('peer:discovery', peer);
    });

    this.networkManager.on('peer:connect', peer => {
      this.emit('peer:connect', peer);
    });

    this.networkManager.on('peer:disconnect', peer => {
      this.emit('peer:disconnect', peer);
    });

    // Eventi blockchain
    this.blockchain.on('block:new', block => {
      this.emit('block:new', block);
    });

    this.blockchain.on('block:reorg', blocks => {
      this.emit('block:reorg', blocks);
    });

    // Eventi transazioni
    this.mempool.on('transaction:new', transaction => {
      this.emit('transaction:new', transaction);
    });

    this.mempool.on('transaction:confirmed', transaction => {
      this.emit('transaction:confirmed', transaction);
    });

    // Eventi mining
    this.miner.on('block:mined', block => {
      this.emit('block:mined', block);
    });

    // Eventi sync
    this.syncManager.on('sync:start', () => {
      this.emit('sync:start');
    });

    this.syncManager.on('sync:end', () => {
      this.emit('sync:end');
    });

    this.syncManager.on('sync:error', error => {
      this.emit('sync:error', error);
    });
  }

  // Metodi per l'API
  async getNetworkStats() {
    try {
      return {
        peers: this.peerManager ? this.peerManager.getPeers() : [],
        connections: this.networkManager ? this.networkManager.getConnections() : 0,
        uptime: this._getUptime()
      };
    } catch (error) {
      this.logger.error('Errore nel recupero delle statistiche di rete:', error);
      return {
        peers: [],
        connections: 0,
        uptime: this._getUptime(),
        error: error.message
      };
    }
  }

  async getBlockchainStatus() {
    try {
      return {
        height: this.blockchain ? this.blockchain.getHeight() : 0,
        hash: this.blockchain ? this.blockchain.getLatestBlockHash() : null,
        difficulty: this.blockchain
          ? this.blockchain.getDifficulty()
          : this.config.blockchain.difficulty,
        mempoolSize: this.mempool ? this.mempool.getSize() : 0
      };
    } catch (error) {
      this.logger.error('Errore nel recupero dello stato della blockchain:', error);
      return {
        height: 0,
        hash: null,
        difficulty: this.config.blockchain.difficulty,
        mempoolSize: 0,
        error: error.message
      };
    }
  }

  async getWalletBalance(address) {
    try {
      return this.wallet ? await this.wallet.getBalance(address) : 0;
    } catch (error) {
      this.logger.error(`Errore nel recupero del saldo per l'indirizzo ${address}:`, error);
      return 0;
    }
  }

  async createTransaction(to, amount) {
    try {
      return this.wallet ? await this.wallet.createTransaction(to, amount) : null;
    } catch (error) {
      this.logger.error('Errore nella creazione della transazione:', error);
      throw error;
    }
  }

  async broadcastTransaction(transaction) {
    try {
      return this.gossipManager
        ? await this.gossipManager.broadcastTransaction(transaction)
        : false;
    } catch (error) {
      this.logger.error('Errore nella diffusione della transazione:', error);
      return false;
    }
  }

  _getUptime() {
    return process.uptime();
  }
}
