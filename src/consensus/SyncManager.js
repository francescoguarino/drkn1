import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

export class SyncManager extends EventEmitter {
  constructor(config, blockchain, networkManager) {
    super();
    this.logger = new Logger('SyncManager');
    this.config = config;
    this.blockchain = blockchain;
    this.networkManager = networkManager;
    this.isSyncing = false;
    this.syncInterval = config.sync.interval || 60000; // 1 minuto
    this.syncTimeout = config.sync.timeout || 30000; // 30 secondi
  }

  async start() {
    try {
      this.logger.info('Avvio del SyncManager...');

      // Emetti evento di inizio
      this.emit('sync:start');

      // Avvia la sincronizzazione periodica
      setInterval(() => {
        this.sync();
      }, this.syncInterval);

      // Esegui una sincronizzazione iniziale
      await this.sync();
    } catch (error) {
      this.logger.error("Errore nell'avvio del SyncManager:", error);
      // Emetti evento di errore
      this.emit('sync:error', error);
      throw error;
    }
  }

  async stop() {
    this.logger.info('Arresto del SyncManager...');
  }

  async sync() {
    if (this.isSyncing) {
      this.logger.warn('Sincronizzazione già in corso');
      return;
    }

    try {
      this.isSyncing = true;
      this.logger.info('Inizio sincronizzazione...');

      // Emetti evento di inizio sincronizzazione
      this.emit('sync:start');

      // Ottieni l'altezza locale
      const localHeight = this.blockchain.getHeight();

      // Richiedi l'altezza ai peer
      const peers = this.networkManager.getPeers();
      const heights = await Promise.all(
        peers.map(peer =>
          this.networkManager.requestHeight(peer.id).catch(error => {
            this.logger.warn(`Errore nel recupero dell'altezza dal peer ${peer.id}:`, error);
            return null;
          })
        )
      );

      // Trova l'altezza massima
      const maxHeight = Math.max(localHeight, ...heights.filter(h => h !== null));

      if (maxHeight > localHeight) {
        this.logger.info(`Sincronizzazione necessaria: locale=${localHeight}, remoto=${maxHeight}`);

        // Richiedi i blocchi mancanti
        for (let height = localHeight + 1; height <= maxHeight; height++) {
          const block = await this.requestBlock(height);
          if (block) {
            await this.blockchain.addBlock(block);
          }
        }
      }

      this.logger.info('Sincronizzazione completata');

      // Emetti evento di fine sincronizzazione
      this.emit('sync:end');
    } catch (error) {
      this.logger.error('Errore durante la sincronizzazione:', error);

      // Emetti evento di errore
      this.emit('sync:error', error);
    } finally {
      this.isSyncing = false;
    }
  }

  async requestBlock(height) {
    try {
      // Richiedi il blocco ai peer
      const peers = this.networkManager.getPeers();
      for (const peer of peers) {
        const block = await this.networkManager.requestBlock(peer.id, height);
        if (block) {
          return block;
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Errore nel recupero del blocco ${height}:`, error);
      return null;
    }
  }

  getStatus() {
    return {
      isSyncing: this.isSyncing,
      localHeight: this.blockchain.getHeight(),
      syncInterval: this.syncInterval,
      syncTimeout: this.syncTimeout
    };
  }
}
