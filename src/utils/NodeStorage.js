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
        try {
          existingInfo = JSON.parse(fs.readFileSync(this.nodeInfoFile, 'utf8'));
        } catch (parseError) {
          this.logger.error(`Errore nel parsing del file node-info.json: ${parseError.message}`);
          // Continua comunque con un oggetto vuoto
        }
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

      // Gestione speciale per il peerId
      if (nodeInfo.peerId) {
        // Verifica e formatta correttamente il peerId
        if (typeof nodeInfo.peerId === 'object' && nodeInfo.peerId.id) {
          // Verifica che contenga tutte le chiavi necessarie
          if (nodeInfo.peerId.privKey && nodeInfo.peerId.pubKey) {
            // Se è un oggetto completo con id, privKey e pubKey, salvalo così com'è
            data.peerId = nodeInfo.peerId;
            this.logger.debug(`Salvato peerId come oggetto completo: ${nodeInfo.peerId.id}`);
            this.logger.debug(`Lunghezza privKey: ${nodeInfo.peerId.privKey.length} caratteri`);
            this.logger.debug(`Lunghezza pubKey: ${nodeInfo.peerId.pubKey.length} caratteri`);
          } else {
            this.logger.warn('PeerId fornito incompleto, mancano le chiavi necessarie');
            // Mantieni il valore esistente se presente
            if (
              existingInfo.peerId &&
              existingInfo.peerId.id &&
              existingInfo.peerId.privKey &&
              existingInfo.peerId.pubKey
            ) {
              data.peerId = existingInfo.peerId;
              this.logger.info(`Mantenuto PeerId esistente: ${existingInfo.peerId.id}`);
            }
          }
        } else if (typeof nodeInfo.peerId === 'string' && nodeInfo.peerId.startsWith('12D3KooW')) {
          // Se è una stringa che rappresenta l'ID del peer, controlla se esistono già chiavi
          if (
            existingInfo.peerId &&
            existingInfo.peerId.id === nodeInfo.peerId &&
            existingInfo.peerId.privKey &&
            existingInfo.peerId.pubKey
          ) {
            // Se abbiamo già le chiavi per questo ID, mantieni tutto
            data.peerId = existingInfo.peerId;
            this.logger.debug(`Mantenuto PeerId esistente con lo stesso ID: ${nodeInfo.peerId}`);
          } else {
            // Altrimenti salva solo l'ID
            data.peerId = nodeInfo.peerId;
            this.logger.debug(`Salvato peerId come stringa: ${nodeInfo.peerId}`);
            this.logger.warn(
              'Nota: salvato solo ID del peer senza chiavi, potrebbero essere necessarie in futuro'
            );
          }
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
      try {
        const jsonData = JSON.stringify(data, null, 2);
        fs.writeFileSync(this.nodeInfoFile, jsonData);
        this.logger.info(`Informazioni del nodo salvate con successo (${jsonData.length} bytes)`);

        // Verifica che il file esista dopo la scrittura
        if (fs.existsSync(this.nodeInfoFile)) {
          const stats = fs.statSync(this.nodeInfoFile);
          this.logger.debug(`File ${this.nodeInfoFile} scritto con dimensione ${stats.size} bytes`);
        } else {
          this.logger.error(`File ${this.nodeInfoFile} non trovato dopo la scrittura!`);
        }

        return true;
      } catch (writeError) {
        this.logger.error(`Errore nella scrittura del file: ${writeError.message}`);
        throw writeError;
      }
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

      try {
        const fileContent = fs.readFileSync(this.nodeInfoFile, 'utf8');

        // Verifica che il file non sia vuoto
        if (!fileContent || fileContent.trim() === '') {
          this.logger.warn('File node-info.json vuoto, verranno create nuove informazioni');
          return null;
        }

        try {
          const data = JSON.parse(fileContent);

          // Verifica che almeno l'ID del nodo sia presente
          if (!data.nodeId) {
            this.logger.warn('ID del nodo mancante nelle informazioni salvate, verranno ricreate');
            return null;
          }

          // Verifica e valida il peerId se presente
          if (data.peerId) {
            // Verifica se è un oggetto con tutte le proprietà necessarie
            if (typeof data.peerId === 'object') {
              if (data.peerId.id && data.peerId.privKey && data.peerId.pubKey) {
                this.logger.info(
                  `PeerId trovato in formato oggetto completo con ID: ${data.peerId.id}`
                );
                this.logger.debug(`Lunghezza privKey: ${data.peerId.privKey.length} caratteri`);
                this.logger.debug(`Lunghezza pubKey: ${data.peerId.pubKey.length} caratteri`);
              } else {
                this.logger.warn('PeerId in formato oggetto incompleto, mancano campi necessari');
              }
            }
            // Verifica se è una stringa che inizia con 12D3KooW (ID di un peer libp2p)
            else if (typeof data.peerId === 'string' && data.peerId.startsWith('12D3KooW')) {
              this.logger.info(`PeerId trovato in formato stringa: ${data.peerId}`);
              this.logger.warn('Nota: PeerId in formato stringa non contiene le chiavi necessarie');
            }
            // Altrimenti, è un formato non valido
            else {
              this.logger.warn(`Formato del PeerId non valido: ${typeof data.peerId}`);
            }
          } else {
            this.logger.info('PeerId non trovato nelle informazioni salvate, verrà creato');
          }

          this.logger.info(`Informazioni del nodo caricate con successo`);
          return data;
        } catch (parseError) {
          this.logger.error(
            `Errore nel parsing delle informazioni del nodo: ${parseError.message}`
          );
          // Il file è corrotto, restituisci null
          return null;
        }
      } catch (readError) {
        this.logger.error(
          `Errore nella lettura del file ${this.nodeInfoFile}: ${readError.message}`
        );
        return null;
      }
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
