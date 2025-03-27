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

      // Se non esiste la data di creazione, aggiungila
      if (!data.createdAt) {
        data.createdAt = new Date().toISOString();
      }

      // Assicurati che il peerId rimanga intatto se non viene fornito un nuovo valore
      if (nodeInfo.peerId) {
        // Verifica e formatta correttamente il peerId
        if (typeof nodeInfo.peerId === 'object' && nodeInfo.peerId.id) {
          // Se è un oggetto completo con id, privKey e pubKey, salvalo così com'è
          data.peerId = nodeInfo.peerId;
          this.logger.debug(`Salvato peerId come oggetto completo: ${nodeInfo.peerId.id}`);
        } else if (typeof nodeInfo.peerId === 'string' && nodeInfo.peerId.startsWith('12D3KooW')) {
          // Se è una stringa che rappresenta l'ID del peer, salvala così
          data.peerId = nodeInfo.peerId;
          this.logger.debug(`Salvato peerId come stringa: ${nodeInfo.peerId}`);
        } else {
          this.logger.warn(`Formato peerId non valido, mantengo il valore esistente`);
          // Mantieni il valore esistente se presente
          if (existingInfo.peerId) {
            data.peerId = existingInfo.peerId;
          }
        }
      } else if (existingInfo.peerId) {
        data.peerId = existingInfo.peerId;
      }

      // Assicurati che il nodeId rimanga intatto se non viene fornito un nuovo valore
      if (nodeInfo.nodeId) {
        data.nodeId = nodeInfo.nodeId;
      } else if (existingInfo.nodeId) {
        data.nodeId = existingInfo.nodeId;
      }

      // Scrivi il file con formattazione JSON
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

      // Verifica che almeno l'ID del nodo sia presente
      if (!data.nodeId) {
        this.logger.warn('ID del nodo mancante nelle informazioni salvate, verranno ricreate');
        return null;
      }

      // Se il peerId è presente, verifica che sia in un formato valido
      if (data.peerId) {
        // Verifica se è una stringa che inizia con 12D3KooW (ID di un peer libp2p)
        if (typeof data.peerId === 'string' && data.peerId.startsWith('12D3KooW')) {
          this.logger.info(`PeerId trovato in formato stringa: ${data.peerId}`);
          // È un formato valido, lo lasciamo come stringa
        }
        // Se è un oggetto, verifica che abbia tutte le proprietà necessarie
        else if (typeof data.peerId === 'object' && data.peerId.id) {
          this.logger.info(`PeerId trovato in formato oggetto con ID: ${data.peerId.id}`);
          // È un formato valido, mantieni l'oggetto
        }
        // Altrimenti, è un formato non valido
        else {
          this.logger.warn('Formato del PeerId non valido, verrà rigenerato');
          // Rimuovi il peerId non valido
          delete data.peerId;
        }
      } else {
        this.logger.info('PeerId non trovato nelle informazioni salvate, verrà creato');
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
