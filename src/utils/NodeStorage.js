import fs from 'fs/promises';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { Logger } from './logger.js';

export class NodeStorage {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NodeStorage');
    this.storageDir = path.join(config.node.dataDir, 'storage');
    this.nodeInfoPath = path.join(this.storageDir, 'node-info.json');

    // Crea la directory se non esiste
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
      this.logger.info(`Directory di storage creata: ${this.storageDir}`);
    } else {
      this.logger.info(`Directory di storage esistente: ${this.storageDir}`);
    }
    
    // Verifica percorsi assoluti
    this.logger.info(`Percorso info nodo (assoluto): ${path.resolve(this.nodeInfoPath)}`);
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

      // Gestione speciale del PeerId per preservare le chiavi nel formato corretto
      if (nodeInfo.peerId) {
        // Se il nuovo PeerId è un oggetto con id, privKey e pubKey
        if (
          typeof nodeInfo.peerId === 'object' &&
          nodeInfo.peerId.id &&
          nodeInfo.peerId.privKey 
        ) {
          // Salviamo in un formato compatibile con libp2p
          this.logger.info(`Salvataggio PeerId nel formato compatibile con libp2p: ${nodeInfo.peerId.id}`);
          
          // Formato conforme a @libp2p/peer-id-factory
          mergedInfo.peerId = {
            id: nodeInfo.peerId.id,
            // Salva la chiave privata come stringa base64
            privKey: typeof nodeInfo.peerId.privKey === 'string' 
              ? nodeInfo.peerId.privKey 
              : Buffer.from(nodeInfo.peerId.privKey).toString('base64'),
            // Salva la chiave pubblica come stringa base64
            pubKey: nodeInfo.peerId.pubKey 
              ? (typeof nodeInfo.peerId.pubKey === 'string'
                ? nodeInfo.peerId.pubKey
                : Buffer.from(nodeInfo.peerId.pubKey).toString('base64'))
              : null,
            // Aggiungi metadati che potrebbero essere utili
            type: 'Ed25519',
            format: 'base64'
          };
          
          this.logger.info(`Salvato PeerId completo con ID: ${nodeInfo.peerId.id}`);
          this.logger.debug(`PeerId salvato con formato: ${JSON.stringify({
            id: mergedInfo.peerId.id,
            hasPrivKey: !!mergedInfo.peerId.privKey,
            privKeyLength: mergedInfo.peerId.privKey ? mergedInfo.peerId.privKey.length : 0,
            hasFormat: !!mergedInfo.peerId.format,
            type: mergedInfo.peerId.type
          })}`);
        }
        // Se è solo un ID stringa, mantieni le chiavi esistenti se disponibili
        else if (typeof nodeInfo.peerId === 'string') {
          if (
            existingInfo.peerId &&
            typeof existingInfo.peerId === 'object' &&
            existingInfo.peerId.id &&
            existingInfo.peerId.privKey
          ) {
            this.logger.info(`Mantenute chiavi esistenti per PeerId: ${nodeInfo.peerId}`);
            mergedInfo.peerId = {
              ...existingInfo.peerId,
              id: nodeInfo.peerId // Aggiorna solo l'ID
            };
          } else {
            // Se non ci sono chiavi esistenti, salva solo l'ID
            mergedInfo.peerId = nodeInfo.peerId;
            this.logger.warn(`Salvato solo ID del PeerId senza chiavi: ${nodeInfo.peerId}`);
          }
        }
      }

      // Verifica che le informazioni minime necessarie siano presenti
      if (!mergedInfo.nodeId) {
        this.logger.warn('NodeId mancante nelle informazioni salvate');
      }

      // Salva le informazioni
      await fs.writeFile(this.nodeInfoPath, JSON.stringify(mergedInfo, null, 2));
      this.logger.debug(`Informazioni del nodo salvate con successo in ${this.nodeInfoPath}`);
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
      if (!existsSync(this.nodeInfoPath)) {
        this.logger.warn(`Il file delle informazioni nodo ${this.nodeInfoPath} non esiste.`);
        return null;
      }

      // Leggi il file
      const data = await fs.readFile(this.nodeInfoPath, 'utf8');
      this.logger.debug(`File letto (${data.length} bytes)`);

      // Parsa i dati JSON
      const nodeInfo = JSON.parse(data);

      // Verifica la validità dei dati
      if (!nodeInfo || typeof nodeInfo !== 'object') {
        throw new Error('Formato dati non valido');
      }

      this.logger.debug(`Informazioni del nodo caricate con successo da ${this.nodeInfoPath}`);

      // Log dei dati caricati
      if (nodeInfo.nodeId) {
        this.logger.debug(`NodeId caricato: ${nodeInfo.nodeId}`);
      }

      if (nodeInfo.peerId) {
        if (typeof nodeInfo.peerId === 'string') {
          this.logger.debug(`PeerId caricato (stringa): ${nodeInfo.peerId}`);
        } else if (typeof nodeInfo.peerId === 'object') {
          this.logger.info(`PeerId caricato (oggetto con id): ${nodeInfo.peerId.id || 'id mancante'}`);
          this.logger.info(`PeerId ha chiave privata: ${!!nodeInfo.peerId.privKey}`);
          this.logger.info(`PeerId ha chiave pubblica: ${!!nodeInfo.peerId.pubKey}`);
          
          if (nodeInfo.peerId.privKey) {
            const keyLength = nodeInfo.peerId.privKey.length;
            this.logger.debug(`Lunghezza chiave privata: ${keyLength} caratteri`);
          }
        }
      }

      return nodeInfo;
    } catch (error) {
      this.logger.error(`Errore nel caricamento delle informazioni del nodo: ${error.message}`);
      this.logger.error(error.stack);
      return null;
    }
  }

  async resetNodeInfo() {
    try {
      if (existsSync(this.nodeInfoPath)) {
        unlinkSync(this.nodeInfoPath);
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
