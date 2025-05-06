// IMPORTANTE: Questo file usa una versione fissata di undici (5.28.4) per evitare l'errore 'Cannot read properties of undefined (reading 'close')'
// Questo errore è causato da un bug noto in libp2p o nelle sue dipendenze e verrà risolto in versioni future.

import { BootstrapNode } from './core/BootstrapNode.js';
import { Logger } from './utils/logger.js';
import { Config } from './config/config.js';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs/promises';
import { displayBootstrapBanner } from './utils/banner.js';
import { NodeStorage } from './utils/NodeStorage.js';
import { addBootstrapNode } from './config/bootstrap-nodes.js';
import { exec } from 'child_process';
import undici from 'undici';

// Dopo l'import aggiungi un log per verificare la versione di undici
const logger = new Logger('BootstrapRunner');
logger.info(`Versione di undici: ${undici.VERSION || 'sconosciuta'}`);

// Inizializzazione logger
logger.info('Inizializzazione nodo bootstrap Drakon ENTER...');

/**
 * Avvia un nodo bootstrap Drakon, che serve come punto di ingresso nella rete.
 * Il nodo bootstrap mantiene il suo ID tra i riavvii e accetta connessioni in entrata.
 */
async function runBootstrapNode(options = {}) {
  try {
    // Crea la configurazione di base
    const config = new Config();
    await config.initialize();

    // Imposta il percorso dati specifico per il bootstrap
    const bootstrapDataDir = options.dataDir || path.join(process.cwd(), 'bootstrap-db');
    
    // Assicurati che il percorso sia assoluto (importante per la persistenza)
    const absoluteDataDir = path.resolve(bootstrapDataDir);
    logger.info(`Percorso dati bootstrap (assoluto): ${absoluteDataDir}`);
    
    // Aggiorna config con il percorso dati bootstrap
    if (!config.config.storage) config.config.storage = {};
    config.config.storage.path = absoluteDataDir;
    
    // Assicurati che il nodo sia configurato come bootstrap
    if (!config.config.node) config.config.node = {};
    config.config.node.isBootstrap = true;
    config.config.node.dataDir = absoluteDataDir; // Importante: imposta anche dataDir
    
    // Configura il nome del nodo con prefisso bootstrap
    if (!config.config.node.name || !config.config.node.name.startsWith('bootstrap-')) {
      config.config.node.name = `bootstrap-${crypto.randomBytes(4).toString('hex')}`;
    }

    
    // IMPORTANTE: Verifica se esistono informazioni salvate prima di generare un nuovo ID
    const nodeStorage = new NodeStorage(config.config);
    const savedInfo = await nodeStorage.loadNodeInfo();

    // Stampa informazioni dettagliate su cosa è stato trovato
    logger.info(`Percorso storage: ${path.join(absoluteDataDir, 'storage')}`);
    logger.info(`File info nodo: ${path.join(absoluteDataDir, 'storage', 'node-info.json')}`);
    logger.info(`Informazioni salvate trovate: ${!!savedInfo}`);
    if (savedInfo) {
      logger.info(`Contenuto informazioni: ${JSON.stringify({
        nodeId: savedInfo.nodeId || 'non trovato ',
        hasPeerId: !!savedInfo.peerId,
        peerIdType: savedInfo.peerId ? typeof savedInfo.peerId : 'non trovato',
        peerIdComplete: savedInfo.peerId && typeof savedInfo.peerId === 'object' && 
                     savedInfo.peerId.privKey && savedInfo.peerId.pubKey
      })}`);
    }

    if (savedInfo && savedInfo.nodeId) {
      logger.info(`Trovate informazioni salvate con ID: ${savedInfo.nodeId}`);
      // Usa l'ID salvato
      config.config.node.id = savedInfo.nodeId;
      logger.info(`Utilizzando ID nodo bootstrap salvato: ${savedInfo.nodeId}`);
      
      // Verifica se abbiamo un PeerId salvato
      if (savedInfo.peerId) {
        logger.info(`Trovato anche PeerId salvato: ${typeof savedInfo.peerId === 'string' ? savedInfo.peerId : savedInfo.peerId.id}`);
        // Imposta esplicitamente nella configurazione che questo PeerId deve essere riutilizzato
        config.config.p2p = config.config.p2p || {};
        config.config.p2p.persistentPeerId = true;
        
        // Se abbiamo l'oggetto PeerId completo con chiavi, impostiamo anche quelle
        if (typeof savedInfo.peerId === 'object' && savedInfo.peerId.privKey && savedInfo.peerId.pubKey) {
          logger.info('Impostazione chiavi PeerId salvate per il riutilizzo');
          config.config.p2p.savedPeerId = savedInfo.peerId;
        }
      } else {
        logger.warn('ID nodo trovato ma PeerId mancante. Verrà generato un nuovo PeerId.');
      }
    } else {
      // Genera un ID univoco e stabile per questo nodo bootstrap
      logger.info('Nessuna informazione del nodo bootstrap trovata, verrà generato un nuovo ID');
      const nodeId = generateBootstrapId();
      config.config.node.id = nodeId;
      logger.info(`Generato nuovo ID bootstrap: ${nodeId}`);
      
      // Salva immediatamente l'ID per usi futuri
      await nodeStorage.saveNodeInfo({ nodeId });
      logger.info(`ID bootstrap salvato per usi futuri: ${nodeId}`);
    }

    // Imposta le porte P2P e API
    if (options.port) {
      config.config.p2p = config.config.p2p || {};
      config.config.p2p.port = options.port;
      config.config.api = config.config.api || {};
      config.config.api.port = options.port + 1000;      
    }

    // MODIFICATO: Disabilita la connessione ad altri nodi bootstrap
    if (config.config.p2p) {
      config.config.p2p.bootstrapNodes = [];
    }

    // MODIFICATO: Imposta il tipo di rete a "demo"
    if (!config.config.network) {
      config.config.network = {
        type: 'demo',
        maxPeers: 50,
        peerTimeout: 30000
      };
    } else {
      config.config.network.type = 'demo';
    }
    
    // Crea le directory necessarie
    await ensureDirectories(config.config);

    // Mostra il banner specifico per nodo ENTER
    displayBootstrapBanner(config.config);

    // MODIFICATO: Usa la nuova classe BootstrapNode invece di Node
    const node = new BootstrapNode({
      ...config.config,
      bannerDisplayed: true
    });

    // Aggiungiamo più log per il debug del PeerId
    logger.info('==== DEBUG AVVIO NODO BOOTSTRAP ====');
    logger.info(`ID Nodo: ${config.config.node.id}`);
    if (savedInfo && savedInfo.peerId) {
      logger.info(`PeerId salvato: ${savedInfo.peerId.id}`);
    } else {
      logger.info('Nessun PeerId salvato trovato');
    }
    logger.info('=====================================');

    // AGGIUNTO: Registra questo nodo bootstrap nella lista centrale
    // Verrà fatto solo in memoria per ora, ma in futuro si potrebbe implementare
    // un sistema di persistenza più avanzato
    const nodeInfo = {
      id: config.config.node.id,
      host: config.config.p2p.host || '0.0.0.0',
      port: config.config.p2p.port,
      name: config.config.node.name,
      isOfficial: false,
      status: 'active',
      location: 'local'
    };
    addBootstrapNode(nodeInfo);
    logger.info(`Nodo bootstrap registrato nella lista centrale: ${nodeInfo.id}`);

    // NOTA: Non è più necessario aggiungere handler per le connessioni in entrata
    // perché sono già gestiti dalla classe BootstrapNode

    // Gestisci l'uscita pulita
    setupCleanShutdown(node);

    // Avvia il nodo
    await node.start();

    // Usa il nodeId dal nodo avviato, che sarà quello corretto
    logger.info(`DRAKON ENTER NODE avviato con successo - ID: ${node.nodeId}`);
    logger.info(`Porta P2P: ${config.config.p2p.port}`);
    logger.info(`Porta API: ${config.config.api.port}`);
    
    // Ottieni l'indirizzo IP corrente
    const publicIp = process.env.PUBLIC_IP || '127.0.0.1';
    const peerId = node.networkManager.node.peerId.toString();
    const port = config.config.p2p.port;
    
    // IMPORTANTE: Salva il PeerId per usi futuri, anche se è lo stesso di prima
    // Questo assicura che tutte le informazioni del PeerId vengano salvate correttamente
    await nodeStorage.saveNodeInfo({
      nodeId: node.nodeId,
      peerId: {
        id: peerId,
        privKey: node.networkManager.node.peerId.privateKey 
          ? Buffer.from(node.networkManager.node.peerId.privateKey).toString('base64')
          : null,
        pubKey: node.networkManager.node.peerId.publicKey 
          ? Buffer.from(node.networkManager.node.peerId.publicKey).toString('base64')
          : null
      }
    });
    logger.info(`PeerId salvato per future esecuzioni: ${peerId}`);
    
    // Mostra l'indirizzo completo per la connessione
    logger.info('');
    logger.info('==== INFORMAZIONI DI CONNESSIONE ====');
    logger.info(`Indirizzo completo per connessione: /ip4/${publicIp}/tcp/${port}/p2p/${peerId}`);
    logger.info('Per connettersi a questo nodo bootstrap, utilizzare:');
    logger.info(`Host: ${publicIp}`);
    logger.info(`Porta: ${port}`);
    logger.info(`PeerId: ${peerId}`);
    logger.info('===================================');
    logger.info('');
    
    logger.info(`Nodo di ingresso in ascolto per connessioni...`);

    // Aggiungi event listeners per connessioni e disconnessioni
    node.networkManager.on('peer:connect', () => {
      logger.info('Peer connesso, stampo riepilogo aggiornato');
      // Stampa il riepilogo aggiornato con il PeerId corretto
      node.networkManager._printSummaryTable();
      
    });

    node.networkManager.on('peer:disconnect', () => {
      logger.info('Peer disconnesso, stampo riepilogo aggiornato');
      // Stampa il riepilogo aggiornato
      node.networkManager._printSummaryTable();
    });

    // Mantieni il processo in esecuzione
    process.stdin.resume();

    return node;
  } catch (error) {
    logger.error("Errore durante l'avvio del nodo bootstrap:", error);

    // Log più dettagliato per il debug
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }

    process.exit(1);
  }
}

