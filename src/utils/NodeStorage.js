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
      // Carica le informazioni esistenti se presenti
      let existingInfo = {};
      if (fs.existsSync(this.nodeInfoFile)) {
        existingInfo = JSON.parse(fs.readFileSync(this.nodeInfoFile, 'utf8'));
      }

      // Mantieni la data di creazione originale se esiste
      const data = {
        ...existingInfo,
        ...nodeInfo,
        lastUpdated: new Date().toISOString()
      };

      // Assicurati che il peerId rimanga intatto se non viene fornito un nuovo valore
      if (nodeInfo.peerId) {
        data.peerId = nodeInfo.peerId;
      } else if (existingInfo.peerId) {
        data.peerId = existingInfo.peerId;
      }

      // Assicurati che il nodeId rimanga intatto se non viene fornito un nuovo valore
      if (nodeInfo.nodeId) {
        data.nodeId = nodeInfo.nodeId;
      } else if (existingInfo.nodeId) {
        data.nodeId = existingInfo.nodeId;
      }

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

      // Verifica che tutte le informazioni necessarie siano presenti
      if (!data.nodeId || !data.peerId || !data.walletAddress) {
        this.logger.warn('Informazioni del nodo incomplete, verranno ricreate');
        return null;
      }

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
