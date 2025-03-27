import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';

export class NodeStorage {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NodeStorage');
    this.storageDir = path.join(config.node.dataDir, 'storage');
    this.nodeInfoPath = path.join(this.storageDir, 'node-info.json');

    // Crea la directory se non esiste
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Salva le informazioni del nodo
   * @param {Object} nodeInfo - Informazioni del nodo da salvare
   * @returns {Promise<boolean>} - true se salvato con successo
   */
  async saveNodeInfo(nodeInfo) {
    try {
      // Assicurati che nodeInfo non sia null o undefined
      if (!nodeInfo) {
        this.logger.error('NodeInfo è null o undefined, impossibile salvare');
        return false;
      }

      // Carica le informazioni esistenti per preservare i dati originali
      let existingInfo = {};
      try {
        existingInfo = (await this.loadNodeInfo()) || {};
      } catch (err) {
        this.logger.warn(`Nessuna informazione esistente trovata: ${err.message}`);
      }

      // Crea un nuovo oggetto che combina i dati esistenti con quelli nuovi
      const mergedInfo = {
        ...existingInfo,
        ...nodeInfo,
        // Mantiene la data di creazione originale se presente
        createdAt: existingInfo.createdAt || nodeInfo.createdAt || new Date().toISOString(),
        // Aggiorna sempre l'ultima data di modifica
        lastUpdated: new Date().toISOString()
      };

      // Assicurati che il PeerId sia sempre una stringa per semplicità
      if (mergedInfo.peerId && typeof mergedInfo.peerId !== 'string') {
        // Se è un oggetto, usa il campo id o toString()
        if (typeof mergedInfo.peerId === 'object') {
          mergedInfo.peerId = mergedInfo.peerId.id || mergedInfo.peerId.toString();
        }
      }

      // Verifica che le informazioni minime necessarie siano presenti
      if (!mergedInfo.nodeId) {
        this.logger.warn('NodeId mancante nelle informazioni salvate');
      }

      // Salva le informazioni
      await fs.writeFile(this.nodeInfoPath, JSON.stringify(mergedInfo, null, 2));
      this.logger.info(`Informazioni del nodo salvate con successo in ${this.nodeInfoPath}`);
      this.logger.debug(`NodeInfo salvato: ${JSON.stringify(mergedInfo, null, 2)}`);

      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio delle informazioni del nodo: ${error.message}`);
      return false;
    }
  }

  /**
   * Carica le informazioni del nodo
   * @returns {Promise<Object|null>} - Informazioni del nodo caricate
   */
  async loadNodeInfo() {
    try {
      // Verifica se il file esiste
      if (!fs.existsSync(this.nodeInfoPath)) {
        this.logger.warn(`Il file delle informazioni nodo ${this.nodeInfoPath} non esiste.`);
        return null;
      }

      // Leggi il file
      const data = await fs.readFile(this.nodeInfoPath, 'utf8');

      // Parsa i dati JSON
      const nodeInfo = JSON.parse(data);

      // Verifica la validità dei dati
      if (!nodeInfo || typeof nodeInfo !== 'object') {
        throw new Error('Formato dati non valido');
      }

      this.logger.info(`Informazioni del nodo caricate con successo da ${this.nodeInfoPath}`);

      // Log dei dati caricati
      if (nodeInfo.nodeId) {
        this.logger.info(`NodeId caricato: ${nodeInfo.nodeId}`);
      }

      if (nodeInfo.peerId) {
        if (typeof nodeInfo.peerId === 'string') {
          this.logger.info(`PeerId caricato (stringa): ${nodeInfo.peerId}`);
        } else if (typeof nodeInfo.peerId === 'object') {
          this.logger.info(
            `PeerId caricato (oggetto): ${nodeInfo.peerId.id || JSON.stringify(nodeInfo.peerId)}`
          );
        }
      }

      return nodeInfo;
    } catch (error) {
      this.logger.error(`Errore nel caricamento delle informazioni del nodo: ${error.message}`);
      return null;
    }
  }

  async resetNodeInfo() {
    try {
      if (fs.existsSync(this.nodeInfoPath)) {
        fs.unlinkSync(this.nodeInfoPath);
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
