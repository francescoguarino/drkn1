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

// Inizializzazione logger
const logger = new Logger('BootstrapRunner');
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
    
    // Aggiorna config con il percorso dati bootstrap
    if (!config.config.storage) config.config.storage = {};
    config.config.storage.path = bootstrapDataDir;
    
    // Assicurati che il nodo sia configurato come bootstrap
    if (!config.config.node) config.config.node = {};
    config.config.node.isBootstrap = true;
    
    // Configura il nome del nodo con prefisso bootstrap
    if (!config.config.node.name || !config.config.node.name.startsWith('bootstrap-')) {
      config.config.node.name = `bootstrap-${crypto.randomBytes(4).toString('hex')}`;
    }

    // IMPORTANTE: Verifica se esistono informazioni salvate prima di generare un nuovo ID
    const nodeStorage = new NodeStorage(config.config);
    const savedInfo = await nodeStorage.loadNodeInfo();

    if (savedInfo && savedInfo.nodeId) {
      logger.info(`Trovate informazioni salvate con ID: ${savedInfo.nodeId}`);
      // Usa l'ID salvato
      config.config.node.id = savedInfo.nodeId;
      logger.info(`Utilizzando ID nodo bootstrap salvato: ${savedInfo.nodeId}`);
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
    logger.info(`Nodo di ingresso in ascolto per connessioni...`);

    // Esegui il test di connettività dopo 5 secondi
    setTimeout(() => {
      testBootstrapConnection(node)
        .then(() => {
          logger.info('Test di connettività completato');
        })
        .catch(err => {
          logger.error('Errore nel test di connettività:', err);
        });
    }, 5000);

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
  try {
    logger.info('Test di connettività del nodo bootstrap...');
    
    // Ottieni l'indirizzo IP pubblico
    let ip = process.env.PUBLIC_IP;
    if (!ip) {
      try {
        // Tenta di ottenere l'IP pubblico
        const getIP = () => new Promise((resolve, reject) => {
          exec('curl -s http://checkip.amazonaws.com || curl -s http://ifconfig.me', (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout.trim());
          });
        });
        ip = await getIP();
        logger.info(`IP pubblico rilevato: ${ip}`);
      } catch (e) {
        logger.warn(`Impossibile determinare IP pubblico: ${e.message}`);
        ip = '34.72.27.228'; // Fallback all'IP noto
      }
    }
    
    // Informazioni sul nodo
    const nodePort = node.config.p2p.port || 6001;
    const peerId = node.networkManager.peerId.toString();
    
    // Costruisci gli indirizzi di test
    const publicAddr = `/ip4/${ip}/tcp/${nodePort}/p2p/${peerId}`;
    logger.info(`Indirizzo pubblico da testare: ${publicAddr}`);
    
    // Mostra anche la configurazione attuale di ascolto
    logger.info('Configurazione attuale di ascolto:');
    const listenAddrs = node.networkManager.node.getMultiaddrs();
    listenAddrs.forEach(addr => logger.info(`- ${addr.toString()}`));
    
    // Verifica se la porta è aperta usando un semplice controllo HTTP
    const testPort = (port) => new Promise((resolve) => {
      exec(`nc -zv -w5 localhost ${port}`, (error, stdout, stderr) => {
        if (error) {
          logger.warn(`Porta ${port} non sembra essere aperta localmente: ${stderr}`);
          resolve(false);
        } else {
          logger.info(`Porta ${port} è aperta localmente: ${stderr || stdout}`);
          resolve(true);
        }
      });
    });
    
    // Verifica la porta P2P
    await testPort(nodePort);
    
    logger.info(`Test completato. Il nodo bootstrap dovrebbe essere raggiungibile all'indirizzo: ${publicAddr}`);
    logger.info('Prova ad utilizzare questo indirizzo per connetterti al bootstrap node.');
    logger.info('Se la connessione fallisce, verifica che le porte siano aperte nel firewall.');
    
    return true;
  } catch (error) {
    logger.error('Errore durante il test di connettività:', error);
    return false;
  }
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