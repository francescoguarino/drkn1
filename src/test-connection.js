import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { multiaddr } from '@multiformats/multiaddr';
import { Logger } from './utils/logger.js';

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

    // Registra eventi di connessione
    node.addEventListener('peer:connect', (event) => {
      if (event?.detail?.remotePeer) {
        logger.info(`Peer connesso: ${event.detail.remotePeer.toString()}`);

        // Invia messaggi periodici al peer
        const intervalId = setInterval(() => {
          const message = `Ping from ${node.peerId.toString()} at ${new Date().toISOString()}`;
          node.connectionManager.get(event.detail.remotePeer)?.streamManager?.write(message);
          logger.info(`Messaggio inviato al peer ${event.detail.remotePeer.toString()}: ${message}`);
        }, 5000);

        // Salva l'intervallo per cancellarlo alla disconnessione
        event.detail.remotePeer.intervalId = intervalId;
      } else {
        logger.warn('Evento peer:connect ricevuto senza remotePeer definito');
      }
    });

    // Registra eventi di disconnessione
    node.addEventListener('peer:disconnect', (event) => {
      if (event?.detail?.remotePeer) {
        logger.info(`Peer disconnesso: ${event.detail.remotePeer.toString()}`);

        // Cancella l'intervallo dei messaggi
        clearInterval(event.detail.remotePeer.intervalId);
      } else {
        logger.warn('Evento peer:disconnect ricevuto senza remotePeer definito');
      }
    });

    // Testa la connessione a un nodo bootstrap
    const bootstrapNode = {
      host: '34.147.53.15',
      port: 6001,
      id: '12D3KooWHpYQpZPyF47Jet5YJ95H48zASx851wzzPAA4Bz7FenCZ'
    };

    try {
      const ma = multiaddr(`/ip4/${bootstrapNode.host}/tcp/${bootstrapNode.port}/p2p/${bootstrapNode.id}`);
      const connection = await node.dial(ma);
      logger.info(`Connesso al bootstrap node: ${bootstrapNode.id}`);

      // Invia messaggi periodici al bootstrap node
      setInterval(() => {
        const message = `Ping to bootstrap node at ${new Date().toISOString()}`;
        connection.streamManager?.write(message);
        logger.info(`Messaggio inviato al bootstrap node: ${message}`);
      }, 5000);
    } catch (error) {
      logger.error(`Errore nella connessione al bootstrap node: ${error.message}`);
    }

    // Mantieni il nodo attivo per testare la stabilità
    process.on('SIGINT', async () => {
      logger.info('Arresto del nodo...');
      await node.stop();
      logger.info('Nodo arrestato.');
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Errore durante il test di connessione: ${error.message}`);
  }
}

testConnection();