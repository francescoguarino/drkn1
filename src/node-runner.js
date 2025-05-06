import { Node } from './core/Node.js';
import { Logger } from './utils/logger.js';
import { Config } from './config/config.js';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs/promises';
import { displayBanner } from './utils/banner.js';
import { NodeStorage } from './utils/NodeStorage.js';
import { getAllBootstrapNodes, toMultiAddr } from './config/bootstrap-nodes.js';

const logger = new Logger('NodeRunner');

/**
 * Avvia un singolo nodo Drakon, che può essere eseguito sia localmente che in remoto.
 * Lo script rileva automaticamente l'ambiente e configura il nodo di conseguenza.
 */
async function runNode(options = {}) {
  try {
    logger.info('Inizializzazione nodo Drakon...');

    // Crea la configurazione di base
    const config = new Config();
    await config.initialize();

    // Debug della configurazione iniziale
    logger.debug('Configurazione iniziale:', JSON.stringify(config.config, null, 2));

    // MODIFICA: Verifica se esistono informazioni salvate prima di generare un nuovo ID
    const nodeStorage = new NodeStorage(config.config);
    const savedInfo = await nodeStorage.loadNodeInfo();

    if (savedInfo && savedInfo.nodeId) {
      logger.info(`Trovate informazioni salvate con ID: ${savedInfo.nodeId}`);

      // Usa l'ID salvato
      if (!config.config.node) config.config.node = {};
      config.config.node.id = savedInfo.nodeId;

      logger.info(`Utilizzando ID salvato: ${savedInfo.nodeId}`);
    } else {
      // Genera un ID univoco per questo nodo se non specificato e non trovato nel file salvato
      logger.info('Nessuna informazione del nodo trovata, verrà generato un nuovo ID');

      if (!config.config.node || !config.config.node.id) {
        const nodeId = generateNodeId();
        if (!config.config.node) config.config.node = {};
        config.config.node.id = nodeId;

        logger.info(`Generato nuovo ID: ${nodeId}`);
      }
    }

    // Assicurati che tutte le configurazioni necessarie esistano
    ensureRequiredConfigs(config.config, options);

    // Aggiungi configurazioni mancanti per mempool e altre parti che potrebbero usare maxSize
    ensureMaxSizeConfigs(config.config);

    // Aggiungi opzioni da riga di comando
    if (options.port) {
      config.config.p2p.port = options.port;
      config.config.api.port = options.port + 1000;
    }

    if (options.dataDir) {
      config.config.storage.path = options.dataDir;
    }

    if (options.bootstrapNodes) {
      config.config.p2p.bootstrapNodes = options.bootstrapNodes;
    }

    if (options.isBootstrap !== undefined) {
      config.config.node.isBootstrap = options.isBootstrap;
    }

    // AGGIUNTO: Imposta il tipo di rete se specificato
    if (options.networkType) {
      if (!config.config.network) {
        config.config.network = {
          type: options.networkType,
          maxPeers: 50,
          peerTimeout: 30000
        };
      } else {
        config.config.network.type = options.networkType;
      }
      logger.info(`Tipo di rete impostato a: ${options.networkType}`);
    }

    // Crea le directory necessarie
    await ensureDirectories(config.config);

    // Mostra la configurazione
    logger.debug('Configurazione nodo finale:', JSON.stringify(config.config, null, 2));

    // Mostra il banner CON L'ID CORRETTO (quello salvato o nuovo)
    displayBanner(config.config);

    // Crea e avvia il nodo
    const node = new Node({
      ...config.config,
      bannerDisplayed: true // Indica che il banner è già stato mostrato
    });

    // Gestisci l'uscita pulita
    setupCleanShutdown(node);

    // Avvia il nodo
    await node.start();

    // Usa il nodeId dal nodo avviato, che sarà quello corretto e coerente
    logger.info(`Nodo avviato con successo con ID: ${node.nodeId}`);
    logger.info(`Porta P2P: ${config.config.p2p.port}`);
    logger.info(`Porta API: ${config.config.api.port}`);

    // Mantieni il processo in esecuzione
    process.stdin.resume();

    return node;
  } catch (error) {
    logger.error("Errore durante l'avvio del nodo:", error);

    // Log più dettagliato per il debug
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }

    process.exit(1);
  }
}

/**
 * Assicura che tutte le configurazioni richieste esistano
 */
