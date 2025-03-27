import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';

export class NodeStorage {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NodeStorage');
    this.storageDir = path.join(config.node.dataDir, 'storage');
    this.peerIdFile = path.join(this.storageDir, 'peer-id.json');

    // Crea la directory se non esiste
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async savePeerId(peerId) {
    try {
      const peerIdData = {
        id: peerId.toString(),
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };

      fs.writeFileSync(this.peerIdFile, JSON.stringify(peerIdData, null, 2));
      this.logger.info(`PeerId salvato con successo: ${peerId.toString()}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio del PeerId: ${error.message}`);
      return false;
    }
  }

  async loadPeerId() {
    try {
      if (!fs.existsSync(this.peerIdFile)) {
        this.logger.info('Nessun PeerId trovato, verrà creato uno nuovo');
        return null;
      }

      const data = JSON.parse(fs.readFileSync(this.peerIdFile, 'utf8'));
      this.logger.info(`PeerId caricato con successo: ${data.id}`);
      return data.id;
    } catch (error) {
      this.logger.error(`Errore nel caricamento del PeerId: ${error.message}`);
      return null;
    }
  }

  async resetPeerId() {
    try {
      if (fs.existsSync(this.peerIdFile)) {
        fs.unlinkSync(this.peerIdFile);
        this.logger.info('PeerId resettato con successo');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Errore nel reset del PeerId: ${error.message}`);
      return false;
    }
  }
}
