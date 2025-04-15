import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { Logger } from './utils/logger.js';

const logger = new Logger('TestConnection');

async function testConnection() {
  logger.info('Avvio test di connessione al bootstrap node...');
  
  try {
    // Crea un nodo libp2p di base
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/6099']
      },
      transports: [tcp()],
      connectionEncryption: [noise()],
      streamMuxers: [mplex()],
    });
    
    await node.start();
    logger.info(`Nodo di test avviato con PeerId: ${node.peerId.toString()}`);
    
    // Indirizzo del bootstrap node - aggiornato con i dati corretti dal log
    const bootstrapNodeAddr = '/ip4/34.70.102.121/tcp/6001/p2p/12D3KooWRAECGcdaVotQChTug18kGW9GZiTYrDiu4bLfqSzYTZoH';
    logger.info(`Tentativo di connessione a: ${bootstrapNodeAddr}`);
    
    // Tenta la connessione con un timeout
    const connectPromise = new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connessione scaduta dopo 10 secondi'));
      }, 10000);
      
      try {
        await node.dial(bootstrapNodeAddr);
        clearTimeout(timeout);
        resolve(true);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
    
    await connectPromise;
    logger.info('✅ Connesso con successo al bootstrap node!');
    
    // Stampa le informazioni sulla connessione
    const peers = node.getPeers();
    logger.info(`Numero di peer connessi: ${peers.length}`);
    
    // Attendi un po' e poi arresta il nodo
    await new Promise(resolve => setTimeout(resolve, 5000));
    await node.stop();
    logger.info('Test completato.');
    
    return true;
  } catch (error) {
    logger.error(`❌ Test fallito: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// Esegui il test
testConnection()
  .then(success => {
    if (success) {
      console.log('Test di connessione completato con successo!');
    } else {
      console.log('Test di connessione fallito!');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(err => {
    console.error('Errore durante il test:', err);
    process.exit(1);
  }); 