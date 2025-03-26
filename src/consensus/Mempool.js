import { Logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

export class Mempool extends EventEmitter {
  constructor(config, blockchain) {
    super();
    this.logger = new Logger('Mempool');
    this.config = config;
    this.blockchain = blockchain;
    this.transactions = new Map();
    this.maxSize = config.mempool.maxSize || 1000;
  }

  async addTransaction(transaction) {
    try {
      // Verifica se la transazione è già presente
      if (this.transactions.has(transaction.hash)) {
        this.logger.warn(`Transazione ${transaction.hash} già presente nel mempool`);
        return false;
      }

      // Verifica la validità della transazione
      if (!(await this.blockchain.isValidTransaction(transaction))) {
        this.logger.warn(`Transazione ${transaction.hash} non valida`);
        return false;
      }

      // Verifica se il mempool è pieno
      if (this.transactions.size >= this.maxSize) {
        this.logger.warn('Mempool pieno, transazione scartata');
        return false;
      }

      // Aggiungi la transazione
      this.transactions.set(transaction.hash, transaction);

      // Emetti evento nuova transazione
      this.emit('transaction:new', transaction);

      this.logger.info(`Nuova transazione aggiunta al mempool: ${transaction.hash}`);
      return true;
    } catch (error) {
      this.logger.error("Errore nell'aggiunta della transazione al mempool:", error);
      return false;
    }
  }

  async removeTransaction(hash) {
    try {
      const transaction = this.transactions.get(hash);
      if (this.transactions.delete(hash)) {
        // Emetti evento transazione confermata
        if (transaction) {
          this.emit('transaction:confirmed', transaction);
        }

        this.logger.info(`Transazione ${hash} rimossa dal mempool`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('Errore nella rimozione della transazione dal mempool:', error);
      return false;
    }
  }

  async getPendingTransactions() {
    return Array.from(this.transactions.values());
  }

  async getTransaction(hash) {
    return this.transactions.get(hash);
  }

  async hasTransaction(hash) {
    return this.transactions.has(hash);
  }

  getSize() {
    return this.transactions.size;
  }

  clear() {
    this.transactions.clear();
    this.logger.info('Mempool svuotato');
  }

  getStatus() {
    return {
      size: this.transactions.size,
      maxSize: this.maxSize,
      transactions: Array.from(this.transactions.values())
    };
  }
}
