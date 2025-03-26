import { Node } from './core/Node.js';
import config from './config/config.js';
import path from 'path';
import { Logger } from './utils/logger.js';

const logger = new Logger('StartNodes');

async function startNode(nodeId, port) {
  logger.info(`Preparazione configurazione per nodo ${nodeId} sulla porta ${port}`);

  // Determina l'IP locale
  const localIp = getLocalIpAddress();
  logger.info(`Indirizzo IP locale rilevato: ${localIp}`);

  const nodeConfig = {
    ...config,
    node: {
      ...config.node,
      id: nodeId,
      ip: localIp
    },
    p2p: {
      ...config.p2p,
      port: port,
      bootstrapNodes: [{ host: '127.0.0.1', port: 6001 }]
    },
    api: {
      ...config.api,
      port: port + 1000
    },
    mining: {
      enabled: true,
      difficulty: 4,
      threads: 1,
      interval: 30000,
      reward: 50
    },
    blockchain: {
      difficulty: 4,
      miningReward: 50,
      maxTransactionsPerBlock: 10,
      blockInterval: 10000
    },
    storage: {
      path: path.join(process.cwd(), 'db', nodeId),
      maxSize: 1024 * 1024 * 100 // 100MB
    },
    channel: 'drakon-testnet',
    environment: 'development',
    version: '1.0.0'
  };

  logger.info(`Avvio nodo ${nodeId} con indirizzo ${localIp}:${port}`);
  logger.debug(`Configurazione completa:`, JSON.stringify(nodeConfig, null, 2));

  const node = new Node(nodeConfig);

  try {
    await node.start();
    logger.info(`✅ Nodo ${nodeId} avviato con successo sulla porta ${port}`);

    // Aggiungi un handler per gestire l'uscita pulita
    process.on('SIGINT', async () => {
      logger.info(`Arresto del nodo ${nodeId}...`);
      await node.stop();
    });

    return node;
  } catch (error) {
    logger.error(`❌ Errore nell'avvio del nodo ${nodeId}:`, error);
    throw error;
  }
}

// Ottieni l'indirizzo IP locale
function getLocalIpAddress() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Salta gli indirizzi di loopback e non IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  // Fallback a localhost se non è possibile determinare l'IP
  return '127.0.0.1';
}

// Avvia la rete di nodi
async function startNetwork() {
  logger.info('====== AVVIO RETE DRAKON ======');
  logger.info('Inizializzazione della rete locale con 3 nodi');

  const nodes = [];

  try {
    // Avvia il primo nodo (bootstrap)
    logger.info('Avvio del nodo bootstrap...');
    const bootstrapNode = await startNode('bootstrap-node', 6001);
    nodes.push(bootstrapNode);
    logger.info('Nodo bootstrap in esecuzione');

    // Attendi un po' prima di avviare gli altri nodi
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Avvia altri nodi
    for (let i = 1; i <= 2; i++) {
      logger.info(`Avvio del nodo ${i}...`);
      const node = await startNode(`node-${i}`, 6001 + i);
      nodes.push(node);
      logger.info(`Nodo ${i} in esecuzione`);

      // Attendi un po' tra l'avvio dei nodi
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('✅ Tutti i nodi sono stati avviati con successo!');
    logger.info(`Numero totale di nodi in esecuzione: ${nodes.length}`);

    // Ogni 10 secondi, mostra alcune statistiche sulla rete
    const statsInterval = setInterval(async () => {
      try {
        logger.info('==== STATISTICHE RETE ====');
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const stats = await node.getNetworkStats();
          logger.info(
            `Nodo ${i} (${node.config.node.id}): ${
              stats.connections?.length || 0
            } connessioni, uptime: ${Math.floor(stats.uptime)} secondi`
          );
        }
        logger.info('==========================');
      } catch (error) {
        logger.error('Errore nel recupero delle statistiche:', error);
      }
    }, 10000);

    // Mantieni il processo in esecuzione
    process.stdin.resume();

    // Gestisci la pulizia quando l'utente preme Ctrl+C
    process.on('SIGINT', async () => {
      logger.info('Arresto della rete in corso...');
      clearInterval(statsInterval);

      for (const node of nodes) {
        await node.stop().catch(err => logger.error(`Errore nell'arresto del nodo:`, err));
      }

      logger.info('Rete arrestata');
      process.exit(0);
    });

    return nodes;
  } catch (error) {
    logger.error("❌ Errore nell'avvio della rete:", error);

    // Prova ad arrestare tutti i nodi che sono stati avviati
    for (const node of nodes) {
      await node.stop().catch(() => {});
    }

    throw error;
  }
}

// Avvia la rete
startNetwork().catch(error => {
  logger.error('Errore fatale:', error);
  process.exit(1);
});
