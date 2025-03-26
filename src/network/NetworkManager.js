import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { bootstrap } from '@libp2p/bootstrap';
import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { DHTManager } from './DHT.js';
import { createFromJSON } from '@libp2p/peer-id-factory';
import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import fs from 'fs';
import path from 'path';

export class NetworkManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.logger = new Logger('NetworkManager');
    this.node = null;
    this.peers = new Map();
    this.routingTable = new Map();
    this.discovery = null;
    this.swarm = null;
    this.myId = null;
    this.peerId = null;
    this.dht = new DHTManager(config);
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

  async start() {
    try {
      this.logger.info('Avvio del NetworkManager...');

      // Inizializza la DHT
      await this.dht.initialize();

      // Ottieni l'ID del nodo dalla DHT
      this.myId = this.dht.nodeId;

      // Crea o carica un PeerId persistente
      await this._loadOrCreatePeerId();

      // Ottieni informazioni di rete
      const networkInfo = await this._getNetworkInfo();
      this.stats.myAddress = networkInfo.address;
      this.stats.networkType = networkInfo.type;

      // Trova i bootstrap nodes
      const bootstrapNodes = await this._findBootstrapNodes();

      // Determina la porta da utilizzare, con possibilità di override da variabile d'ambiente
      let port = parseInt(process.env.P2P_PORT) || this.config.p2p.port;
      let maxTries = 3; // Numero massimo di tentativi con porte diverse
      let currentTry = 0;
      let success = false;

      while (!success && currentTry < maxTries) {
        currentTry++;

        try {
          this.logger.info(`Tentativo ${currentTry}/${maxTries} di avvio sulla porta ${port}`);

          // Configura libp2p
          this.node = await createLibp2p({
            addresses: {
              // Ascolta su tutti gli indirizzi invece di un IP specifico
              listen: [`/ip4/0.0.0.0/tcp/${port}`]
            },
            transports: [tcp()],
            streamMuxers: [mplex()],
            connectionEncryption: [noise()],
            peerDiscovery: [
              bootstrap({
                list: bootstrapNodes,
                interval: 1000
              })
            ],
            identify: {
              host: {
                agentVersion: `drakon/${this.config.version || '1.0.0'}`,
                protocolVersion: '1.0.0'
              }
            },
            peerId: this.peerId,
            connectionManager: {
              maxConnections: 100,
              minConnections: 5
            }
          });

          // Se siamo arrivati a questo punto, la configurazione è riuscita
          success = true;
        } catch (e) {
          // Se non riesce a connettersi alla porta, prova con una porta alternativa
          if (e.message.includes('could not listen') || e.code === 'EADDRINUSE') {
            this.logger.warn(`Porta ${port} occupata, tentativo con porta alternativa...`);

            if (currentTry < maxTries) {
              // Genera una porta casuale tra 10000 e 65000
              port = Math.floor(Math.random() * 55000) + 10000;
            } else {
              this.logger.error(
                `Impossibile trovare una porta disponibile dopo ${maxTries} tentativi`
              );
              throw new Error(
                `Impossibile avviare il nodo P2P: tutte le porte sono occupate dopo ${maxTries} tentativi`
              );
            }
          } else {
            // Se l'errore è di altro tipo, rilancia l'eccezione
            this.logger.error(`Errore imprevisto nell'avvio del nodo P2P: ${e.message}`);
            throw e;
          }
        }
      }

      // Aggiorna la porta nella configurazione
      this.config.p2p.port = port;

      // Inizia ad ascoltare
      await this.node.start();
      this.logger.info(`Nodo P2P in ascolto sulla porta ${port}`);
      this.logger.info(`ID del nodo: ${this.peerId.toString()}`);
      this.logger.info(`Indirizzo IP: ${networkInfo.address}`);

      // Imposta gli event handlers
      this._setupEventHandlers();

      // Avvia il discovery
      await this._startDiscovery();

      // Avvia la manutenzione periodica della DHT
      this._setupDHTMaintenance();

      this.logger.info('NetworkManager avviato con successo');
    } catch (error) {
      this.logger.error("Errore durante l'avvio del NetworkManager:", error);
      throw error;
    }
  }

  async _loadOrCreatePeerId() {
    // Cartella per salvare il PeerId
    const peerIdDir = path.join(this.config.node.dataDir, 'peer-id');
    const peerIdFile = path.join(peerIdDir, 'peer-id.json');

    try {
      // Crea la directory se non esiste
      if (!fs.existsSync(peerIdDir)) {
        fs.mkdirSync(peerIdDir, { recursive: true });
      }

      // Verifica se esiste già un file con il PeerId
      if (fs.existsSync(peerIdFile)) {
        try {
          // Carica il PeerId esistente
          const peerIdJson = JSON.parse(fs.readFileSync(peerIdFile, 'utf8'));
          this.peerId = await createFromJSON(peerIdJson);
          this.logger.info(`PeerId caricato: ${this.peerId.toString()}`);
          // Imposta l'ID anche in this.myId per coerenza
          this.myId = this.peerId.toString();
          return;
        } catch (loadError) {
          this.logger.error(
            `Errore nel caricamento del PeerId esistente: ${loadError.message}. Creazione di un nuovo PeerId.`
          );
          // Continua con la creazione di un nuovo PeerId
        }
      }

      // Crea un nuovo PeerId
      this.peerId = await createEd25519PeerId();

      // Salva il PeerId
      try {
        fs.writeFileSync(peerIdFile, JSON.stringify(this.peerId.toJSON()), 'utf8');
        this.logger.info(`Nuovo PeerId generato e salvato: ${this.peerId.toString()}`);
        // Imposta l'ID anche in this.myId per coerenza
        this.myId = this.peerId.toString();
      } catch (saveError) {
        this.logger.error(`Errore nel salvataggio del PeerId: ${saveError.message}`);
      }
    } catch (error) {
      this.logger.error(`Errore nella gestione del PeerId: ${error.message}`);
      try {
        // In caso di errore, crea comunque un PeerId in memoria
        this.peerId = await createEd25519PeerId();
        this.logger.info(`PeerId creato in memoria: ${this.peerId.toString()}`);
        // Imposta l'ID anche in this.myId per coerenza
        this.myId = this.peerId.toString();
      } catch (fallbackError) {
        this.logger.error(
          `Errore critico nella creazione del PeerId di fallback: ${fallbackError.message}`
        );
        throw new Error('Impossibile creare o caricare un PeerId valido');
      }
    }
  }

  async stop() {
    try {
      this.logger.info('Arresto del NetworkManager...');

      // Chiudi tutte le connessioni
      for (const [peerId, connection] of this.peers.entries()) {
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

  async broadcast(message) {
    try {
      const messageData = {
        type: 'broadcast',
        data: message,
        timestamp: Date.now(),
        sender: this.myId
      };

      const serializedMessage = JSON.stringify(messageData);

      // Invia il messaggio a tutti i peer connessi
      for (const [peerId, connection] of this.peers.entries()) {
        if (connection.status === 'connected') {
          try {
            const stream = await connection.newStream('/drakon/1.0.0');
            await stream.sink([Buffer.from(serializedMessage)]);
            this.stats.messagesSent++;
          } catch (error) {
            this.logger.error(`Errore nell'invio del messaggio al peer ${peerId}:`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Errore durante il broadcast:', error);
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

  getConnectedPeers() {
    const peersList = [];
    for (const [peerId, connection] of this.peers.entries()) {
      peersList.push({
        id: peerId,
        address: connection.remoteAddress,
        port: connection.remotePort,
        lastSeen: connection.lastSeen,
        messageCount: connection.messageCount,
        isActive: Date.now() - connection.lastSeen < 30000, // 30 secondi di timeout
        dhtInfo: this.dht.getNode(peerId)
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

  async requestHeight(peerId) {
    try {
      const stream = await this.peers.get(peerId).connection.newStream('/drakon/1.0.0');
      const message = {
        type: 'height_request',
        timestamp: Date.now()
      };
      await stream.sink([Buffer.from(JSON.stringify(message))]);
      const response = await stream.source.next();
      const data = JSON.parse(response.value.toString());
      return data.height;
    } catch (error) {
      this.logger.error(`Errore nella richiesta dell'altezza al peer ${peerId}:`, error);
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

  async _getNetworkInfo() {
    try {
      // Usa le informazioni dalla DHT
      return {
        address: this.dht.myIp,
        type: this._determineNetworkType(this.dht.myIp)
      };
    } catch (error) {
      this.logger.error("Errore nell'ottenere informazioni di rete:", error);
      // Fallback a localhost
      return {
        address: '127.0.0.1',
        type: 'private'
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
      if (this.stats) {
        this.stats.activeConnections = (this.stats.activeConnections || 0) + 1;
        this.stats.totalConnections = (this.stats.totalConnections || 0) + 1;
      }

      // Imposta il gestore dei messaggi per questo peer
      this._setupMessageHandler(connection);

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

  async _disconnectPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        await peer.connection.close();
        this.peers.delete(peerId);
        this.stats.activeConnections--;

        // Non rimuoviamo il peer dalla DHT, ma lo aggiorniamo come offline
        if (this.dht.getNode(peerId)) {
          this.dht.updateNode(peerId, { isOnline: false, lastSeen: Date.now() });
        }

        this.emit('peer:disconnect', { id: peerId });
      } catch (error) {
        this.logger.error(`Errore durante la disconnessione del peer ${peerId}:`, error);
      }
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
}
