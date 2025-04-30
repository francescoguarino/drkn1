import { Node } from './core/Node.js';
import { Logger } from './utils/logger.js';
import { Config } from './config/config.js';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs/promises';
import { displayBanner } from './utils/banner.js';
import { NodeStorage } from './utils/NodeStorage.js';

const logger = new Logger('NodeRunner2');

/**
 * Avvia un nodo Drakon non bootstrap.
 */
async function runNode(options = {}) {
  try {
    logger.info('Inizializzazione nodo Drakon (non bootstrap)...');

    // Crea la configurazione di base
    const config = new Config();
    await config.initialize();

    // Carica informazioni salvate dal NodeStorage
    const nodeStorage = new NodeStorage(config.config);
    const savedInfo = await nodeStorage.loadNodeInfo();

    if (savedInfo && savedInfo.nodeId) {
      logger.info(`Trovate informazioni salvate con ID: ${savedInfo.nodeId}`);
      config.config.node = config.config.node || {};
      config.config.node.id = savedInfo.nodeId;
    } else {
      logger.info('Nessuna informazione salvata trovata, generazione di un nuovo ID...');
      const nodeId = generateNodeId();
      config.config.node = config.config.node || {};
      config.config.node.id = nodeId;
      await nodeStorage.saveNodeInfo({ nodeId });
      logger.info(`Nuovo ID generato e salvato: ${nodeId}`);
    }

    // Configura il nodo come non bootstrap
    config.config.node.isBootstrap = false;

    // Imposta altre configurazioni da opzioni
    if (options.port) {
      config.config.p2p = config.config.p2p || {};
      config.config.p2p.port = options.port;
      config.config.api = config.config.api || {};
      config.config.api.port = options.port + 1000;
    }

    if (options.dataDir) {
      config.config.storage = config.config.storage || {};
      config.config.storage.path = options.dataDir;
    }

    // Crea le directory necessarie
    await ensureDirectories(config.config);

    // Mostra il banner
    displayBanner(config.config);

    // Crea e avvia il nodo
    const node = new Node({
      ...config.config,
      bannerDisplayed: true
    });

    // Gestisci l'uscita pulita
    setupCleanShutdown(node);

    // Avvia il nodo
    await node.start();

    logger.info(`Nodo avviato con successo con ID: ${node.nodeId}`);
    logger.info(`Porta P2P: ${config.config.p2p.port}`);
    logger.info(`Porta API: ${config.config.api.port}`);

    // Mantieni il processo in esecuzione
    process.stdin.resume();

    return node;
  } catch (error) {
    logger.error("Errore durante l'avvio del nodo:", error);
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

/**
 * Genera un ID univoco per il nodo.
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
 * Ottiene l'indirizzo MAC della prima interfaccia di rete non-loopback.
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
 * Crea le directory necessarie.
 */
async function ensureDirectories(config) {
  try {
    await fs.mkdir(config.storage.path, { recursive: true });
    const logDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });
    const nodeDataDir = path.join(dataDir, config.node.id);
    await fs.mkdir(nodeDataDir, { recursive: true });
    logger.debug('Directory create con successo');
  } catch (error) {
    logger.error('Errore nella creazione delle directory:', error);
    throw error;
  }
}

/**
 * Configura la gestione dell'uscita pulita.
 */
function setupCleanShutdown(node) {
  process.on('SIGINT', async () => {
    logger.info('Ricevuto segnale di interruzione, arresto del nodo...');
    await node.stop();
    logger.info('Nodo arrestato con successo');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Ricevuto segnale di terminazione, arresto del nodo...');
    await node.stop();
    logger.info('Nodo arrestato con successo');
    process.exit(0);
  });

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
}

// Se lo script è eseguito direttamente, avvia il nodo
if (process.argv[1].endsWith('node-runner2.js')) {
  const options = parseCommandLineArgs();
  runNode(options)
    .then(() => {
      console.log('Nodo avviato correttamente.');
    })
    .catch(err => {
      console.error('Errore durante l\'avvio del nodo:', err.message);
      process.exit(1);
    });
}

/**
 * Analizza gli argomenti da riga di comando.
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
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Mostra l'aiuto per l'utilizzo dello script.
 */
function showHelp() {
  console.log(`
Drakon Node Runner 2
====================

Uso: node src/node-runner2.js [opzioni]

Opzioni:
  --port NUM              Porta P2P (la porta API sarà PORT+1000)
  --data-dir PATH         Directory per i dati del nodo
  --help, -h              Mostra questo aiuto

Esempi:
  node src/node-runner2.js --port 6001
  node src/node-runner2.js --port 6001 --data-dir ./node-data
  `);
}

export { runNode };