function ensureRequiredConfigs(config, options) {
  // Node
  if (!config.node) {
    config.node = {
      id: generateNodeId(),
      name: `node-${crypto.randomBytes(4).toString('hex')}`,
      isBootstrap: options.isBootstrap || false
    };
  }

  // Blockchain
  if (!config.blockchain) {
    config.blockchain = {
      difficulty: 4,
      miningReward: 50,
      maxTransactionsPerBlock: 10,
      blockInterval: 10000
    };
  }

  // P2P
  if (!config.p2p) {
    config.p2p = {
      port: options.port || 6001,
      bootstrapNodes: options.bootstrapNodes || [
        {
          host: '34.147.53.15',
          port: 6001,
          id: '12D3KooWArtAZ6Q9mMiWPPsnRKTSvsxBXzbpK5dhW1QuBH1bstse'
        }
      ],
      protocols: ['/drakon/1.0.0']
    };
  } else if (!config.p2p.protocols) {
    config.p2p.protocols = ['/drakon/1.0.0'];
  }

  // Se bootstrapNodes è vuoto, aggiungi il nostro nodo bootstrap di default
  if (!config.p2p.bootstrapNodes || config.p2p.bootstrapNodes.length === 0) {
    config.p2p.bootstrapNodes = [
  
      {
        host: '34.147.53.15',
        port: 6001,
        id: '12D3KooWArtAZ6Q9mMiWPPsnRKTSvsxBXzbpK5dhW1QuBH1bstse'
      }
    ];
  }

  // Storage
  if (!config.storage) {
    config.storage = {
      path: options.dataDir || path.join(process.cwd(), 'db', config.node.id || 'node'),
      maxSize: 1024 * 1024 * 100, // 100MB
      options: {
        valueEncoding: 'json'
      }
    };
  } else {
    // Assicurati che tutti i campi necessari esistano
    if (!config.storage.maxSize) {
      config.storage.maxSize = 1024 * 1024 * 100; // 100MB
    }
    if (!config.storage.options) {
      config.storage.options = { valueEncoding: 'json' };
    }
  }

  // API
  if (!config.api) {
    config.api = {
      enabled: true,
      port: (options.port || 6001) + 1000,
      host: '0.0.0.0',
      cors: {
        origin: '*'
      }
    };
  } else if (!config.api.cors) {
    config.api.cors = { origin: '*' };
  }

  // Mining
  if (!config.mining) {
    config.mining = {
      enabled: true,
      difficulty: 4,
      threads: 1,
      interval: 30000,
      reward: 50
    };
  }

  // Sync
  if (!config.sync) {
    config.sync = {
      interval: 60000, // 1 minuto
      timeout: 30000 // 30 secondi
    };
  }

  // Network (aggiunto per la DHT)
  if (!config.network) {
    config.network = {
      type: 'testnet',
      maxPeers: 50,
      dht: {
        enabled: true,
        interval: 30000
      }
    };
  } else if (!config.network.dht) {
    config.network.dht = {
      enabled: true,
      interval: 30000
    };
  }

  // Altri dati di sistema
  config.version = config.version || '1.0.0';
  config.environment = config.environment || process.env.NODE_ENV || 'development';
  config.channel = config.channel || 'drakon-mainnet';
}

/**
 * Assicura che tutte le configurazioni che potrebbero usare maxSize esistano
 */
function ensureMaxSizeConfigs(config) {
  // Mempool
  if (!config.mempool) {
    config.mempool = {
      maxSize: 1000,
      maxTransactionAge: 3600000 // 1 ora
    };
  } else if (!config.mempool.maxSize) {
    config.mempool.maxSize = 1000;
  }

  // Assicurati che tutte le classi che potrebbero usare 'maxSize' abbiano la configurazione necessaria
  // Gossip
  if (!config.gossip) {
    config.gossip = {
      interval: 5000,
      maxPeersPerGossip: 3
    };
  }

  // Assicurati che tutti i campi necessari in network siano presenti
  if (!config.network.maxPeers) {
    config.network.maxPeers = 50;
  }

  if (!config.network.peerTimeout) {
    config.network.peerTimeout = 30000; // 30 secondi
  }
}

/**
 * Genera un ID univoco per il nodo
 */
