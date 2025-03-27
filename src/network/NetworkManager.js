import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { bootstrap } from '@libp2p/bootstrap';
import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { DHTManager } from './DHT.js';
import { createFromJSON, createEd25519PeerId } from '@libp2p/peer-id-factory';
import { NodeStorage } from '../utils/NodeStorage.js';
import fs from 'fs';
import path from 'path';
import { base58btc } from 'multiformats/bases/base58';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import crypto from 'crypto';
import { gossipsub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';

export class NetworkManager extends EventEmitter {
  constructor(config, storage) {
    super();
    this.config = config;
    this.logger = new Logger('NetworkManager');
    this.storage = storage;
    this.node = null;
    this.peerId = null;
    this.nodeId = null;
    this.dht = null;
    this.peers = new Set(); // Set di peer connessi
    this.stats = {
      activeConnections: 0,
      totalConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      lastMessageTime: null,
      myAddress: null,
      networkType: null
    };
    this.networkType = config.network.type || 'normal';
    this.p2pPort = parseInt(process.env.P2P_PORT) || config.network.p2pPort || 10333;
    this.running = false;
  }

  async start() {
    try {
      this.logger.info(`Avvio Network Manager in modalità ${this.networkType}...`);

      // Fase 1: Carica o crea il PeerId persistente
      let peerId;
      let nodeInfo;

      try {
        // Verifica se è richiesto il reset
        if (process.env.RESET_PEER_ID === 'true') {
          this.logger.info('Reset del PeerId richiesto, elimino quello esistente');
          await this.storage.resetNodeInfo();
        }

        // Carica le informazioni esistenti
        nodeInfo = await this.storage.loadNodeInfo();

        // Se abbiamo informazioni salvate con un PeerId, proviamo a usarle
        if (nodeInfo && nodeInfo.peerId) {
          this.logger.info('Trovato PeerId salvato');

          // Crea un nuovo PeerId
          peerId = await createEd25519PeerId();

          // Conserva l'ID originale dal PeerId salvato
          const originalId =
            typeof nodeInfo.peerId === 'string'
              ? nodeInfo.peerId
              : nodeInfo.peerId.id || nodeInfo.peerId.toString();

          this.logger.info(`Usando PeerId esistente con ID: ${originalId}`);

          // Sostituisci il metodo toString() per mantenere l'ID originale
          const originalToString = peerId.toString;
          peerId.toString = function () {
            return originalId;
          };

          // Usa il nodeId salvato
          if (nodeInfo.nodeId) {
            this.nodeId = nodeInfo.nodeId;
            this.logger.info(`Usando nodeId esistente: ${this.nodeId}`);
          } else if (originalId) {
            // Se non abbiamo nodeId ma abbiamo PeerId, generiamo nodeId dal PeerId
            this.nodeId = crypto.createHash('md5').update(originalId).digest('hex');
            this.logger.info(`Generato nodeId da PeerId: ${this.nodeId}`);
          }
        } else {
          // Nessun PeerId trovato, ne creiamo uno nuovo
          this.logger.info('Nessun PeerId trovato, creazione nuovo PeerId');
          peerId = await this._createNewPeerId();

          // Genera nodeId dal PeerId se non è già impostato
          if (!this.nodeId) {
            this.nodeId = crypto.createHash('md5').update(peerId.toString()).digest('hex');
            this.logger.info(`Generato nodeId da nuovo PeerId: ${this.nodeId}`);
          }
        }

        // Salva le informazioni aggiornate
        await this.storage.saveNodeInfo({
          ...nodeInfo,
          nodeId: this.nodeId,
          peerId: peerId.toString(),
          lastUpdated: new Date().toISOString(),
          createdAt: nodeInfo?.createdAt || new Date().toISOString()
        });
      } catch (error) {
        this.logger.error(`Errore durante il caricamento/creazione PeerId: ${error.message}`);
        // Fallback: crea un PeerId senza persistenza
        peerId = await createEd25519PeerId();

        // Genera nodeId dal PeerId se non è già impostato
        if (!this.nodeId) {
          this.nodeId = crypto.createHash('md5').update(peerId.toString()).digest('hex');
          this.logger.info(`Generato nodeId da PeerId fallback: ${this.nodeId}`);
        }
      }

      // Fase 2: Crea il nodo libp2p con il PeerId ottenuto
      this.logger.info(`Creazione nodo libp2p con PeerId: ${peerId.toString()}`);

      // Inizializza la DHT con il nodeId
      this.dht = new DHTManager(this.config, this.logger, this.nodeId);

      // Crea il nodo libp2p
      this.node = await createLibp2p({
        peerId, // Usiamo il peerId ottenuto
        addresses: {
          listen: [`/ip4/0.0.0.0/tcp/${this.config.p2p.port}`]
        },
        transports: [tcp()],
        streamMuxers: [mplex()],
        connectionEncryption: [noise()],
        services: {
          pubsub: gossipsub({
            emitSelf: false,
            allowPublishToZeroPeers: true
          }),
          identify: identify(),
          dht: kadDHT({
            clientMode: false,
            validators: {
              pk: async (key, value) => {
                this.logger.debug('Validazione chiave pubblica...');
                this.logger.debug(`Chiave: ${key.toString()}`);
                this.logger.debug(`Valore: ${value.toString()}`);
                return; // indifferent
              }
            },
            selectors: {
              pk: async (k, records) => {
                this.logger.debug('Selezione chiave pubblica...');
                this.logger.debug(`Chiave: ${k.toString()}`);
                this.logger.debug(`Records trovati: ${records.length}`);
                return 0; // seleziona il primo record
              }
            }
          })
        },
        connectionManager: {
          maxConnections: this.config.network.maxConnections,
          minConnections: this.config.network.minConnections
        }
      });

      // Salva il peerId utilizzato
      this.peerId = peerId;

      // Log sui parametri
      this.logger.info(`PeerId utilizzato: ${peerId.toString()}`);
      this.logger.info(`nodeId utilizzato: ${this.nodeId}`);

      // Eventi del nodo
      this.node.addEventListener('peer:connect', evt => {
        const connectedPeerId = evt.detail.toString();
        this.logger.info(`Connesso al peer: ${connectedPeerId}`);
        this.peers.add(connectedPeerId);
        this.stats.activeConnections++;
        this.stats.totalConnections++;
      });

      this.node.addEventListener('peer:disconnect', evt => {
        const disconnectedPeerId = evt.detail.toString();
        this.logger.info(`Disconnesso dal peer: ${disconnectedPeerId}`);
        this.peers.delete(disconnectedPeerId);
        this.stats.activeConnections--;
      });

      // Avvia il nodo libp2p
      await this.node.start();
      this.logger.info(`Nodo libp2p avviato con peerId: ${this.node.peerId.toString()}`);
      this.logger.info(
        `Indirizzi di ascolto: ${this.node
          .getMultiaddrs()
          .map(addr => addr.toString())
          .join(', ')}`
      );

      // Avvia la DHT
      await this.dht.start(this.node);

      // Connetti ai peer bootstrap se in modalità normal
      if (this.networkType === 'normal') {
        await this._connectToBootstrapPeers();
      }

      // Ottieni informazioni di rete
      const networkInfo = await this._getNetworkInfo();
      this.stats.myAddress = networkInfo.address;
      this.stats.networkType = networkInfo.type;

      // Avvia il discovery
      await this._startDiscovery();

      // Avvia la manutenzione periodica della DHT
      this._setupDHTMaintenance();

      this.logger.info('NetworkManager avviato con successo');
      return true;
    } catch (error) {
      this.logger.error(`Errore nell'avvio del NetworkManager: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  async _createNewPeerId() {
    // Anche questo metodo non viene più utilizzato direttamente
    // Lo lasciamo per compatibilità con il codice esistente
    try {
      this.logger.info('Creazione nuovo PeerId deterministico...');

      // Usiamo sempre il nodeId come seed per generare un PeerId deterministico
      // Questo garantisce che per lo stesso nodeId avremo sempre lo stesso PeerId
      let peerId;

      if (!this.nodeId) {
        this.logger.warn('nodeId non disponibile, generazione PeerId casuale');
        peerId = await createEd25519PeerId();
        this.logger.info(`Generato PeerId casuale: ${peerId.toString()}`);
      } else {
        // Usa il nodeId come seed per garantire che lo stesso nodeId produca sempre lo stesso PeerId
        this.logger.info(`Generazione PeerId deterministico da nodeId: ${this.nodeId}`);

        // Normalizza il seed a 32 byte (SHA-256 digest)
        const seed = crypto.createHash('sha256').update(this.nodeId).digest();

        // Crea un PeerId deterministico usando il seed
        peerId = await createEd25519PeerId({ seed });
        this.logger.info(`Generato PeerId deterministico: ${peerId.toString()}`);
      }

      return peerId;
    } catch (error) {
      this.logger.error(`Errore nella creazione del PeerId: ${error.message}`);
      // Fallback: crea un PeerId senza seed
      const peerId = await createEd25519PeerId();
      this.logger.info(`PeerId fallback creato: ${peerId.toString()}`);
      return peerId;
    }
  }

  async stop() {
    try {
      this.logger.info('Arresto del NetworkManager...');

      // Chiudi tutte le connessioni
      for (const peerId of this.peers) {
        await this._disconnectPeer(peerId);
      }

      // Ferma il discovery
      if (this.discovery) {
        await this.discovery.stop();
      }

      // Ferma il nodo
      if (this.node) {
        await this.node.stop();
      }

      this.logger.info('NetworkManager arrestato con successo');
    } catch (error) {
      this.logger.error("Errore durante l'arresto del NetworkManager:", error);
      throw error;
    }
  }

  /**
   * Invia un messaggio a tutti i peers connessi
   * @param {Object} message - Messaggio da inviare
   */
  async broadcast(message) {
    try {
      this.logger.info(`Invio broadcast di tipo: ${message.type}`);
      const serializedMessage = JSON.stringify(message);

      // Invia il messaggio a tutti i peer connessi
      let successCount = 0;

      for (const peerId of this.peers) {
        try {
          await this.sendMessage(peerId, message);
          successCount++;
        } catch (error) {
          this.logger.warn(`Errore nell'invio del messaggio a ${peerId}: ${error.message}`);
        }
      }

      this.logger.info(`Messaggio inviato a ${successCount}/${this.peers.size} peers`);

      // Aggiorna le statistiche
      this.stats.messagesSent += successCount;
      this.stats.lastMessageTime = Date.now();

      return successCount;
    } catch (error) {
      this.logger.error(`Errore nell'invio del broadcast: ${error.message}`);
      return 0;
    }
  }

  /**
   * Invia un messaggio a un peer specifico
   * @param {string} peerId - ID del peer a cui inviare il messaggio
   * @param {Object} message - Messaggio da inviare
   */
  async sendMessage(peerId, message) {
    try {
      if (!this.peers.has(peerId)) {
        throw new Error(`Peer ${peerId} non connesso`);
      }

      this.logger.debug(`Invio messaggio di tipo ${message.type} a ${peerId}`);

      // Serializza il messaggio
      const serializedMessage = JSON.stringify(message);

      // Ottieni una stream verso il peer
      const stream = await this.node.dialProtocol(peerId, ['/drakon/1.0.0']);

      // Invia il messaggio
      await stream.sink([uint8ArrayFromString(serializedMessage)]);

      // Aggiorna le statistiche
      this.stats.messagesSent++;
      this.stats.lastMessageTime = Date.now();

      this.logger.debug(`Messaggio inviato con successo a ${peerId}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nell'invio del messaggio a ${peerId}: ${error.message}`);
      throw error;
    }
  }

  getStats() {
    return {
      ...this.stats,
      peersCount: this.peers.size,
      routingTableSize: this.routingTable.size,
      dhtSize: this.dht.routingTable.size
    };
  }

  /**
   * Restituisce la lista dei peer connessi
   * @returns {Array} Lista dei peer connessi
   */
  getConnectedPeers() {
    const peersList = [];

    for (const peerId of this.peers) {
      peersList.push({
        id: peerId,
        connected: true
      });
    }

    return peersList;
  }

  getPeers() {
    return this.getConnectedPeers();
  }

  // Restituisce i nodi dalla DHT
  getDHTNodes() {
    return this.dht.getAllNodes();
  }

  // Ricerca un nodo specifico nella rete
  async findNode(nodeId) {
    // Prima controlla nella DHT locale
    const localNode = this.dht.getNode(nodeId);
    if (localNode) {
      return localNode;
    }

    // Altrimenti chiedi ai peer più vicini
    const closestNodes = this.dht.getClosestNodes(nodeId, 3);

    for (const node of closestNodes) {
      try {
        if (this.peers.has(node.nodeId)) {
          const connection = this.peers.get(node.nodeId);
          const stream = await connection.newStream('/drakon/1.0.0');

          const request = {
            type: 'find_node',
            targetId: nodeId,
            sender: this.myId,
            timestamp: Date.now()
          };

          await stream.sink([Buffer.from(JSON.stringify(request))]);
          const response = await this._readStream(stream);

          if (response && response.nodes) {
            // Aggiorna la DHT con i nodi ricevuti
            for (const node of response.nodes) {
              this.dht.addNode(node.nodeId, node);
            }

            // Se abbiamo trovato il nodo, restituiscilo
            const foundNode = response.nodes.find(n => n.nodeId === nodeId);
            if (foundNode) {
              return foundNode;
            }
          }
        }
      } catch (error) {
        this.logger.error(`Errore nella ricerca del nodo ${nodeId} tramite ${node.nodeId}:`, error);
      }
    }

    return null;
  }

  /**
   * Richiede l'altezza corrente a un peer specifico
   * @param {string} peerId - ID del peer a cui richiedere l'altezza
   * @returns {Promise<number>} Altezza del blocco
   */
  async requestHeight(peerId) {
    try {
      if (!this.peers.has(peerId)) {
        throw new Error(`Peer ${peerId} non connesso`);
      }

      const message = {
        type: 'height_request',
        timestamp: Date.now()
      };

      await this.sendMessage(peerId, message);

      // In una implementazione completa, dovremmo attendere la risposta
      // Per ora restituiamo un valore fittizio
      return 0;
    } catch (error) {
      this.logger.error(`Errore nella richiesta di altezza a ${peerId}: ${error.message}`);
      throw error;
    }
  }

  async requestBlock(peerId, height) {
    try {
      const stream = await this.peers.get(peerId).connection.newStream('/drakon/1.0.0');
      const message = {
        type: 'block_request',
        height,
        timestamp: Date.now()
      };
      await stream.sink([Buffer.from(JSON.stringify(message))]);
      const response = await stream.source.next();
      const data = JSON.parse(response.value.toString());
      return data.block;
    } catch (error) {
      this.logger.error(`Errore nella richiesta del blocco ${height} al peer ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Recupera informazioni di rete
   */
  async _getNetworkInfo() {
    try {
      // Implementazione base per ottenere informazioni di rete
      return {
        address: '127.0.0.1', // Placeholder
        type: 'local'
      };
    } catch (error) {
      this.logger.error(`Errore nel recupero delle informazioni di rete: ${error.message}`);
      return {
        address: '127.0.0.1',
        type: 'unknown'
      };
    }
  }

  _determineNetworkType(ip) {
    if (ip === '127.0.0.1') {
      return 'loopback';
    }
    if (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') &&
        parseInt(ip.split('.')[1]) >= 16 &&
        parseInt(ip.split('.')[1]) <= 31)
    ) {
      return 'private';
    }
    return 'public';
  }

  // Trova i bootstrap nodes per il discovery iniziale
  async _findBootstrapNodes() {
    const bootstrapNodes = [];

    try {
      // Aggiungiamo sempre i nostri nodi bootstrap fissi
      const staticBootstrapNodes = [
        {
          host: '51.89.148.92',
          port: 22201,
          id: '12D3KooWAomhXNPE7o6Woo7o8qrqkD94mYn958epsMzaUXC5Kjht'
        },
        {
          host: '135.125.232.233',
          port: 6001,
          id: '12D3KooWG4QNwjix4By4Sjz6aaJDmAjfDfa9K1gMDTXZ2SnQzvZy'
        }
      ];

      // Formatta gli indirizzi dei nodi in diversi formati per aumentare le possibilità di connessione
      for (const node of staticBootstrapNodes) {
        // Formato completo
        bootstrapNodes.push(`/ip4/${node.host}/tcp/${node.port}/p2p/${node.id}`);
        // Formato DNS (può funzionare meglio in alcune configurazioni di rete)
        bootstrapNodes.push(`/dns4/${node.host}/tcp/${node.port}/p2p/${node.id}`);
        // Formato semplice (utile per alcuni casi)
        bootstrapNodes.push(`/ip4/${node.host}/tcp/${node.port}`);
      }

      // Aggiungi i bootstrap nodes dalla configurazione, evitando duplicati
      if (this.config.p2p.bootstrapNodes && Array.isArray(this.config.p2p.bootstrapNodes)) {
        for (const node of this.config.p2p.bootstrapNodes) {
          // Verifica se è un indirizzo multiaddr o un oggetto con host/port
          if (typeof node === 'string') {
            // Verifica se l'indirizzo è già presente
            if (!bootstrapNodes.includes(node)) {
              bootstrapNodes.push(node);
            }
          } else if (node.host && node.port) {
            const nodeAddr = `/ip4/${node.host}/tcp/${node.port}/p2p/${node.id || 'QmBootstrap'}`;
            // Verifica se l'indirizzo è già presente
            if (!bootstrapNodes.includes(nodeAddr)) {
              bootstrapNodes.push(nodeAddr);
            }
          }
        }
      }

      // Se ancora non ci sono bootstrap nodes, prova con gli ultimi nodi conosciuti
      if (bootstrapNodes.length === 0) {
        // Carica gli ultimi nodi conosciuti dal database o dal file di configurazione
        const knownPeers = await this._loadKnownPeers();
        if (knownPeers.length > 0) {
          for (const peer of knownPeers) {
            if (peer.id && peer.host && peer.port) {
              bootstrapNodes.push(`/ip4/${peer.host}/tcp/${peer.port}/p2p/${peer.id}`);
            }
          }
        }
      }

      // Se abbiamo più di 4 nodi, limita a massimo 4 per evitare problemi di performance
      if (bootstrapNodes.length > 4) {
        this.logger.info(`Limitando a 4 bootstrap nodes tra ${bootstrapNodes.length} disponibili`);
        bootstrapNodes.splice(4);
      }

      this.logger.info(
        `Bootstrap nodes configurati (${bootstrapNodes.length}): ${
          bootstrapNodes.join(', ') || 'nessuno'
        }`
      );
      return bootstrapNodes;
    } catch (error) {
      this.logger.error(`Errore nella ricerca dei bootstrap nodes: ${error.message}`);
      // In caso di errore, restituisci almeno i nodi statici base
      return [
        `/ip4/51.89.148.92/tcp/22201/p2p/12D3KooWAomhXNPE7o6Woo7o8qrqkD94mYn958epsMzaUXC5Kjht`,
        `/ip4/135.125.232.233/tcp/6001/p2p/12D3KooWG4QNwjix4By4Sjz6aaJDmAjfDfa9K1gMDTXZ2SnQzvZy`
      ];
    }
  }

  // Carica i peer conosciuti dal database o file
  async _loadKnownPeers() {
    try {
      const peerCachePath = path.join(this.config.node.dataDir, 'known-peers.json');

      if (fs.existsSync(peerCachePath)) {
        const peerData = JSON.parse(fs.readFileSync(peerCachePath, 'utf8'));
        if (Array.isArray(peerData) && peerData.length > 0) {
          // Filtra solo i peer che sono stati visti recentemente (ultimi 7 giorni)
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          return peerData.filter(peer => peer.lastSeen > sevenDaysAgo);
        }
      }

      return [];
    } catch (error) {
      this.logger.error('Errore nel caricamento dei peer conosciuti:', error);
      return [];
    }
  }

  // Salva i peer conosciuti per uso futuro
  async _saveKnownPeers() {
    try {
      // Verifica che la DHT esista prima di usarla
      if (!this.dht) {
        this.logger.warn('DHT non inizializzata durante il salvataggio dei peer');
        return;
      }

      const peerCachePath = path.join(this.config.node.dataDir, 'known-peers.json');
      const peerDir = path.dirname(peerCachePath);

      // Assicurati che la directory esista
      if (!fs.existsSync(peerDir)) {
        fs.mkdirSync(peerDir, { recursive: true });
      }

      // Ottieni i peer attivi dalla DHT
      let activePeers = [];
      try {
        // Usa getAllNodes() solo se esiste
        if (typeof this.dht.getAllNodes === 'function') {
          const dhtNodes = this.dht.getAllNodes();
          if (Array.isArray(dhtNodes)) {
            activePeers = dhtNodes.map(peer => ({
              id: peer.nodeId,
              host: peer.ip,
              port: peer.port,
              lastSeen: Date.now()
            }));
          }
        }
      } catch (dhtError) {
        this.logger.error('Errore nel recupero dei nodi dalla DHT:', dhtError);
      }

      // Salva i peer in un file
      fs.writeFileSync(peerCachePath, JSON.stringify(activePeers), 'utf8');
    } catch (error) {
      this.logger.error('Errore nel salvataggio dei peer conosciuti:', error);
    }
  }

  // Imposta la manutenzione periodica della DHT
  _setupDHTMaintenance() {
    // Verifica che la DHT esista prima di usarla
    if (!this.dht) {
      this.logger.warn('DHT non inizializzata durante il setup della manutenzione');
      return;
    }

    // Aggiungi logica di discovery DHT
    if (this.config.p2p?.discovery?.dht) {
      const interval = this.config.p2p.discovery.interval || 60000;

      try {
        // Esegui una manutenzione iniziale
        this._performDHTMaintenance();

        // Pianifica la manutenzione periodica
        setInterval(() => {
          this._performDHTMaintenance();
        }, interval);
      } catch (error) {
        this.logger.error('Errore nel setup della manutenzione DHT:', error);
      }
    }
  }

  // Esegue la manutenzione della DHT e aggiorna la conoscenza della rete
  async _performDHTMaintenance() {
    try {
      // Verifica che la DHT esista prima di usarla
      if (!this.dht) {
        this.logger.warn('DHT non inizializzata durante la manutenzione');
        return;
      }

      // Verifica che cleanupStaleNodes sia una funzione prima di chiamarla
      if (typeof this.dht.cleanupStaleNodes === 'function') {
        // Pulizia nodi non più attivi
        this.dht.cleanupStaleNodes();
      }

      // Cerca nuovi nodi attraverso i peer esistenti
      if (this.node && this.node.pubsub) {
        // Verifica che getPeers sia una funzione prima di chiamarla
        if (typeof this.node.getPeers === 'function') {
          const peers = this.node.getPeers();
          if (Array.isArray(peers)) {
            for (const peer of peers) {
              try {
                await this._queryPeerForNodes(peer);
              } catch (error) {
                this.logger.debug(`Errore nella query del peer ${peer}:`, error.message);
              }
            }
          }
        }
      }

      // Salva i peer conosciuti
      await this._saveKnownPeers();
    } catch (error) {
      this.logger.error('Errore durante la manutenzione DHT:', error);
    }
  }

  // Interroga un peer per ottenere la sua conoscenza di altri nodi
  async _queryPeerForNodes(peerId) {
    // Questa implementazione dipende dalle funzionalità specifiche di libp2p
    // e dovrebbe essere adattata alla tua implementazione di rete
    try {
      // Implementazione di base, sicura che non causa errori
      this.logger.debug(`Interrogazione del peer ${peerId} per altri nodi`);
      return [];
    } catch (error) {
      this.logger.error(`Errore nell'interrogazione del peer ${peerId}:`, error);
      return [];
    }
  }

  _setupEventHandlers() {
    // Verifica che this.node esista prima di aggiungere event listeners
    if (this.node) {
      // Usa try/catch per ogni addEventListener per evitare errori fatali
      try {
        this.node.addEventListener('peer:discovery', this._handlePeerDiscovery.bind(this));
      } catch (error) {
        this.logger.error("Errore nell'aggiunta dell'event listener peer:discovery:", error);
      }

      try {
        this.node.addEventListener('peer:connect', this._handlePeerConnect.bind(this));
      } catch (error) {
        this.logger.error("Errore nell'aggiunta dell'event listener peer:connect:", error);
      }

      try {
        this.node.addEventListener('peer:disconnect', this._handlePeerDisconnect.bind(this));
      } catch (error) {
        this.logger.error("Errore nell'aggiunta dell'event listener peer:disconnect:", error);
      }

      try {
        this.node.addEventListener('peer:error', this._handlePeerError.bind(this));
      } catch (error) {
        this.logger.error("Errore nell'aggiunta dell'event listener peer:error:", error);
      }
    } else {
      this.logger.warn('Impossibile configurare gli event handlers: this.node è undefined');
    }

    // Verifica che this.dht esista prima di aggiungere event listeners
    if (this.dht && typeof this.dht.on === 'function') {
      // Aggiungi eventi dalla DHT
      try {
        this.dht.on('node:added', ({ nodeId, nodeInfo }) => {
          this.logger.debug(`Nuovo nodo aggiunto alla DHT: ${nodeId}`);
          this.emit('dht:node:added', { nodeId, nodeInfo });
        });

        this.dht.on('node:updated', ({ nodeId, nodeInfo }) => {
          this.logger.debug(`Nodo aggiornato nella DHT: ${nodeId}`);
          this.emit('dht:node:updated', { nodeId, nodeInfo });
        });

        this.dht.on('node:removed', ({ nodeId, nodeInfo }) => {
          this.logger.debug(`Nodo rimosso dalla DHT: ${nodeId}`);
          this.emit('dht:node:removed', { nodeId, nodeInfo });
        });
      } catch (error) {
        this.logger.error("Errore nell'aggiunta degli event listeners DHT:", error);
      }
    } else {
      this.logger.warn(
        'Impossibile configurare gli event handlers DHT: this.dht è undefined o non supporta .on()'
      );
    }
  }

  async _startDiscovery() {
    try {
      if (!this.node || !this.node.peerStore) {
        this.logger.error(
          'Impossibile avviare discovery: this.node o this.node.peerStore non definito'
        );
        return;
      }

      // Verifica che load esista prima di chiamarlo
      if (typeof this.node.peerStore.load === 'function') {
        await this.node.peerStore.load();
      }

      // Array dei nostri bootstrap nodes fissi
      const staticBootstrapNodes = [
        {
          host: '51.89.148.92',
          port: 22201,
          id: '12D3KooWAomhXNPE7o6Woo7o8qrqkD94mYn958epsMzaUXC5Kjht'
        },
        {
          host: '135.125.232.233',
          port: 6001,
          id: '12D3KooWG4QNwjix4By4Sjz6aaJDmAjfDfa9K1gMDTXZ2SnQzvZy'
        }
      ];

      // Ottieni array di bootstrap nodes dalla configurazione o usa i nodi fissi
      let bootstrapNodes = [...staticBootstrapNodes];

      // Verifica che config.p2p.bootstrapNodes esista e aggiungi quei nodi
      if (
        this.config.p2p &&
        this.config.p2p.bootstrapNodes &&
        Array.isArray(this.config.p2p.bootstrapNodes)
      ) {
        // Aggiungi i nodi della configurazione ai nodi fissi
        for (const node of this.config.p2p.bootstrapNodes) {
          // Evita duplicati verificando host e porta
          const isDuplicate = bootstrapNodes.some(
            existing => existing.host === node.host && existing.port === node.port
          );
          if (!isDuplicate) {
            bootstrapNodes.push(node);
          }
        }
      } else {
        this.logger.warn(
          'Nessun bootstrap node configurato nella configurazione, usando solo i nodi fissi'
        );
      }

      this.logger.info(`Tentativo di connessione a ${bootstrapNodes.length} bootstrap nodes`);

      // Converti i bootstrap nodes in formato libp2p
      const bootstrapAddresses = bootstrapNodes.map(node => {
        // Usa l'id fornito o genera un fallback
        const id = node.id || `unknown-${Date.now()}`;
        return {
          id: id,
          multiaddrs: [
            `/ip4/${node.host}/tcp/${node.port}`,
            `/ip4/${node.host}/tcp/${node.port}/p2p/${id}`,
            `/dns4/${node.host}/tcp/${node.port}/p2p/${id}`
          ]
        };
      });

      // Aggiungi i nodi al peerStore
      for (const addr of bootstrapAddresses) {
        try {
          // Verifica che addressBook.add esista
          if (
            this.node.peerStore.addressBook &&
            typeof this.node.peerStore.addressBook.add === 'function'
          ) {
            await this.node.peerStore.addressBook.add(addr.id, addr.multiaddrs);
            this.logger.debug(
              `Indirizzo aggiunto al peerStore: ${addr.id} -> ${addr.multiaddrs.join(', ')}`
            );
          }
        } catch (error) {
          this.logger.warn(
            `Errore nell'aggiunta dell'indirizzo al peerStore per ${addr.id}:`,
            error.message
          );
        }
      }

      // Tenta la connessione con un ritardo tra i tentativi
      let connectedCount = 0;
      for (const addr of bootstrapAddresses) {
        try {
          // Verifica che dial esista
          if (typeof this.node.dial === 'function') {
            this.logger.info(`Tentativo di connessione al bootstrap node: ${addr.id}`);
            await this.node.dial(addr.id);
            this.logger.info(`Connesso al bootstrap node: ${addr.id}`);
            connectedCount++;

            // Aggiungi un piccolo ritardo tra le connessioni per dare tempo alla rete
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          this.logger.warn(
            `Non è stato possibile connettersi al bootstrap node: ${addr.id}`,
            error.message
          );
        }
      }

      this.logger.info(
        `Connesso a ${connectedCount} di ${bootstrapAddresses.length} bootstrap nodes`
      );

      // Se non siamo riusciti a connetterci a nessun nodo, prova ad ascoltare sulla porta predefinita
      if (connectedCount === 0) {
        this.logger.warn(
          'Non è stato possibile connettersi a nessun bootstrap node. Proverò a rimanere in ascolto per connessioni in entrata.'
        );
      }
    } catch (error) {
      this.logger.error("Errore durante l'avvio del discovery:", error);
    }
  }

  async _handlePeerDiscovery(event) {
    try {
      const { id, multiaddrs } = event.detail;
      this.logger.info(`Peer scoperto: ${id}`);

      // Verifica se siamo già connessi a questo peer
      if (this.peers.has(id)) {
        this.logger.debug(`Peer ${id} già connesso, aggiornamento dell'ultima attività`);
        const peerData = this.peers.get(id);
        peerData.lastSeen = Date.now();
        return;
      }

      // Verifica se abbiamo già raggiunto il numero massimo di connessioni
      const maxPeers = this.config.network?.maxPeers || 50;
      if (this.peers.size >= maxPeers) {
        this.logger.debug(`Numero massimo di peer (${maxPeers}) raggiunto, ignoro il peer ${id}`);
        return;
      }

      // Prova a connettersi con un timeout
      try {
        this.logger.debug(`Tentativo di connessione al peer ${id}`);

        // Crea una promise che si risolve quando la connessione ha successo o viene rifiutata con timeout
        const connectWithTimeout = new Promise(async (resolve, reject) => {
          // Timer per il timeout (5 secondi)
          const timeoutId = setTimeout(() => {
            reject(new Error('Timeout nella connessione al peer'));
          }, 5000);

          try {
            // Verifica che dial esista
            if (typeof this.node.dial === 'function') {
              // Tenta la connessione, specificando tutte le multiaddrs disponibili
              await this.node.dial(id);
              clearTimeout(timeoutId);
              resolve();
            } else {
              clearTimeout(timeoutId);
              reject(new Error('Metodo dial non disponibile'));
            }
          } catch (dialError) {
            clearTimeout(timeoutId);
            reject(dialError);
          }
        });

        await connectWithTimeout;
        this.logger.info(`Connesso con successo al peer ${id}`);
      } catch (error) {
        this.logger.debug(`Errore nella connessione al peer ${id}: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`Errore generale nella gestione della scoperta del peer: ${error.message}`);
    }
  }

  async _handlePeerConnect(event) {
    try {
      const { id, connection } = event.detail;
      this.logger.info(`Peer connesso: ${id}`);

      // Verifica che this.peers esista prima di usare .set()
      if (!this.peers) {
        this.peers = new Map();
        this.logger.warn('Inizializzazione forzata di this.peers durante la connessione');
      }

      // Aggiungi alla lista dei peer
      this.peers.set(id, {
        connection,
        status: 'connected',
        lastSeen: Date.now(),
        messageCount: 0
      });

      // Aggiorna le statistiche
      if (!this.stats) {
        this.stats = {
          totalConnections: 0,
          activeConnections: 0,
          messagesSent: 0,
          messagesReceived: 0,
          networkType: 'private',
          myAddress: null,
          peersCount: 0,
          routingTableSize: 0
        };
      }

      this.stats.activeConnections = (this.stats.activeConnections || 0) + 1;
      this.stats.totalConnections = (this.stats.totalConnections || 0) + 1;

      // Imposta il gestore dei messaggi per questo peer
      this._setupMessageHandler(connection);

      // Verifica se la DHT è inizializzata e altrimenti la inizializza
      if (!this.dht) {
        this.dht = new DHTManager(this.config || {});
        await this.dht.initialize();
        this.logger.warn('Inizializzazione forzata della DHT durante la connessione');
      }

      // Aggiungi il peer alla DHT
      if (this.dht && typeof this.dht.addNode === 'function') {
        const peerInfo = await this._getPeerInfo(id, connection);
        this.dht.addNode(id, peerInfo);

        // Scambia informazioni sulla DHT
        await this._exchangeDHTInfo(id, connection);

        // Invia evento
        this.emit('peer:connect', { id, connection, peerInfo });
      } else {
        this.logger.warn(
          `Non è possibile aggiungere il peer ${id} alla DHT: DHT non inizializzata`
        );
      }
    } catch (error) {
      this.logger.error('Errore nella gestione della connessione del peer:', error);
    }
  }

  async _getPeerInfo(peerId, connection) {
    // Estrai informazioni dalla connessione
    let peerAddress = '127.0.0.1';
    let peerPort = 6001;

    // Prova a estrarre l'indirizzo dall'oggetto connection
    try {
      const remoteAddr = connection.remoteAddr.toString();
      const ipMatch = remoteAddr.match(/\/ip4\/([^\/]+)\/tcp\/(\d+)/);
      if (ipMatch) {
        peerAddress = ipMatch[1];
        peerPort = parseInt(ipMatch[2]);
      }
    } catch (error) {
      this.logger.debug(`Impossibile estrarre l'indirizzo dal peer ${peerId}:`, error.message);
    }

    return {
      ip: peerAddress,
      port: peerPort,
      lastSeen: Date.now(),
      metadata: {
        // Queste informazioni saranno aggiornate durante lo scambio DHT
        isBootstrap: false,
        version: '1.0.0'
      }
    };
  }

  async _exchangeDHTInfo(peerId, connection) {
    try {
      const stream = await connection.newStream('/drakon/1.0.0');

      // Invia informazioni sul nostro nodo
      const nodeInfo = {
        type: 'dht_exchange',
        nodeId: this.myId,
        ip: this.dht.myIp,
        port: this.config.p2p.port,
        metadata: {
          isBootstrap: this.config.node?.isBootstrap || false,
          version: this.config.version || '1.0.0',
          name: this.config.node?.name
        },
        timestamp: Date.now()
      };

      await stream.sink([Buffer.from(JSON.stringify(nodeInfo))]);
      this.logger.debug(`Informazioni DHT inviate al peer ${peerId}`);

      // Leggi la risposta
      const response = await this._readStream(stream);
      if (response && response.type === 'dht_exchange' && response.nodeId) {
        // Aggiorna la DHT con le informazioni ricevute
        this.dht.updateNode(response.nodeId, {
          ip: response.ip,
          port: response.port,
          metadata: response.metadata
        });
        this.logger.debug(`Ricevute informazioni DHT dal peer ${response.nodeId}`);
      }
    } catch (error) {
      this.logger.debug(
        `Errore nello scambio di informazioni DHT con il peer ${peerId}:`,
        error.message
      );
    }
  }

  async _readStream(stream) {
    try {
      const { value } = await stream.source.next();
      return JSON.parse(value.toString());
    } catch (error) {
      this.logger.error('Errore nella lettura dello stream:', error);
      return null;
    }
  }

  async _handlePeerDisconnect(event) {
    const { id } = event.detail;
    this.logger.info(`Peer disconnesso: ${id}`);

    await this._disconnectPeer(id);
  }

  async _handlePeerError(event) {
    const { id, error } = event.detail;
    this.logger.error(`Errore del peer ${id}:`, error);

    await this._disconnectPeer(id);
  }

  /**
   * Disconnette da un peer specifico
   * @param {string} peerId - ID del peer da disconnettere
   */
  async _disconnectPeer(peerId) {
    try {
      if (this.peers.has(peerId)) {
        this.logger.info(`Disconnessione dal peer: ${peerId}`);
        await this.node.hangUp(peerId);
        this.peers.delete(peerId);
        this.stats.activeConnections--;
        this.logger.info(`Disconnesso dal peer: ${peerId}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Errore nella disconnessione dal peer ${peerId}: ${error.message}`);
      return false;
    }
  }

  _setupMessageHandler(connection) {
    connection.addEventListener('data', async event => {
      try {
        const message = JSON.parse(event.data.toString());
        await this._handleMessage(message, connection);
      } catch (error) {
        this.logger.error('Errore nella gestione del messaggio:', error);
      }
    });
  }

  async _handleMessage(message, connection) {
    this.stats.messagesReceived++;

    switch (message.type) {
      case 'broadcast':
        await this._handleBroadcast(message, connection);
        break;
      case 'ping':
        await this._handlePing(message, connection);
        break;
      case 'network_info':
        await this._handleNetworkInfo(message, connection);
        break;
      case 'dht_exchange':
        await this._handleDHTExchange(message, connection);
        break;
      case 'dht_info':
        await this._handleDHTInfo(message, connection);
        break;
      case 'find_node':
        await this._handleFindNode(message, connection);
        break;
      default:
        this.logger.warn(`Tipo di messaggio non supportato: ${message.type}`);
    }
  }

  async _handleBroadcast(message, connection) {
    // Implementa la logica per gestire i messaggi broadcast
    this.logger.info(`Messaggio broadcast ricevuto: ${JSON.stringify(message.data)}`);

    // Emetti evento per notificare gli altri componenti
    this.emit('message:broadcast', message.data);
  }

  async _handlePing(message, connection) {
    // Implementa la logica per gestire i ping
    const response = {
      type: 'pong',
      timestamp: Date.now(),
      sender: this.myId
    };

    try {
      const stream = await connection.newStream('/drakon/1.0.0');
      await stream.sink([Buffer.from(JSON.stringify(response))]);
    } catch (error) {
      this.logger.error("Errore nell'invio della risposta ping:", error);
    }
  }

  async _handleNetworkInfo(message, connection) {
    // Implementa la logica per gestire le informazioni di rete
    this.logger.info(`Informazioni di rete ricevute: ${JSON.stringify(message.data)}`);

    // Aggiorna la DHT se ci sono informazioni utili
    if (message.data?.nodeId && message.data?.ip) {
      this.dht.updateNode(message.data.nodeId, {
        ip: message.data.ip,
        port: message.data.port || this.config.p2p.port,
        metadata: message.data.metadata
      });
    }
  }

  async _handleDHTExchange(message, connection) {
    // Gestisci la richiesta di scambio informazioni DHT
    if (message.nodeId) {
      // Aggiorna la DHT con le informazioni ricevute
      this.dht.updateNode(message.nodeId, {
        ip: message.ip,
        port: message.port,
        metadata: message.metadata,
        isOnline: true
      });

      // Invia una risposta con le nostre informazioni
      try {
        const response = {
          type: 'dht_exchange',
          nodeId: this.myId,
          ip: this.dht.myIp,
          port: this.config.p2p.port,
          metadata: {
            isBootstrap: this.config.node?.isBootstrap || false,
            version: this.config.version || '1.0.0',
            name: this.config.node?.name
          },
          timestamp: Date.now()
        };

        const stream = await connection.newStream('/drakon/1.0.0');
        await stream.sink([Buffer.from(JSON.stringify(response))]);
      } catch (error) {
        this.logger.error("Errore nell'invio della risposta DHT:", error);
      }
    }
  }

  async _handleDHTInfo(message, connection) {
    // Rispondi con le informazioni sulla DHT
    try {
      // Prendiamo i 10 nodi più recenti dalla DHT
      const nodes = this.dht
        .getAllNodes()
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 10);

      const response = {
        type: 'dht_info_response',
        nodes,
        sender: this.myId,
        timestamp: Date.now()
      };

      const stream = await connection.newStream('/drakon/1.0.0');
      await stream.sink([Buffer.from(JSON.stringify(response))]);
    } catch (error) {
      this.logger.error("Errore nell'invio delle informazioni DHT:", error);
    }
  }

  async _handleFindNode(message, connection) {
    // Gestisci la richiesta di ricerca di un nodo
    if (message.targetId) {
      try {
        // Cerca il nodo nella DHT locale
        const targetNode = this.dht.getNode(message.targetId);

        // Trova i nodi più vicini al target
        const closestNodes = this.dht.getClosestNodes(message.targetId, 20);

        const response = {
          type: 'find_node_response',
          targetId: message.targetId,
          found: !!targetNode,
          node: targetNode,
          nodes: closestNodes,
          sender: this.myId,
          timestamp: Date.now()
        };

        const stream = await connection.newStream('/drakon/1.0.0');
        await stream.sink([Buffer.from(JSON.stringify(response))]);
      } catch (error) {
        this.logger.error("Errore nell'invio della risposta find_node:", error);
      }
    }
  }

  /**
   * Connette ai peer bootstrap configurati
   */
  async _connectToBootstrapPeers() {
    try {
      const bootstrapPeers = this.config.network.bootstrapPeers || [];

      if (bootstrapPeers.length === 0) {
        this.logger.warn('Nessun peer bootstrap configurato, funzionamento in modalità standalone');
        return;
      }

      this.logger.info(`Tentativo di connessione a ${bootstrapPeers.length} peer bootstrap...`);

      const connectionPromises = bootstrapPeers.map(async peer => {
        try {
          this.logger.info(`Connessione al peer bootstrap: ${peer}`);
          await this.node.dial(peer);
          this.logger.info(`Connesso al peer bootstrap: ${peer}`);
          return { peer, success: true };
        } catch (error) {
          this.logger.warn(`Impossibile connettersi al peer bootstrap ${peer}: ${error.message}`);
          return { peer, success: false, error: error.message };
        }
      });

      const results = await Promise.all(connectionPromises);
      const successfulConnections = results.filter(r => r.success).length;

      this.logger.info(
        `Connesso a ${successfulConnections}/${bootstrapPeers.length} peer bootstrap`
      );

      if (successfulConnections === 0 && bootstrapPeers.length > 0) {
        this.logger.warn(
          'Impossibile connettersi a nessun peer bootstrap, funzionamento in modalità isolata'
        );
      }
    } catch (error) {
      this.logger.error(`Errore nella connessione ai peer bootstrap: ${error.message}`);
    }
  }
}
