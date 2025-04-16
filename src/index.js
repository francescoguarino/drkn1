import { runNode } from './node-runner.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('DrakonIndex');

/**
 * Funzione principale per l'avvio del nodo
 */
async function main(args = {}) {
  try {
    logger.info('Inizializzazione Drakon Node...');

    // Se non è specificato un bootstrap node, usa il nostro nodo default
    if (!args['bootstrap-node'] && !process.env.BOOTSTRAP_NODES) {
      logger.info('Utilizzo bootstrap node predefinito: 34.70.102.121:6001');
      process.env.BOOTSTRAP_NODES = JSON.stringify([{
        host: '34.70.102.121',
        port: 6001,
        id: '12D3KooWNF7YUcH1tbAW2Rcewy5t9z1RRDRZJ7AdrPauASxmDTr8'
      }]);
    }
    
    // Avvia il nodo con gli argomenti forniti
    runNode(args);
  } catch (error) {
    logger.error('Errore durante l\'inizializzazione del nodo:', error);
  }
}

// Analizza gli argomenti da riga di comando
function parseCommandLineArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  
  return args;
}

// Avvia il nodo passando gli argomenti della riga di comando
const args = parseCommandLineArgs();
main(args);
