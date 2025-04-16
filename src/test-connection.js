// IMPORTANTE: Questo file usa una versione fissata di undici (5.28.4) per evitare l'errore 'Cannot read properties of undefined (reading 'close')'
// Questo errore è causato da un bug noto in libp2p o nelle sue dipendenze e verrà risolto in versioni future.

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { multiaddr } from '@multiformats/multiaddr';
import { Logger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';
import { ping } from '@libp2p/ping';
import undici from 'undici';

const logger = new Logger('TestConnection');
const TEST_DURATION = 60; // Durata del test in secondi
const PING_INTERVAL = 5; // Intervallo di ping in secondi
const RECONNECT_INTERVAL = 10; // Intervallo di riconnessione in secondi

// Verifica la versione di undici
logger.info(`Versione di undici: ${undici.VERSION || 'sconosciuta'}`);

// Verifica se esiste la versione corretta di undici
if (!undici.VERSION || undici.VERSION !== '5.28.4') {
  logger.warn('⚠️ Versione di undici non corretta. La versione consigliata è 5.28.4 per evitare errori di connessione');
  logger.warn('Per installare la versione corretta, esegui: npm install undici@5.28.4');
}

async function testConnection() {
  logger.info('Avvio test di connessione ai bootstrap node...');
  
  try {
    // Crea un nodo libp2p di base con ping e configurazione di connessione più robusta
    const node = await createLibp2p({
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/6099']
      },
      transports: [
        tcp({
          // Opzioni TCP più dettagliate per diagnosticare problemi di connessione
          keepAlive: true,
          keepAliveInitialDelay: 10000, // 10 secondi
          noDelay: true, // Disabilita l'algoritmo di Nagle (aiuta piccoli pacchetti)
          timeout: 30000, // Timeout della connessione TCP
          headerTimeout: 60000 // Timeout del protocollo
        })
      ],
      connectionEncryption: [noise()],
      streamMuxers: [mplex()],
      services: {
        ping: ping()
      },
      connectionManager: {
        maxConnections: 50, // Massimo numero di connessioni
        minConnections: 1, // Connessioni minime da mantenere
        autoDial: true, // Auto-dialogo con i peer conosciuti
        pollInterval: 5000 // Controllo ogni 5 secondi
      },
      connectionGater: {
        // Permetti tutte le connessioni durante i test
        denyDialMultiaddr: () => false,
        denyDialPeer: () => false,
        denyInboundConnection: () => false,
        denyOutboundConnection: () => false,
        denyInboundEncryptedConnection: () => false,
        denyOutboundEncryptedConnection: () => false,
        denyInboundUpgradedConnection: () => false,
        denyOutboundUpgradedConnection: () => false
      }
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
        host: '34.147.53.15',
        port: 6001,
        id: '12D3KooWHpYQpZPyF47Jet5YJ95H48zASx851wzzPAA4Bz7FenCZ'
      },
      
      // Aggiungi i nodi bootstrap configurati localmente
      ...configNodes
    ];
    
    let successfulConnections = 0;
    let connectedPeers = [];
    let connectionLossTime = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    
    // Registra eventi di connessione con controllo null/undefined migliorato
    node.addEventListener('peer:connect', (event) => {
      try {
        // Verifica se l'evento e dettagli sono definiti
        if (!event) {
          logger.warn('⚠️ Evento peer:connect ricevuto senza oggetto evento');
          return;
        }
        
        if (!event.detail) {
          logger.warn('⚠️ Evento peer:connect ricevuto senza event.detail');
          return;
        }
        
        // Controllo remotePeer
        if (event.detail.remotePeer) {
          const peerId = event.detail.remotePeer.toString();
          logger.info(`👋 Evento peer:connect - Peer ${peerId} connesso`);
        } else {
          logger.warn('⚠️ Evento peer:connect ricevuto senza remotePeer definito');
        }
      } catch (error) {
        logger.error(`Errore nella gestione dell'evento peer:connect: ${error.message}`);
      }
    });
    
    // Registra eventi di disconnessione con controllo null/undefined migliorato
    node.addEventListener('peer:disconnect', (event) => {
      try {
        // Verifica se l'evento e dettagli sono definiti
        if (!event) {
          logger.warn('⚠️ Evento peer:disconnect ricevuto senza oggetto evento');
          return;
        }
        
        if (!event.detail) {
          logger.warn('⚠️ Evento peer:disconnect ricevuto senza event.detail');
          return;
        }
        
        // Controllo remotePeer
        if (event.detail.remotePeer) {
          const peerId = event.detail.remotePeer.toString();
          logger.info(`👋 Evento peer:disconnect - Peer ${peerId} disconnesso`);
        } else {
          logger.warn('⚠️ Evento peer:disconnect ricevuto senza remotePeer definito');
        }
      } catch (error) {
        logger.error(`Errore nella gestione dell'evento peer:disconnect: ${error.message}`);
      }
    });
    
    // Funzione di riconnessione
    const attemptReconnect = async (bootstrap, remotePeerId) => {
      if (reconnectAttempts >= maxReconnectAttempts) {
        logger.warn(`Raggiunto il numero massimo di tentativi di riconnessione (${maxReconnectAttempts})`);
        return false;
      }
      
      reconnectAttempts++;
      logger.info(`Tentativo di riconnessione #${reconnectAttempts} al bootstrap node: ${bootstrap.host}:${bootstrap.port}/p2p/${bootstrap.id}`);
      
      try {
        // Crea l'indirizzo multiaddr per la riconnessione
        const maWithPeerId = multiaddr(`/ip4/${bootstrap.host}/tcp/${bootstrap.port}/p2p/${bootstrap.id}`);
        
        // Tenta la riconnessione
        const connection = await node.dial(maWithPeerId);
        
        // Verifica se la connessione è valida
        if (!connection) {
          logger.warn('⚠️ Riconnessione ha restituito un oggetto connessione non valido');
          return false;
        }
        
        // Verifica se remotePeer è definito
        if (!connection.remotePeer) {
          logger.warn('⚠️ Riconnessione ha restituito un oggetto connessione senza remotePeer');
          return false;
        }
        
        logger.info(`✅ Riconnessione riuscita al peer ${connection.remotePeer.toString()}`);
        
        // Verifica che sia lo stesso peer
        if (connection.remotePeer.toString() === remotePeerId) {
          logger.info('✅ Riconnesso allo stesso peer remoto');
        } else {
          logger.warn(`⚠️ Riconnesso a un peer diverso (${connection.remotePeer.toString()} != ${remotePeerId})`);
        }
        
        return true;
      } catch (error) {
        logger.error(`❌ Errore nella riconnessione: ${error.message}`);
        return false;
      }
    };
    
    // Configura un event listener per le chiusure di connessione con controlli migliorati
    node.addEventListener('connection:close', (event) => {
      try {
        // Verifica se l'evento e dettagli sono definiti
        if (!event) {
          logger.warn('⚠️ Evento connection:close ricevuto senza oggetto evento');
          connectionLossTime = new Date();
          return;
        }
        
        if (!event.detail) {
          logger.warn('⚠️ Evento connection:close ricevuto senza event.detail');
          connectionLossTime = new Date();
          return;
        }
        
        // Controlla di quale peer si tratta
        if (event.detail.remotePeer) {
          const peerId = event.detail.remotePeer.toString();
          logger.warn(`⚠️ Connessione chiusa con ${peerId}`);
          connectionLossTime = new Date();
        } else {
          logger.warn('⚠️ Evento connection:close ricevuto senza remotePeer definito');
          connectionLossTime = new Date();
        }
      } catch (error) {
        logger.error(`Errore nella gestione dell'evento connection:close: ${error.message}`);
        connectionLossTime = new Date();
      }
    });
    
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
        
        // Verifica se la connessione è valida
        if (!connection) {
          logger.warn('⚠️ La connessione ha restituito un oggetto connessione non valido');
          continue;
        }
        
        // Verifica se remotePeer è definito
        if (!connection.remotePeer) {
          logger.warn('⚠️ La connessione ha restituito un oggetto connessione senza remotePeer');
          continue;
        }
        
        logger.info('✅ Connessione diretta con PeerId noto riuscita!');
        logger.info(`Connesso al peer con ID: ${connection.remotePeer.toString()}`);
        
        // Salva il peer connesso
        connectedPeers.push({
          peerId: connection.remotePeer.toString(),
          multiaddr: maWithPeerId.toString()
        });
        
        // Test di ping attivo iniziale
        try {
          // Verifica che il servizio ping e remotePeer siano definiti
          if (!node.services || !node.services.ping) {
            logger.warn('⚠️ Servizio ping non disponibile');
          } else if (!connection.remotePeer) {
            logger.warn('⚠️ RemotePeer non definito per il ping');
          } else {
            const pingResults = await node.services.ping.ping(connection.remotePeer);
            logger.info(`🏓 Ping iniziale: ${pingResults.latency} ms`);
          }
        } catch (pingError) {
          logger.warn(`❌ Errore nel ping iniziale: ${pingError.message}`);
          logger.info(`Verifica stato connessione dopo errore ping: ${node.getPeers().includes(connection.remotePeer.toString()) ? 'ancora connesso' : 'disconnesso'}`);
        }
        
        // Attendi alcuni secondi per verificare che la connessione sia stabile
        logger.info(`Verifica stabilità connessione (${TEST_DURATION} secondi)...`);
        
        // Invia ping al peer ogni PING_INTERVAL secondi
        const pingIntervalId = setInterval(async () => {
          // Verifica lo stato di connessione
          const isConnected = node.getPeers().includes(connection.remotePeer.toString());
          logger.info(`Stato connessione corrente: ${isConnected ? 'connesso' : 'disconnesso'}`);
          
          // Verifica se la connessione è ancora attiva
          if (isConnected) {
            // Invia ping attivo
            try {
              // Verifica che il servizio ping e remotePeer siano definiti
              if (!node.services || !node.services.ping) {
                logger.warn('⚠️ Servizio ping non disponibile');
              } else if (!connection.remotePeer) {
                logger.warn('⚠️ RemotePeer non definito per il ping');
              } else {
                const pingResults = await node.services.ping.ping(connection.remotePeer);
                logger.info(`🏓 Ping: ${pingResults.latency} ms`);
              }
            } catch (pingError) {
              logger.warn(`❌ Errore nel ping: ${pingError.message}`);
              
              // Verifica se il peer è ancora nella lista ma il ping fallisce
              if (node.getPeers().includes(connection.remotePeer.toString())) {
                logger.warn('⚠️ Il peer è ancora nella lista ma il ping fallisce');
              }
            }
          } else {
            logger.warn('⚠️ Connessione persa durante il test');
            logger.info(`Ora disconnessione: ${connectionLossTime || 'sconosciuta'}`);
            
            // Se la connessione è stata persa da più di RECONNECT_INTERVAL secondi, tenta la riconnessione
            if (connectionLossTime && (new Date() - connectionLossTime) > RECONNECT_INTERVAL * 1000) {
              const reconnectSuccess = await attemptReconnect(bootstrap, connection.remotePeer.toString());
              connectionLossTime = reconnectSuccess ? null : connectionLossTime;
            }
          }
        }, PING_INTERVAL * 1000);
        
        // Attendi per la durata del test
        await new Promise(resolve => setTimeout(resolve, TEST_DURATION * 1000));
        
        // Ferma l'invio periodico di ping
        clearInterval(pingIntervalId);
        
        if (node.getPeers().includes(connection.remotePeer.toString())) {
          logger.info('✅ Connessione stabile!');
          successfulConnections++;
          
          // Informazioni aggiuntive per diagnostica
          logger.info(`Numero totale di peer nella lista: ${node.getPeers().length}`);
          
          // Salva il PeerId effettivo in un file locale per il test di persistenza
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
          
          // Controlla se è stato possibile riconnettersi
          logger.info(`Tentativi di riconnessione effettuati: ${reconnectAttempts}`);
          if (reconnectAttempts > 0 && node.getPeers().includes(connection.remotePeer.toString())) {
            logger.info('✅ Riconnessione riuscita, connessione ristabilita');
            successfulConnections++;
          }
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
          
          // Verifica se la connessione è valida
          if (!connection) {
            logger.warn('⚠️ La connessione ha restituito un oggetto connessione non valido');
            continue;
          }
          
          // Verifica se remotePeer è definito
          if (!connection.remotePeer) {
            logger.warn('⚠️ La connessione ha restituito un oggetto connessione senza remotePeer');
            continue;
          }
          
          logger.info('✅ Connessione diretta senza PeerId riuscita!');
          logger.info(`Connesso al peer con ID: ${connection.remotePeer.toString()}`);
          
          // Salva il PeerId effettivo per uso futuro
          logger.info(`PeerId effettivo del bootstrap node: ${connection.remotePeer.toString()}`);
          logger.info(`Indirizzo completo per connessioni future: /ip4/${bootstrap.host}/tcp/${bootstrap.port}/p2p/${connection.remotePeer.toString()}`);
          
          // Test di ping
          try {
            // Verifica che il servizio ping e remotePeer siano definiti
            if (!node.services || !node.services.ping) {
              logger.warn('⚠️ Servizio ping non disponibile');
            } else if (!connection.remotePeer) {
              logger.warn('⚠️ RemotePeer non definito per il ping');
            } else {
              const pingResults = await node.services.ping.ping(connection.remotePeer);
              logger.info(`🏓 Ping: ${pingResults.latency} ms`);
            }
          } catch (pingError) {
            logger.warn(`❌ Errore nel ping: ${pingError.message}`);
          }
          
          // Attendi per verificare che la connessione sia stabile
          logger.info('Verifica stabilità connessione (10 secondi)...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          
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
      if (typeof node !== 'undefined') await node.stop();
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