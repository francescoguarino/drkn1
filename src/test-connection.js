import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { multiaddr } from '@multiformats/multiaddr';
import { Logger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';

const logger = new Logger('TestConnection');

async function testConnection() {
  logger.info('Avvio test di connessione ai bootstrap node...');
  
  try {
    // Crea un nodo libp2p di base
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/6099']
      },
      transports: [tcp()],
      connectionEncryption: [noise()],
      streamMuxers: [mplex()]
    });
    
    // Avvia il nodo
    await node.start();
    logger.info(`Nodo avviato con PeerId: ${node.peerId.toString()}`);
    logger.info(`Indirizzi di ascolto: ${node.getMultiaddrs().map(ma => ma.toString()).join(', ')}`);
    
    // Verifica se esiste un file di configurazione locale per i nodi bootstrap
    const configNodes = await getConfiguredBootstrapNodes();
    
    // Lista bootstrap nodes da testare
    const bootstrapNodes = [
      // Nodo bootstrap principale
      {
        host: '34.70.102.121',
        port: 6001,
        id: '12D3KooWCnKoG36Knx7se5znSmgmJQtfB4rqLNcCjtTs4XJPPc4m'
      },
      
      // Aggiungi i nodi bootstrap configurati localmente
      ...configNodes
    ];
    
    let successfulConnections = 0;
    
    // Testa prima la connessione con PeerId noto
    for (const bootstrap of bootstrapNodes) {
      logger.info('-------------------------------------------');
      logger.info(`Test bootstrap node: ${bootstrap.host}:${bootstrap.port}/p2p/${bootstrap.id}`);
      
      // Tenta la connessione con PeerId noto
      try {
        // Crea l'indirizzo multiaddr con il PeerId noto
        const maWithPeerId = multiaddr(`/ip4/${bootstrap.host}/tcp/${bootstrap.port}/p2p/${bootstrap.id}`);
        
        // Tenta la connessione
        const connection = await node.dial(maWithPeerId);
        
        logger.info('✅ Connessione diretta con PeerId noto riuscita!');
        logger.info(`Connesso al peer con ID: ${connection.remotePeer.toString()}`);
        
        // Attendi alcuni secondi per verificare che la connessione sia stabile
        logger.info('Verifica stabilità connessione (5 secondi)...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        if (node.getPeers().includes(connection.remotePeer.toString())) {
          logger.info('✅ Connessione stabile!');
          successfulConnections++;
          
          // NUOVO: Salva il PeerId effettivo in un file locale per il test di persistenza
          try {
            const persistenceTestDir = path.join(process.cwd(), 'persistence-test');
            
            // Crea la directory se non esiste
            if (!fs.existsSync(persistenceTestDir)) {
              fs.mkdirSync(persistenceTestDir, { recursive: true });
            }
            
            // Salva le informazioni del bootstrap node in un file
            const bootstrapNodeInfo = {
              host: bootstrap.host,
              port: bootstrap.port,
              id: connection.remotePeer.toString(),
              timestamp: new Date().toISOString()
            };
            
            const filePath = path.join(persistenceTestDir, `bootstrap-${bootstrap.host}-${bootstrap.port}.json`);
            fs.writeFileSync(filePath, JSON.stringify(bootstrapNodeInfo, null, 2));
            
            logger.info(`Informazioni bootstrap salvate in: ${filePath}`);
          } catch (saveError) {
            logger.warn(`Errore nel salvataggio informazioni bootstrap: ${saveError.message}`);
          }
        } else {
          logger.warn('⚠️ Connessione instabile o persa');
        }
      } catch (error) {
        logger.error(`❌ Errore nella connessione diretta con PeerId noto: ${error.message}`);
        
        // Prova la connessione senza PeerId
        logger.info('Tentativo di connessione senza PeerId...');
        
        try {
          // Crea l'indirizzo multiaddr senza specificare un PeerId
          const ma = multiaddr(`/ip4/${bootstrap.host}/tcp/${bootstrap.port}`);
          
          // Tenta la connessione
          const connection = await node.dial(ma);
          logger.info('✅ Connessione diretta senza PeerId riuscita!');
          logger.info(`Connesso al peer con ID: ${connection.remotePeer.toString()}`);
          
          // Salva il PeerId effettivo per uso futuro
          logger.info(`PeerId effettivo del bootstrap node: ${connection.remotePeer.toString()}`);
          logger.info(`Indirizzo completo per connessioni future: /ip4/${bootstrap.host}/tcp/${bootstrap.port}/p2p/${connection.remotePeer.toString()}`);
          
          // Attendi 5 secondi per verificare che la connessione sia stabile
          logger.info('Verifica stabilità connessione (5 secondi)...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          if (node.getPeers().includes(connection.remotePeer.toString())) {
            logger.info('✅ Connessione stabile!');
            successfulConnections++;
          } else {
            logger.warn('⚠️ Connessione instabile o persa');
          }
        } catch (error) {
          logger.error(`❌ Errore nella connessione diretta senza PeerId: ${error.message}`);
        }
      }
    }
    
    // Verifica connessioni
    const peers = node.getPeers();
    logger.info('-------------------------------------------');
    logger.info(`Numero di peer connessi: ${peers.length}`);
    logger.info(`Test completati: ${bootstrapNodes.length}, Connessioni riuscite: ${successfulConnections}`);
    
    if (peers.length > 0) {
      logger.info('✅ Connessione alla rete stabilita!');
      
      // Elenca i peer
      for (let i = 0; i < peers.length; i++) {
        logger.info(`Peer #${i+1}: ${peers[i]}`);
      }
    } else {
      logger.warn('⚠️ Nessun peer connesso.');
    }
    
    // Arresta il nodo
    await node.stop();
    logger.info('Test completato.');
    
    return peers.length > 0;
  } catch (error) {
    logger.error(`❌ Test fallito: ${error.message}`);
    logger.error(error.stack);
    
    // Tentativo di arresto nodo in caso di errore
    try {
      if (node) await node.stop();
    } catch (stopError) {
      logger.error(`Errore nell'arresto del nodo: ${stopError.message}`);
    }
    
    return false;
  }
}

/**
 * Cerca di caricare i nodi bootstrap dalla configurazione locale
 */
async function getConfiguredBootstrapNodes() {
  try {
    // Controlla se esiste un file di configurazione bootstrap-nodes.json
    const configPath = path.join(process.cwd(), 'config', 'bootstrap-nodes.json');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      if (Array.isArray(config.nodes)) {
        return config.nodes;
      }
    }
    
    // Se il file non esiste o non contiene un array 'nodes', restituisci array vuoto
    return [];
  } catch (error) {
    logger.warn(`Errore nel caricamento della configurazione bootstrap: ${error.message}`);
    return [];
  }
}

// Esegui il test
testConnection()
  .then(success => {
    if (success) {
      console.log('Test di connessione completato con successo!');
      process.exit(0);
    } else {
      console.log('Test di connessione fallito!');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Errore durante il test:', err);
    process.exit(1);
  }); 