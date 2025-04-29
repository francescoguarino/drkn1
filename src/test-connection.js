import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { multiaddr } from '@multiformats/multiaddr';
import { Logger } from './utils/logger.js';
import fetch from 'node-fetch'; // Assicurati che il modulo sia installato

const logger = new Logger('TestConnection');

async function connectToBootstrapNode(node, bootstrapNode, maxRetries = 3, timeout = 5000) {
  const ma = multiaddr(`/ip4/${bootstrapNode.host}/tcp/${bootstrapNode.port}/p2p/${bootstrapNode.id}`);
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      logger.info(`Tentativo ${attempts + 1} di connessione al bootstrap node...`);
      const startTime = Date.now(); // Inizio timer
      const connectionPromise = node.dial(ma);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout di connessione')), timeout)
      );

      await Promise.race([connectionPromise, timeoutPromise]);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2); // Calcola durata
      logger.info(`Connesso al bootstrap node: ${bootstrapNode.id} in ${duration} secondi`);
      return;
    } catch (error) {
      attempts++;
      logger.error(`Errore nella connessione al bootstrap node (tentativo ${attempts}): ${error.message}`);
      if (attempts >= maxRetries) {
        logger.error('Numero massimo di tentativi raggiunto. Impossibile connettersi al bootstrap node.');
        throw error;
      }
    }
  }
}

async function getPeersFromBootstrap(bootstrapNode) {
  const url = `http://${bootstrapNode.host}:${bootstrapNode.apiPort}/api/peers`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Errore HTTP: ${response.status}`);
    }
    const data = await response.json();
    return data.peers || [];
  } catch (error) {
    logger.error(`Errore nel recupero dei peer dal nodo bootstrap: ${error.message}`);
    return [];
  }
}

async function testConnection() {
  logger.info('Avvio test di connessione ai bootstrap node...');
  const startTime = Date.now(); // Inizio timer globale

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
    
    const bootstrapNode = {
      host: '34.147.53.15',
      port: 6001,
      apiPort: 7001, // Porta API del nodo bootstrap
      id: '12D3KooWHpYQpZPyF47Jet5YJ95H48zASx851wzzPAA4Bz7FenCZ'
    };

    // Validazione dei parametri del bootstrap node
    if (!bootstrapNode.host || !bootstrapNode.port || !bootstrapNode.id) {
      throw new Error('Parametri del bootstrap node non validi.');
    }

    try {
      await connectToBootstrapNode(node, bootstrapNode);
    } catch (error) {
      logger.error(`Errore critico: ${error.message}`);
      await node.stop();
      process.exit(1);
    }

    // Recupera la lista dei peer dal nodo bootstrap
    const peers = await getPeersFromBootstrap(bootstrapNode);
    logger.info(`Peer ricevuti dal nodo bootstrap: ${JSON.stringify(peers)}`);

    // Registra eventi di connessione
    node.addEventListener('peer:connect', async (event) => {
      if (event?.detail?.remotePeer) {
        logger.info(`Peer connesso: ${event.detail.remotePeer.toString()}`);

        // Ascolta il messaggio di benvenuto dal bootstrap node
        const connection = node.connectionManager.get(event.detail.remotePeer);
        if (connection) {
          connection.streamManager?.on('data', (data) => {
            const message = data.toString();
            logger.info(`Messaggio di benvenuto ricevuto: ${message}`);
          });
        }
      } else {
        logger.warn('Evento peer:connect ricevuto senza remotePeer definito');
      }
    });

    // Registra eventi di disconnessione
    node.addEventListener('peer:disconnect', (event) => {
      if (event?.detail?.remotePeer) {
        logger.info(`Peer disconnesso: ${event.detail.remotePeer.toString()}`);
      }
    });

    // Gestione di eventi di errore
    node.addEventListener('error', (error) => {
      logger.error(`Errore del nodo: ${error.message}`);
    });

    // Mantieni il nodo attivo per testare la ricezione del messaggio di benvenuto
    process.on('SIGINT', async () => {
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2); // Calcola tempo totale
      logger.info('Ricevuto SIGINT. Arresto del nodo...');
      await node.stop();
      logger.info(`Nodo arrestato. Tempo totale di esecuzione: ${totalTime} secondi.`);
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Errore durante il test di connessione: ${error.message}`);
  }
}

testConnection();