function generateNodeId() {
  const hostname = os.hostname();
  const macAddress = getMacAddress();
  const timestamp = Date.now();
  const randomValue = Math.random().toString();

  const data = `${hostname}-${macAddress}-${timestamp}-${randomValue}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Ottiene l'indirizzo MAC della prima interfaccia di rete non-loopback
 */
function getMacAddress() {
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
 * Crea le directory necessarie
 */
async function ensureDirectories(config) {
  try {
    // Directory per lo storage
    await fs.mkdir(config.storage.path, { recursive: true });

    // Directory per i log
    const logDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logDir, { recursive: true });

    // Directory per i dati
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });

    // Directory specifica per questo nodo
    const nodeDataDir = path.join(dataDir, config.node.id);
    await fs.mkdir(nodeDataDir, { recursive: true });

    logger.debug('Directory create con successo');
  } catch (error) {
    logger.error('Errore nella creazione delle directory:', error);
    throw error;
  }
}

/**
 * Configura la gestione dell'uscita pulita
 */
function setupCleanShutdown(node) {
  // Gestione interruzione (Ctrl+C)
  process.on('SIGINT', async () => {
    logger.info('Ricevuto segnale di interruzione, arresto del nodo...');
    await node.stop();
    logger.info('Nodo arrestato con successo');
    process.exit(0);
  });

  // Gestione terminazione
  process.on('SIGTERM', async () => {
    logger.info('Ricevuto segnale di terminazione, arresto del nodo...');
    await node.stop();
    logger.info('Nodo arrestato con successo');
    process.exit(0);
  });

  // Gestione eccezioni non catturate
  process.on('uncaughtException', async error => {
    logger.error('Eccezione non catturata:', error);
    try {
      await node.stop();
      logger.info("Nodo arrestato a causa di un'eccezione non catturata");
    } catch (stopError) {
      logger.error("Errore durante l'arresto del nodo:", stopError);
    }
    process.exit(1);
  });

  // Gestione promise non gestite
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Promise rejection non gestita:', reason);
    // Non arrestiamo il nodo in questo caso, ma logghiamo l'errore
  });
}

// Se lo script è eseguito direttamente, avvia il nodo
if (import.meta.url === `file://${process.argv[1]}`) {
  // Analizza gli argomenti da riga di comando
  const options = parseCommandLineArgs();

  // Avvia il nodo
  runNode(options);
}

/**
 * Analizza gli argomenti da riga di comando
 */
function parseCommandLineArgs() {
  const options = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' && i + 1 < args.length) {
      options.port = parseInt(args[++i]);
    } else if (arg === '--data-dir' && i + 1 < args.length) {
      options.dataDir = args[++i];
    } else if (arg === '--bootstrap') {
      options.isBootstrap = true;
    } else if (arg === '--bootstrap-node' && i + 1 < args.length) {
      const bootstrapNodeArg = args[++i];

      if (!options.bootstrapNodes) {
        options.bootstrapNodes = [];
      }

      // Formato atteso: host:port o ID
      if (bootstrapNodeArg.includes(':')) {
        // Formato host:port
        const parts = bootstrapNodeArg.split(':');
        if (parts.length === 2) {
          options.bootstrapNodes.push({
            host: parts[0],
            port: parseInt(parts[1])
          });
        }
      } else {
        // Prova a cercare il nodo per ID nel file centralizzato
        const allNodes = getAllBootstrapNodes();
        const foundNode = allNodes.find(n => n.id === bootstrapNodeArg);
        
        if (foundNode) {
          options.bootstrapNodes.push(foundNode);
        } else {
          console.warn(`Nodo bootstrap con ID ${bootstrapNodeArg} non trovato nel registro centrale`);
        }
      }
    } else if (arg === '--use-central-bootstrap') {
      // Nuova opzione per utilizzare i nodi bootstrap dal file centralizzato
      options.useCentralBootstrap = true;
    } else if (arg === '--mining' && i + 1 < args.length) {
      options.mining = args[++i] === 'true' || args[i] === '1';
    } else if (arg === '--network-type' && i + 1 < args.length) {
      // Nuova opzione per specificare il tipo di rete (normal, demo, ecc.)
      options.networkType = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  // Se richiesto di usare i nodi bootstrap centrali e non sono stati specificati altri nodi
  if (options.useCentralBootstrap && (!options.bootstrapNodes || options.bootstrapNodes.length === 0)) {
    const centralNodes = getAllBootstrapNodes();
    options.bootstrapNodes = centralNodes;
  }

  return options;
}

/**
 * Mostra l'aiuto per l'utilizzo dello script
 */
function showHelp() {
  console.log(`
Drakon Node Runner
=================

Uso: node src/node-runner.js [opzioni]

Opzioni:
  --port NUM                  Porta P2P (la porta API sarà PORT+1000)
  --data-dir PATH             Directory per i dati del nodo
  --bootstrap                 Avvia come nodo bootstrap
  --bootstrap-node HOST:PORT  Aggiungi un nodo bootstrap (può essere ripetuto)
  --bootstrap-node ID         Aggiungi un nodo bootstrap utilizzando il suo ID dal registro centrale
  --use-central-bootstrap     Utilizza i nodi bootstrap dal registro centrale
  --mining BOOL               Abilita o disabilita il mining (true/false)
  --network-type TYPE         Imposta il tipo di rete (normal, demo)
  --help, -h                  Mostra questo aiuto
  
Esempi:
  node src/node-runner.js --port 6001 --bootstrap
  node src/node-runner.js --port 6002 --bootstrap-node 127.0.0.1:6001
  node src/node-runner.js --port 6003 --use-central-bootstrap
  node src/node-runner.js --port 6004 --network-type demo
  `);
}

// Esporta la funzione per l'uso in altri script
export { runNode };
