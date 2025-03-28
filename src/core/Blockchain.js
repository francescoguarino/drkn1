import { Logger } from '../utils/logger.js';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class Blockchain extends EventEmitter {
  constructor(config, db) {
    super();
    this.logger = new Logger('Blockchain');
    this.config = config;
    this.db = db;
    this.height = 0;
    this.difficulty = config.blockchain.difficulty || 4;
  }

  async init() {
    try {
      this.logger.info('Inizializzazione Blockchain...');

      // Recupera l'ultimo blocco
      const lastBlock = await this.db.getLastBlock();
      if (lastBlock) {
        this.height = lastBlock.height;
        this.logger.info(`Blockchain inizializzata all'altezza ${this.height}`);
      } else {
        this.logger.info('Blockchain vuota, verrà creato il blocco genesis');
      }
    } catch (error) {
      this.logger.error("Errore nell'inizializzazione della blockchain:", error);
      throw error;
    }
  }

  async addBlock(block) {
    try {
      // Verifica la validità del blocco
      if (!(await this.isValidBlock(block))) {
        throw new Error('Blocco non valido');
      }

      // Aggiungi il blocco al database
      await this.db.addBlock(block);

      // Aggiorna l'altezza
      this.height = block.height;

      // Emetti evento nuovo blocco
      this.emit('block:new', block);

      this.logger.info(`Nuovo blocco aggiunto: ${block.hash} (altezza: ${block.height})`);
      return true;
    } catch (error) {
      this.logger.error("Errore nell'aggiunta del blocco:", error);
      return false;
    }
  }

  async isValidBlock(block) {
    try {
      // Verifica l'hash del blocco
      const calculatedHash = this.calculateBlockHash(block);
      if (calculatedHash !== block.hash) {
        this.logger.warn('Hash del blocco non valido');
        return false;
      }

      // Verifica il previousHash
      if (block.height > 0) {
        const previousBlock = await this.db.getBlock(block.previousHash);
        if (!previousBlock) {
          this.logger.warn('Blocco precedente non trovato');
          return false;
        }
      }

      // Verifica il timestamp
      const currentTime = Date.now();
      if (block.timestamp > currentTime + 7200000) {
        // 2 ore di tolleranza
        this.logger.warn('Timestamp del blocco nel futuro');
        return false;
      }

      // Verifica la difficoltà
      const target = '0'.repeat(this.difficulty);
      if (!block.hash.startsWith(target)) {
        this.logger.warn('Blocco non soddisfa la difficoltà richiesta');
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Errore nella validazione del blocco:', error);
      return false;
    }
  }

  calculateBlockHash(block) {
    const data = JSON.stringify({
      previousHash: block.previousHash,
      timestamp: block.timestamp,
      transactions: block.transactions,
      nonce: block.nonce
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async isValidTransaction(transaction) {
    try {
      // Verifica se la transazione esiste già
      if (await this.db.hasTransaction(transaction.hash)) {
        this.logger.warn('Transazione già esistente');
        return false;
      }

      // Verifica il timestamp
      const currentTime = Date.now();
      if (transaction.timestamp > currentTime + 7200000) {
        // 2 ore di tolleranza
        this.logger.warn('Timestamp della transazione nel futuro');
        return false;
      }

      // Verifica la firma
      if (!this.verifyTransactionSignature(transaction)) {
        this.logger.warn('Firma della transazione non valida');
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Errore nella validazione della transazione:', error);
      return false;
    }
  }

  verifyTransactionSignature(transaction) {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(
        JSON.stringify({
          from: transaction.from,
          to: transaction.to,
          amount: transaction.amount,
          timestamp: transaction.timestamp
        })
      );

      return verifier.verify(transaction.from, transaction.signature, 'hex');
    } catch (error) {
      this.logger.error('Errore nella verifica della firma:', error);
      return false;
    }
  }

  getHeight() {
    return this.height;
  }

  getDifficulty() {
    return this.difficulty;
  }

  async getLastBlock() {
    return await this.db.getLastBlock();
  }

  async getBlock(hash) {
    return await this.db.getBlock(hash);
  }

  async getBlockByHeight(height) {
    return await this.db.getBlockByHeight(height);
  }

  async getBlocks(startHeight, endHeight) {
    return await this.db.getBlocks(startHeight, endHeight);
  }
}