/**
 * Genera un ID univoco e stabile per il nodo bootstrap
 */
function generateBootstrapId() {
  const hostname = os.hostname();
  const macAddress = getMacAddress();
  const timestamp = new Date().toISOString().split('T')[0]; // Solo la data, non l'ora
  
  // Usa dati più stabili per generare l'ID
  const data = `bootstrap-${hostname}-${macAddress}-${timestamp}`;
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

    // Directory specifica per questo nodo bootstrap
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
    logger.info('Ricevuto segnale di interruzione, arresto del nodo bootstrap...');
    await node.stop();
    logger.info('Nodo bootstrap arrestato con successo');
    process.exit(0);
  });

  // Gestione terminazione
  process.on('SIGTERM', async () => {
    logger.info('Ricevuto segnale di terminazione, arresto del nodo bootstrap...');
    await node.stop();
    logger.info('Nodo bootstrap arrestato con successo');
    process.exit(0);
  });

  // Gestione eccezioni non catturate
  process.on('uncaughtException', async error => {
    logger.error('Eccezione non catturata:', error);
    try {
      await node.stop();
      logger.info("Nodo bootstrap arrestato a causa di un'eccezione non catturata");
    } catch (stopError) {
      logger.error("Errore durante l'arresto del nodo bootstrap:", stopError);
    }
    process.exit(1);
  });
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
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Mostra l'aiuto per l'utilizzo dello script
 */
function showHelp() {
  console.log(`
Drakon ENTER Node Runner
==========================

Uso: node src/bootstrap-runner.js [opzioni]

Opzioni:
  --port NUM              Porta P2P (la porta API sarà PORT+1000)
  --data-dir PATH         Directory per i dati del nodo bootstrap
  --help, -h              Mostra questo aiuto
  
Esempi:
  node src/bootstrap-runner.js --port 6001
  node src/bootstrap-runner.js --port 6001 --data-dir ./bootstrap-data
  `);
}

/**
 * Testa se il nodo bootstrap è raggiungibile
 */
async function testBootstrapConnection(node) {
  // Test di connettività rimosso
  return true;
}

// Se lo script è eseguito direttamente, avvia il nodo bootstrap
const runOptions = parseCommandLineArgs();
console.log('Opzioni:', runOptions);

// Avvio del nodo bootstrap
runBootstrapNode(runOptions)
  .then(node => {
    console.log('DRAKON ENTER NODE avviato con successo:', node.nodeId);
  })
  .catch(error => {
    console.error('Errore durante avvio bootstrap node:', error);
    process.exit(1);
  });

export { runBootstrapNode }; 