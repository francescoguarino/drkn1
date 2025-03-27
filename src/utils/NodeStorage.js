import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';

export class NodeStorage {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NodeStorage');
    this.storageDir = path.join(config.node.dataDir, 'storage');
    this.nodeInfoFile = path.join(this.storageDir, 'node-info.json');

    // Crea la directory se non esiste
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async saveNodeInfo(nodeInfo) {
    try {
      const data = {
        ...nodeInfo,
        lastUpdated: new Date().toISOString()
      };

      fs.writeFileSync(this.nodeInfoFile, JSON.stringify(data, null, 2));
      this.logger.info(`Informazioni del nodo salvate con successo`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio delle informazioni del nodo: ${error.message}`);
      return false;
    }
  }

  async loadNodeInfo() {
    try {
      if (!fs.existsSync(this.nodeInfoFile)) {
        this.logger.info(
          'Nessuna informazione del nodo trovata, verranno create nuove informazioni'
        );
        return null;
      }

      const data = JSON.parse(fs.readFileSync(this.nodeInfoFile, 'utf8'));
      this.logger.info(`Informazioni del nodo caricate con successo`);
      return data;
    } catch (error) {
      this.logger.error(`Errore nel caricamento delle informazioni del nodo: ${error.message}`);
      return null;
    }
  }

  async resetNodeInfo() {
    try {
      if (fs.existsSync(this.nodeInfoFile)) {
        fs.unlinkSync(this.nodeInfoFile);
        this.logger.info('Informazioni del nodo resettate con successo');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Errore nel reset delle informazioni del nodo: ${error.message}`);
      return false;
    }
  }
}
