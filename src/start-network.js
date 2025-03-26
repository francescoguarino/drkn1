import { runNode } from './node-runner.js';
import { Logger } from './utils/logger.js';
import { spawn } from 'child_process';
import path from 'path';

const logger = new Logger('NetworkStarter');

/**
 * Avvia una rete di nodi locale per il testing
 * @param {Object} options Opzioni di configurazione
 * @returns {Promise<Object>} Le informazioni sulla rete avviata
 */
async function startNetwork(options = {}) {
  const networkOptions = {
    nodesCount: options.nodesCount || 3,
    basePort: options.basePort || 6001,
    runInSeparateProcesses: options.runInSeparateProcesses !== false,
    bootstrapPort: options.bootstrapPort || 6001
  };

  logger.info(`Avvio rete con ${networkOptions.nodesCount} nodi...`);

  // Array per tenere traccia dei nodi o processi
  const nodes = [];
  const processes = [];

  try {
    // Avvia il nodo bootstrap
    logger.info(`Avvio del nodo bootstrap sulla porta ${networkOptions.bootstrapPort}...`);

    if (networkOptions.runInSeparateProcesses) {
      // Avvia il nodo bootstrap in un processo separato
      const bootstrapProcess = spawnNodeProcess({
        port: networkOptions.bootstrapPort,
        isBootstrap: true
      });
      processes.push(bootstrapProcess);

      // Attendiamo che il nodo bootstrap sia pronto
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      // Avvia il nodo bootstrap nello stesso processo
      const bootstrapNode = await runNode({
        port: networkOptions.bootstrapPort,
        isBootstrap: true
      });
      nodes.push(bootstrapNode);
    }

    // Avvia gli altri nodi
    for (let i = 1; i < networkOptions.nodesCount; i++) {
      const nodePort = networkOptions.basePort + i;
      logger.info(`Avvio del nodo ${i} sulla porta ${nodePort}...`);

      const nodeOptions = {
        port: nodePort,
        bootstrapNodes: [{ host: '127.0.0.1', port: networkOptions.bootstrapPort }]
      };

      if (networkOptions.runInSeparateProcesses) {
        // Avvia il nodo in un processo separato
        const nodeProcess = spawnNodeProcess(nodeOptions);
        processes.push(nodeProcess);

        // Attendi un po' tra l'avvio dei nodi
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Avvia il nodo nello stesso processo
        const node = await runNode(nodeOptions);
        nodes.push(node);
      }
    }

    logger.info(`Rete avviata con successo con ${networkOptions.nodesCount} nodi`);

    if (networkOptions.runInSeparateProcesses) {
      // Configura gestori per la chiusura dei processi
      setupProcessCleanup(processes);

      return {
        processes,
        nodesCount: networkOptions.nodesCount,
        bootstrapPort: networkOptions.bootstrapPort
      };
    } else {
      return {
        nodes,
        nodesCount: networkOptions.nodesCount,
        bootstrapPort: networkOptions.bootstrapPort
      };
    }
  } catch (error) {
    logger.error("Errore durante l'avvio della rete:", error);

    // In caso di errore, arresta tutti i nodi/processi
    if (networkOptions.runInSeparateProcesses) {
      stopAllProcesses(processes);
    } else {
      await stopAllNodes(nodes);
    }

    throw error;
  }
}

/**
 * Avvia un nodo in un processo separato
 */
function spawnNodeProcess(options) {
  const scriptPath = path.join(process.cwd(), 'src', 'node-runner.js');
  const args = [scriptPath];

  // Aggiungi le opzioni come argomenti
  if (options.port) {
    args.push('--port', options.port.toString());
  }

  if (options.isBootstrap) {
    args.push('--bootstrap');
  }

  if (options.bootstrapNodes) {
    for (const node of options.bootstrapNodes) {
      args.push('--bootstrap-node', `${node.host}:${node.port}`);
    }
  }

  if (options.dataDir) {
    args.push('--data-dir', options.dataDir);
  }

  if (options.mining !== undefined) {
    args.push('--mining', options.mining ? 'true' : 'false');
  }

  // Avvia il processo
  const nodeProcess = spawn('node', args, {
    stdio: 'inherit', // Reindirizza stdout e stderr alla console
    detached: false
  });

  // Gestisci gli eventi del processo
  nodeProcess.on('error', error => {
    logger.error(`Errore nel processo del nodo:`, error);
  });

  return nodeProcess;
}

/**
 * Configura la gestione della chiusura dei processi
 */
function setupProcessCleanup(processes) {
  process.on('SIGINT', () => {
    logger.info('Arresto della rete in corso...');
    stopAllProcesses(processes);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Arresto della rete in corso...');
    stopAllProcesses(processes);
    process.exit(0);
  });
}

/**
 * Arresta tutti i processi dei nodi
 */
function stopAllProcesses(processes) {
  logger.info(`Arresto di ${processes.length} processi...`);

  for (const nodeProcess of processes) {
    if (nodeProcess && !nodeProcess.killed) {
      nodeProcess.kill('SIGINT');
    }
  }
}

/**
 * Arresta tutti i nodi
 */
async function stopAllNodes(nodes) {
  logger.info(`Arresto di ${nodes.length} nodi...`);

  for (const node of nodes) {
    if (node) {
      try {
        await node.stop();
      } catch (error) {
        logger.error("Errore nell'arresto del nodo:", error);
      }
    }
  }
}

// Se lo script è eseguito direttamente, avvia la rete
if (import.meta.url === `file://${process.argv[1]}`) {
  // Analizza gli argomenti da riga di comando
  const options = parseCommandLineArgs();

  // Avvia la rete
  startNetwork(options).catch(error => {
    logger.error('Errore fatale:', error);
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

    if (arg === '--nodes' && i + 1 < args.length) {
      options.nodesCount = parseInt(args[++i]);
    } else if (arg === '--base-port' && i + 1 < args.length) {
      options.basePort = parseInt(args[++i]);
    } else if (arg === '--same-process') {
      options.runInSeparateProcesses = false;
    } else if (arg === '--separate-processes') {
      options.runInSeparateProcesses = true;
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
Drakon Network Starter
======================

Uso: node src/start-network.js [opzioni]

Opzioni:
  --nodes NUM             Numero di nodi da avviare (default: 3)
  --base-port NUM         Porta di base per la rete P2P (default: 6001)
  --same-process          Avvia tutti i nodi nello stesso processo
  --separate-processes    Avvia ogni nodo in un processo separato (default)
  --help, -h              Mostra questo aiuto

Esempi:
  node src/start-network.js --nodes 5
  node src/start-network.js --nodes 3 --base-port 7001
  node src/start-network.js --same-process
`);
}

// Esporta la funzione per l'uso in altri script
export { startNetwork };
