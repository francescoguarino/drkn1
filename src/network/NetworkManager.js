import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { bootstrap } from '@libp2p/bootstrap';
import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { DHTManager } from './DHT.js';
import { NodeStorage } from '../utils/NodeStorage.js';
import fs from 'fs';
import path from 'path';
import { base58btc } from 'multiformats/bases/base58';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import crypto from 'crypto';
import { 
  getAllBootstrapNodes, 
  getActiveBootstrapNodes, 
  toMultiAddr,
  getAllMultiaddrs 
} from '../config/bootstrap-nodes.js';
import os from 'os';
import * as peerIdModule from '@libp2p/peer-id';
import { autoNAT } from '@libp2p/autonat';
import { unmarshalPrivateKey } from '@libp2p/crypto/keys';
import { createEd25519PeerId as createNewPeerId, createFromPrivKey } from '@libp2p/peer-id-factory';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { ping } from '@libp2p/ping';

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
    this.p2pPort = parseInt(process.env.P2P_PORT) || config.network.port || config.p2p.port || 6001;
    this.running = false;
    this.port = null;
  }

  async start() {
    try {
      this.logger.info(`⚡️ Avvio Network Manager (modalità: ${this.config.mode})...`);
      this.isRunning = true;

      try {
        // Carica le informazioni esistenti del nodo prima di tutto
        const existingNodeInfo = await this.storage.loadNodeInfo();
        
        // Se è stato trovato un nodeId nel file di storage e non ne abbiamo già uno, usalo
        if (existingNodeInfo?.nodeId && !this.nodeId) {
          this.nodeId = existingNodeInfo.nodeId;
          this.logger.info(`NodeId caricato dal file di storage: ${this.nodeId}`);
        }
        
        // Utilizziamo il nuovo metodo per caricare o creare il PeerId
        this.peerId = await this.loadOrCreatePeerId();
        this.logger.info(`PeerId caricato/creato: ${this.peerId.toString()}`);
        
        // Se non abbiamo già un nodeId, lo generiamo dal PeerId
        if ( !this.nodeId ) {
          this.nodeId = this.peerId.toString();
          this.logger.info(`NodeId impostato dal PeerId: ${this.nodeId}`);
        } else {
          this.logger.info(`Utilizzo nodeId esistente: ${this.nodeId}`);
        }
        
        // Salva le informazioni aggiornate del nodo
        const nodeInfo = {
          ...existingNodeInfo,
          nodeId: this.nodeId,
          peerId: {
            id: this.peerId.toString(),
            pubKey: this.peerId.publicKey?.bytes ? Buffer.from(this.peerId.publicKey.bytes).toString('base64') : null,
            privKey: this.peerId.privateKey?.bytes ? Buffer.from(this.peerId.privateKey.bytes).toString('base64') : null,
          },
          lastSeen: new Date().toISOString()
        };
        
        await this.storage.saveNodeInfo(nodeInfo);
        this.logger.info(`Informazioni nodo salvate con successo (nodeId: ${this.nodeId})`);
      } catch (peerIdError) {
        this.logger.error(`Errore durante la gestione del PeerId: ${peerIdError.message}`);
        throw peerIdError;
      }
      
      // Crea il nodo libp2p con il PeerId ottenuto
      this.logger.info(`Creazione nodo libp2p con PeerId: ${this.peerId.toString()}...`);
              
      // Inizializza la porta di ascolto (con gestione dei conflitti)
      if (!this.port) {
        this.port = this.config.port || 0; // 0 = porta casuale
      }
      
      const listenAddresses = [];
      
      // Aggiungi indirizzo locale (loopback) sempre
      listenAddresses.push('/ip4/127.0.0.1/tcp/' + this.port);
      
      // Aggiungi indirizzo di rete locale se non siamo in modalità lokalhost-only
      if (this.config.mode !== 'localhost-only') {
        const localIp = this.getLocalIpAddress();
        if (localIp) {
          listenAddresses.push(`/ip4/${localIp}/tcp/${this.port}`);
        }
      }
      
      this.logger.info(`Indirizzi di ascolto: ${listenAddresses.join(', ')}`);
      
      // Configurazione di libp2p
      const libp2pConfig = {
        peerId: this.peerId,
        addresses: {
          listen: listenAddresses
        },
        transports: [
          tcp()
        ],
        streamMuxers: [
          mplex()
        ],
        connectionEncryption: [
          noise()
        ],
        services: {
          identify: identify(),
          ping: ping(),
          pubsub: gossipsub({
            emitSelf: false,
            allowPublishToZeroPeers: true
          }),
          dht: kadDHT({
            clientMode: false,
            validators: {
              ipns: this.dhtManager ? this.dhtManager.getIPNSValidator() : null
            },
            selectors: {
              ipns: this.dhtManager ? this.dhtManager.getIPNSSelector() : null
            }
          })
        }
      };



      // Fase 2: Crea il nodo libp2p con il PeerId ottenuto
      this.logger.info(`Creazione nodo libp2p con PeerId: ${this.peerId.toString()}`);

      // Inizializza la DHT con il nodeId
      this.dht = new DHTManager(this.config, this.logger, this.nodeId);

      // Tenta di avviare il nodo con diverse porte se necessario
      let port = this.p2pPort;
      let maxAttempts = 5;
      let attemptCount = 0;
      let success = false;

      while (!success && attemptCount < maxAttempts) {
        attemptCount++;
        try {
          this.logger.info(`Tentativo ${attemptCount}/${maxAttempts} di avvio sulla porta ${port}`);

          // Crea il nodo libp2p
          this.node = await this._createLibp2pNode(port, this.peerId);

          // Verifica che il nodo sia stato creato correttamente
          if (!this.node) {
            throw new Error("Creazione del nodo libp2p fallita, il nodo è undefined");
          }

          // Se arriviamo qui, il nodo è stato creato con successo
          success = true;
        } catch (error) {
          this.logger.error(`Errore nella creazione del nodo: ${error.message}`);
          if (error.message.includes('could not listen') || error.code === 'EADDRINUSE') {
            this.logger.warn(`Porta ${port} occupata, tentativo con porta alternativa...`);
            // Prova con una porta casuale tra 10000 e 65000
            port = Math.floor(Math.random() * 55000) + 10000;
          } else {
            // Se l'errore è di altro tipo, rilancia l'eccezione
            this.logger.error(`Errore imprevisto nella creazione del nodo: ${error.message}`);
            throw error;
          }
        }
      }

      if (!success) {
        throw new Error(
          `Impossibile avviare il nodo dopo ${maxAttempts} tentativi su porte diverse`
        );
      }

      // Aggiorna la porta utilizzata
      this.p2pPort = port;
      this.logger.info(`Nodo avviato con successo sulla porta ${port}`);

      // Verifica che this.node esista prima di aggiungere event listeners
      if (!this.node) {
        throw new Error("this.node è undefined, impossibile procedere");
      }

      // Eventi del nodo
      try {
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
      } catch (error) {
        this.logger.error(`Errore nell'impostazione degli event listeners: ${error.message}`);
        throw error;
      }

      // Avvia il nodo libp2p
      try {
        await this.node.start();
        this.logger.info(`Nodo libp2p avviato con peerId: ${this.node.peerId.toString()}`);
        
        // Logging dettagliato degli indirizzi di ascolto
        const listenAddrs = this.node.getMultiaddrs();
        this.logger.info(`Indirizzi di ascolto (${listenAddrs.length}):`);
        listenAddrs.forEach(addr => {
          this.logger.info(`- ${addr.toString()}`);
        });
        
        // Aggiungi un handler specifico per connessioni in entrata
        try {
          if (this.node.connectionManager) {
            this.node.connectionManager.addEventListener('connection:open', (event) => {
              const conn = event.detail;
              this.logger.info(`📥 CONNESSIONE IN ENTRATA da: ${conn.remotePeer.toString()} (${conn.remoteAddr.toString()})`);
            });
          } else {
            this.logger.warn("connectionManager non disponibile, impossibile registrare l'evento 'connection:open'");
          }
        } catch (error) {
          this.logger.error(`Errore nell'aggiunta dell'event listener per connessioni in entrata: ${error.message}`);
        }
      } catch (error) {
        this.logger.error(`Errore nell'avvio del nodo: ${error.message}`);
        throw error;
      }

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

      // Stampa la tabella riassuntiva
      this._printSummaryTable();

      return true;
    } catch (error) {
      this.logger.error(`Errore nell'avvio del NetworkManager: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }

  _printSummaryTable() {
    // Ottieni la lista dei peer connessi
    const connectedPeers = Array.from(this.peers.keys()).map(peerId => ({
      id: peerId,
      status: 'Connected'
    }));

    // Usa il PeerId effettivamente utilizzato, non quello che tentiamo di riutilizzare
    const actualPeerId = this.node ? this.node.peerId.toString() : (this.peerId?.toString() || 'Non disponibile');

    const table = `
╔════════════════════════════════════════════════════════════════════════════╗
║ Riepilogo Nodo                                                           ║
╠════════════════════════════════════════════════════════════════════════════╣
║ ID Nodo: ${this.nodeId}                                                    ║
║ Peer ID: ${actualPeerId}                   ║
║ Porta P2P: ${this.p2pPort}                                                 ║
║ Porta API: ${this.config.api?.port || 'Non configurata'}                   ║
║ Network Type: ${this.networkType}                                          ║
╠════════════════════════════════════════════════════════════════════════════╣
║ Peer Connessi: ${connectedPeers.length}                                     ║
╠════════════════════════════════════════════════════════════════════════════╣
║ Lista Peer Connessi:                                                      ║
${connectedPeers.length > 0 
  ? connectedPeers.map(peer => `║ - ${peer.id} (${peer.status})`).join('\n') 
  : '║ Nessun peer connesso'}
╚════════════════════════════════════════════════════════════════════════════╝
`;

    this.logger.info(table);
  }

  /**
   * Carica un PeerId esistente o ne crea uno nuovo
   * @returns {Promise<PeerId>} - Oggetto PeerId
   */
  async loadOrCreatePeerId() {
    try {
      // Carica le informazioni esistenti
      const nodeInfo = await this.storage.loadNodeInfo();
      this.logger.info('Informazioni nodo caricate: ' + JSON.stringify({
        hasNodeInfo: !!nodeInfo,
        nodeId: nodeInfo?.nodeId || 'non presente',
        hasPeerId: !!nodeInfo?.peerId,
        peerIdType: nodeInfo?.peerId ? typeof nodeInfo.peerId : 'non presente'
      }));

      // Se abbiamo informazioni salvate con un PeerId, proviamo a usarle
      if (nodeInfo && nodeInfo.peerId) {
        this.logger.info('Trovato PeerId salvato, tentativo di riutilizzo...');

        try {
          // Verifichiamo che abbiamo la chiave privata
          if (typeof nodeInfo.peerId === 'object' && nodeInfo.peerId.privKey) {
            this.logger.info('Chiavi private trovate, tentativo di ricostruzione PeerId...');
            
            try {
              // Converti la chiave da base64 a buffer
              const privKeyStr = nodeInfo.peerId.privKey;
              const privKeyBuffer = Buffer.from(privKeyStr, 'base64');
              
              this.logger.info(`Chiave privata: ${privKeyBuffer.length} bytes (in base64: ${privKeyStr.substring(0, 10)}...)`);
              
              // Decodifica la chiave privata e crea il PeerId
              const privKey = await unmarshalPrivateKey(privKeyBuffer);
              const peerId = await createFromPrivKey(privKey);
              
              this.logger.info(`PeerId creato con successo: ${peerId.toString()}`);
              
              // Verifica corrispondenza con l'ID salvato
              if (peerId.toString() !== nodeInfo.peerId.id) {
                this.logger.warn(`⚠️ Il PeerId generato (${peerId.toString()}) non corrisponde all'ID salvato (${nodeInfo.peerId.id})`);
                this.logger.warn('Questo potrebbe essere causato da cambiamenti nelle librerie libp2p. Utilizzerò comunque il nuovo PeerId generato.');
                // Aggiorna l'ID nel nodeInfo per i futuri caricamenti
                nodeInfo.peerId.id = peerId.toString();
                await this.storage.saveNodeInfo(nodeInfo);
                this.logger.info(`Informazioni nodo aggiornate con il nuovo PeerId: ${peerId.toString()}`);
              }

              return peerId;
            } catch (importError) {
              this.logger.error(`Errore importazione chiave: ${importError.message}`);
              throw importError;
            }
          } else if (typeof nodeInfo.peerId === 'string') {
            // Qui abbiamo solo l'ID come stringa, senza chiavi
            this.logger.warn('Solo ID PeerId trovato senza chiavi private, impossibile riutilizzare lo stesso PeerId');
            throw new Error('PeerId senza chiavi private non utilizzabile');
          } else {
            this.logger.warn('Formato PeerId salvato non riconoscibile');
            throw new Error('Formato PeerId non valido');
          }
        } catch (error) {
          this.logger.error(`Errore nel caricamento del PeerId: ${error.message}`);
          this.logger.info('Sarà generato un nuovo PeerId');
          // Fallback a creazione nuovo PeerId
          return await createNewPeerId();
        }
      } else {
        // Nessun PeerId trovato, ne creiamo uno nuovo
        this.logger.info('Nessun PeerId trovato, creazione nuovo PeerId');
        return await createNewPeerId();
      }
    } catch (error) {
      this.logger.error(`Errore generale in loadOrCreatePeerId: ${error.message}`);
      // Fallback finale: crea un nuovo PeerId
      return await createNewPeerId();
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
      // Ottieni i nodi bootstrap dal file centralizzato
      const activeNodes = getActiveBootstrapNodes();
      this.logger.info(`Trovati ${activeNodes.length} nodi bootstrap attivi`);

      // Aggiungi gli indirizzi multiaddr in diversi formati per aumentare le possibilità di connessione
      for (const node of activeNodes) {
        // Verifica se il nodo non è il nodo corrente
        if (node.id !== this.peerId.toString()) {
          // Formato completo
          bootstrapNodes.push(`/ip4/${node.host}/tcp/${node.port}/p2p/${node.id}`);
          // Formato DNS (può funzionare meglio in alcune configurazioni di rete)
          bootstrapNodes.push(`/dns4/${node.host}/tcp/${node.port}/p2p/${node.id}`);
          // Formato semplice (utile per alcuni casi)
          bootstrapNodes.push(`/ip4/${node.host}/tcp/${node.port}`);
          // Formato IPv6 (se disponibile)
          if (node.ipv6) {
            bootstrapNodes.push(`/ip6/${node.ipv6}/tcp/${node.port}/p2p/${node.id}`);
          }
        }
      }

      // Aggiungi i bootstrap nodes dalla configurazione, evitando duplicati e il nodo corrente
      if (this.config.p2p.bootstrapNodes && Array.isArray(this.config.p2p.bootstrapNodes)) {
        for (const node of this.config.p2p.bootstrapNodes) {
          // Verifica se è un indirizzo multiaddr o un oggetto con host/port
          if (typeof node === 'string') {
            // Verifica se l'indirizzo è già presente e non è il nodo corrente
            if (!bootstrapNodes.includes(node) && !node.includes(this.peerId.toString())) {
              bootstrapNodes.push(node);
            }
          } else if (node.host && node.port) {
            // Verifica se non è il nodo corrente
            if (node.id !== this.peerId.toString()) {
              const nodeAddr = `/ip4/${node.host}/tcp/${node.port}/p2p/${node.id || 'QmBootstrap'}`;
              // Verifica se l'indirizzo è già presente
              if (!bootstrapNodes.includes(nodeAddr)) {
                bootstrapNodes.push(nodeAddr);
              }
            }
          }
        }
      }

      this.logger.info(`Tentativo di connessione a ${bootstrapNodes.length} bootstrap nodes`);
      return bootstrapNodes;
    } catch (error) {
      this.logger.error(`Errore nella ricerca dei bootstrap nodes: ${error.message}`);
      // In caso di errore, utilizza getAllMultiaddrs come fallback
      return getAllMultiaddrs();
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

      // Verifica se siamo in modalità demo, in tal caso non cercare di connettersi ai bootstrap nodes
      if (this.networkType === 'demo') {
        this.logger.info('Modalità demo attivata, salto la connessione ai bootstrap nodes');
        return;
      }

      // Ottieni i nodi bootstrap attivi dal file centralizzato
      const activeNodes = getActiveBootstrapNodes();
      
      // Verifica che config.p2p.bootstrapNodes esista e aggiungi quei nodi
      let bootstrapNodes = [...activeNodes];
      if (
        this.config.p2p &&
        this.config.p2p.bootstrapNodes &&
        Array.isArray(this.config.p2p.bootstrapNodes)
      ) {
        // Aggiungi i nodi della configurazione ai nodi fissi
        for (const node of this.config.p2p.bootstrapNodes) {
          // Evita duplicati e il nodo corrente
          const isDuplicate = bootstrapNodes.some(
            existing => existing.host === node.host && existing.port === node.port
          );
          const isSelf = node.id === this.peerId.toString();

          if (!isDuplicate && !isSelf) {
            bootstrapNodes.push(node);
          }
        }
      }

      this.logger.info(`Tentativo di connessione a ${bootstrapNodes.length} peer bootstrap...`);

      let connectedCount = 0;
      for (const node of bootstrapNodes) {
        try {
          // Creo il multiaddr completo per la connessione
          const multiaddr = `/ip4/${node.host}/tcp/${node.port}/p2p/${node.id}`;
          this.logger.info(`Tentativo di connessione al bootstrap node: ${node.id} (${multiaddr})`);

          // Aggiungi un piccolo ritardo tra i tentativi
          await new Promise(resolve => setTimeout(resolve, 1000));

          

          // Usa il multiaddr completo invece dell'ID
          await this.node.dial(multiaddr);
          this.logger.info(`Connesso al bootstrap node: ${node.id}`);
          connectedCount++;
        } catch (error) {
          this.logger.warn(
            `Non è stato possibile connettersi al bootstrap node: ${node.id}`,
            error.message
          );
        }
      }

      this.logger.info(`Connesso a ${connectedCount} di ${bootstrapNodes.length} peer bootstrap`);

      if (connectedCount === 0) {
        this.logger.warn(
          'Impossibile connettersi a nessun peer bootstrap, funzionamento in modalità isolata'
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
      this.logger.info(`Connesso al peer: ${id}`);

      // Verifica se il peer è già connesso
      if (this.peers.has(id)) {
        this.logger.warn(`Peer ${id} già connesso, ignorando la connessione duplicata.`);
        return;
      }

      // Aggiungi alla lista dei peer
      this.peers.set(id, {
        connection,
        status: 'connected',
        lastSeen: Date.now(),
        messageCount: 0
      });

      // Aggiorna le statistiche
      this.stats.activeConnections = (this.stats.activeConnections || 0) + 1;
      this.stats.totalConnections = (this.stats.totalConnections || 0) + 1;

      // Imposta il gestore dei messaggi per questo peer
      this._setupMessageHandler(connection);

      // Invia messaggio di benvenuto
      const welcomeMessage = {
        type: 'ENTRY_GREETING',
        payload: {
          message: 'Benvenuto nella rete Drakon! Sono un nodo di ingresso.',
          bootstrapId: this.nodeId,
          timestamp: Date.now()
        }
      };
      await connection.newStream('/drakon/1.0.0').then(stream => {
        stream.sink([Buffer.from(JSON.stringify(welcomeMessage))]);
        this.logger.info(`Messaggio di benvenuto inviato al peer ${id}`);
      }).catch(err => {
        this.logger.error(`Errore nell'invio del messaggio di benvenuto a ${id}:`, err);
      });

      // Propaga il messaggio di connessione agli altri peer
      this._propagateMessage({
        type: 'NEW_PEER_CONNECTED',
        payload: {
          peerId: id,
          timestamp: Date.now()
        }
      }, id);

      // Emetti evento di connessione
      this.emit('peer:connect', { id, connection });
    } catch (error) {
      this.logger.error('Errore nella gestione della connessione del peer:', error);
    }
  }

  async _propagateMessage(message, excludePeerId = null) {
    try {
      for (const [peerId, peerData] of this.peers) {
        if (peerId !== excludePeerId) {
          const connection = peerData.connection;
          await connection.newStream('/drakon/1.0.0').then(stream => {
            stream.sink([Buffer.from(JSON.stringify(message))]);
            this.logger.info(`Messaggio propagato al peer ${peerId}: ${JSON.stringify(message)}`);
          }).catch(err => {
            this.logger.error(`Errore nella propagazione del messaggio al peer ${peerId}:`, err);
          });
        }
      }
    } catch (error) {
      this.logger.error('Errore durante la propagazione del messaggio:', error);
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
    this.logger.info(`Disconnesso dal peer: ${id}`);

    if (this.peers.has(id)) {
      this.peers.delete(id);
      this.stats.activeConnections--;
      
      // Emetti evento di disconnessione
      this.emit('peer:disconnect', { id });
    }
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
      this.logger.debug('Tentativo di connessione ai bootstrap peers...');
      
      // Array per contenere tutti i bootstrap peers
      let bootstrapPeers = [];
      
      // 1. Prova a ottenere bootstrap peers dalle variabili d'ambiente
      const p2pBootstrapPeers = process.env.P2P_BOOTSTRAP_PEERS;
      if (p2pBootstrapPeers) {
        this.logger.debug(`Bootstrap peers da env: ${p2pBootstrapPeers}`);
        const peers = p2pBootstrapPeers.split(',');
        bootstrapPeers.push(...peers);
      }
      
      // 2. Prova a ottenere bootstrap peers dalla config BOOTSTRAP_NODES
      const bootstrapNodesString = process.env.BOOTSTRAP_NODES;
      if (bootstrapNodesString) {
        try {
          const bootstrapNodes = JSON.parse(bootstrapNodesString);
          this.logger.debug(`BOOTSTRAP_NODES configurati: ${JSON.stringify(bootstrapNodes)}`);
          
          // Converti i nodi in formato multiaddr
          for (const node of bootstrapNodes) {
            if (node.host && node.port && node.id) {
              const multiaddr = `/ip4/${node.host}/tcp/${node.port}/p2p/${node.id}`;
              this.logger.debug(`Generato multiaddr: ${multiaddr}`);
              bootstrapPeers.push(multiaddr);
            }
          }
        } catch (error) {
          this.logger.error(`Errore nel parsing di BOOTSTRAP_NODES: ${error.message}`);
        }
      }
      
      // 3. Controlla se abbiamo peer unici
      const uniquePeers = [...new Set(bootstrapPeers)];
      this.logger.info(`Tentativo di connessione a ${uniquePeers.length} bootstrap peers`);
      
      // Se non ci sono bootstrap peers, termina
      if (uniquePeers.length === 0) {
        this.logger.warn('Nessun bootstrap peer configurato');
        return;
      }
      
      // 4. Tenta la connessione a ciascun peer con più tentativi
      const maxRetries = 3;
      const connectionPromises = uniquePeers.map(async (peer) => {
        this.logger.debug(`Tentativo di connessione a ${peer}...`);
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Se il peer è già in formato multiaddr, usalo direttamente
            // altrimenti prova a estrarre i componenti e formattarlo
            let multiaddr = peer;
            if (!peer.startsWith('/ip4/') && !peer.startsWith('/dns4/')) {
              try {
                // Prova a estrarre componenti da un oggetto
                const peerParts = peer.match(/ip4\/([^\/]+)\/tcp\/(\d+)\/p2p\/([^\/]+)/);
                if (peerParts) {
                  multiaddr = `/ip4/${peerParts[1]}/tcp/${peerParts[2]}/p2p/${peerParts[3]}`;
                }
              } catch (e) {
                this.logger.warn(`Impossibile parsare il formato peer: ${peer}`);
              }
            }
            
            this.logger.debug(`Tentativo di connessione con multiaddr: ${multiaddr}`);
            await this.node.dial(multiaddr);
            this.logger.info(`✅ Connesso al peer: ${multiaddr}`);
            return true;
          } catch (error) {
            this.logger.warn(`Tentativo ${attempt}/${maxRetries} fallito: ${error.message}`);
            
            if (attempt < maxRetries) {
              // Aspetta prima di riprovare (backoff esponenziale)
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
          }
        }
        
        this.logger.error(`❌ Impossibile connettersi a ${peer} dopo ${maxRetries} tentativi`);
        return false;
      });
      
      // Aspetta che tutti i tentativi di connessione siano completati
      const results = await Promise.all(connectionPromises);
      const successCount = results.filter(result => result).length;
      
      this.logger.info(`Connesso a ${successCount}/${uniquePeers.length} bootstrap peers`);
      
      // Configura reconnect automatico
      if (successCount > 0) {
        setInterval(() => {
          this._checkAndReconnect(uniquePeers);
        }, 30000); // Controlla ogni 30 secondi
      }
    } catch (error) {
      this.logger.error(`Errore nella connessione ai bootstrap peers: ${error.message}`);
    }
  }
  
  /**
   * Controlla e riconnette ai peer disconnessi
   * @private
   * @param {Array<string>} peers - Lista di peer da controllare
   */
  async _checkAndReconnect(peers) {
    try {
      const connectedPeers = this.node.getPeers();
      const connectedPeerIds = new Set(connectedPeers.map(peer => peer.toString()));
      
      for (const peer of peers) {
        try {
          const peerId = peer.split('/p2p/')[1];
          
          // Se il peer non è connesso, tenta di riconnettersi
          if (peerId && !connectedPeerIds.has(peerId)) {
            this.logger.debug(`Tentativo di riconnessione a ${peer}...`);
            await this.node.dial(peer);
            this.logger.info(`✅ Riconnesso al peer: ${peer}`);
          }
        } catch (error) {
          this.logger.warn(`Errore nella riconnessione a ${peer}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Errore nel controllo delle connessioni: ${error.message}`);
    }
  }

  /**
   * Ottiene l'indirizzo IP della macchina preferendo indirizzi pubblici o non-localhost
   * @private
   * @returns {string} Indirizzo IP
   */
  getLocalIpAddress() {
    try {
      // Controlla se è stato impostato un IP pubblico tramite variabile d'ambiente
      if (process.env.PUBLIC_IP) {
        this.logger.info(`Usando indirizzo IP pubblico da variabile d'ambiente: ${process.env.PUBLIC_IP}`);
        return process.env.PUBLIC_IP;
      }
      
      const networkInterfaces = os.networkInterfaces();
      
      // Cerca un'interfaccia non-localhost IPv4
      for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
          // Prendi solo gli indirizzi IPv4 che non sono loopback e non sono di interfacce virtuali
          if (iface.family === 'IPv4' && !iface.internal && 
              !interfaceName.startsWith('vEthernet') && 
              !interfaceName.startsWith('Docker') && 
              !interfaceName.startsWith('WSL')) {
            this.logger.info(`Trovato indirizzo IP: ${iface.address} (${interfaceName})`);
            return iface.address;
          }
        }
      }
      
      // Fallback: usa l'indirizzo pubblico
      this.logger.warn('Nessun indirizzo IP non-locale trovato, uso 0.0.0.0');
      return '0.0.0.0';
    } catch (error) {
      this.logger.error(`Errore nel recupero dell'indirizzo IP: ${error.message}`);
      return '0.0.0.0';
    }
  }

  /**
   * Crea e configura un nodo libp2p
   * @private
   * @param {number} port - porta P2P
   * @param {PeerId} [explicitPeerId] - PeerId da utilizzare (opzionale, se non fornito usa this.peerId)
   * @returns {Promise<libp2p>} Istanza del nodo libp2p
   */
  async _createLibp2pNode(port, explicitPeerId) {
    const localIp = this.getLocalIpAddress();
    this.logger.debug(`Indirizzo IP locale trovato: ${localIp}`);
    
    // Se è disponibile un IP pubblico da variabile d'ambiente, usalo
    let ipToUse = localIp;
    if (process.env.PUBLIC_IP) {
      ipToUse = process.env.PUBLIC_IP;
      this.logger.info(`Usando indirizzo IP pubblico da variabile d'ambiente: ${ipToUse}`);
    }
    
    // Verifica che le porte siano numeri validi
    if (isNaN(port)) {
      this.logger.error(`Porta P2P non valida: ${port}`);
      throw new Error(`Porta P2P non valida: ${port}`);
    }
    
    // Determina quale PeerId usare (quello esplicito passato come parametro o this.peerId)
    const peerIdToUse = explicitPeerId || this.peerId;
    
    // Stampa informazioni sul PeerId che verrà utilizzato
    if (peerIdToUse) {
      this.logger.info(`Creazione nodo libp2p con PeerId: ${peerIdToUse.toString()}`);
    } else {
      this.logger.warn('Nessun PeerId fornito, libp2p ne genererà uno automaticamente');
    }
    
    try {
      // Configura libp2p con impostazioni ottimizzate per la connettività pubblica
      const nodeConfig = {
        // Usa il PeerId se disponibile
        ...(peerIdToUse ? { peerId: peerIdToUse } : {}),
        
        // Configura gli indirizzi da ascoltare e annunciare
        addresses: {
          // Ascolta su tutte le interfacce
          listen: [
            `/ip4/0.0.0.0/tcp/${port}`
          ],
          // Annuncia solo l'IP pubblico/specificato
          announce: [
            `/ip4/${ipToUse}/tcp/${port}`
          ]
        },
        
        // Configura i trasporti
        transports: [
          tcp() // Usa il trasporto TCP
        ],
        
        // Configura la crittografia della connessione
        connectionEncryption: [
          noise() // Protocollo NOISE per la crittografia
        ],
        
        // Configura la negoziazione del protocollo
        streamMuxers: [
          mplex() // Multiplexer per gestire multiple stream 
        ],
        
        // Configurazione della connettività
        connectionManager: {
          minConnections: 3, // Mantieni almeno 3 connessioni
          maxConnections: 50, // Limite massimo connessioni
          pollInterval: 5000, // Controlla ogni 5 secondi
          // Gestione connessioni più aggressiva
          autoDial: true,
        },
        
        // Configura il comportamento dei dialer
        dialer: {
          maxParallelDials: 10, // Aumenta i dial paralleli per accelerare
          maxDialsPerPeer: 5, // Più tentativi per peer
          dialTimeout: 10000, // 10 secondi timeout per dial
        }
      };
      
      const node = await createLibp2p(nodeConfig);
      
      // Verifica se il PeerId del nodo creato è quello che ci aspettavamo
      if (peerIdToUse) {
        const expectedPeerId = peerIdToUse.toString();
        const actualPeerId = node.peerId.toString();
        
        this.logger.info(`Nodo avviato con successo sulla porta ${port}`);
        this.logger.info(`PeerId atteso: ${expectedPeerId}`);
        this.logger.info(`PeerId effettivo: ${actualPeerId}`);
        
        if (expectedPeerId !== actualPeerId) {
          this.logger.warn(`⚠️ ATTENZIONE: Il PeerId del nodo (${actualPeerId}) non corrisponde a quello che volevamo usare (${expectedPeerId})`);
        } else {
          this.logger.info(`✅ PeerId correttamente applicato al nodo`);
        }
      } else {
        this.logger.info(`Nodo avviato con PeerId generato automaticamente: ${node.peerId.toString()}`);
      }
      
      return node;
    } catch (error) {
      this.logger.error(`Errore nella creazione del nodo libp2p: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    }
  }
}
