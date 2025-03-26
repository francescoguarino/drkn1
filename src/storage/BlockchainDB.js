import { Level } from 'level';
import { Logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

export class BlockchainDB {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('BlockchainDB');
    this.dbPath = config.storage.path;
    this.db = null;
  }

  // Inizializza il database
  async init() {
    try {
      this.db = new Level(this.dbPath, {
        valueEncoding: 'json'
      });

      this.logger.info(`Database blockchain inizializzato in ${this.dbPath}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nell'inizializzazione del database: ${error.message}`);
      return false;
    }
  }

  // Salva un blocco nel database
  async saveBlock(block) {
    try {
      const key = `block:${block.hash}`;
      await this.db.put(key, block);
      this.logger.info(`Blocco salvato nel database: ${block.hash}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio del blocco: ${error.message}`);
      return false;
    }
  }

  // Recupera un blocco dal database
  async getBlock(hash) {
    try {
      const key = `block:${hash}`;
      const block = await this.db.get(key);
      return block;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Errore nel recupero del blocco: ${error.message}`);
      return null;
    }
  }

  // Salva l'ultimo hash del blocco
  async saveLastBlockHash(hash) {
    try {
      await this.db.put('lastBlockHash', hash);
      this.logger.info(`Ultimo hash del blocco salvato: ${hash}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio dell'ultimo hash: ${error.message}`);
      return false;
    }
  }

  // Recupera l'ultimo hash del blocco
  async getLastBlockHash() {
    try {
      const hash = await this.db.get('lastBlockHash');
      return hash;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Errore nel recupero dell'ultimo hash: ${error.message}`);
      return null;
    }
  }

  // Salva una transazione nel database
  async saveTransaction(transaction) {
    try {
      const key = `tx:${transaction.calculateHash()}`;
      await this.db.put(key, transaction);
      this.logger.info(`Transazione salvata nel database: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio della transazione: ${error.message}`);
      return false;
    }
  }

  // Recupera una transazione dal database
  async getTransaction(hash) {
    try {
      const key = `tx:${hash}`;
      const transaction = await this.db.get(key);
      return transaction;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Errore nel recupero della transazione: ${error.message}`);
      return null;
    }
  }

  // Salva lo stato del wallet
  async saveWalletState(address, state) {
    try {
      const key = `wallet:${address}`;
      await this.db.put(key, state);
      this.logger.info(`Stato del wallet salvato: ${address}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nel salvataggio dello stato del wallet: ${error.message}`);
      return false;
    }
  }

  // Recupera lo stato del wallet
  async getWalletState(address) {
    try {
      const key = `wallet:${address}`;
      const state = await this.db.get(key);
      return state;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Errore nel recupero dello stato del wallet: ${error.message}`);
      return null;
    }
  }

  // Chiude il database
  async close() {
    try {
      await this.db.close();
      this.logger.info('Database blockchain chiuso');
      return true;
    } catch (error) {
      this.logger.error(`Errore nella chiusura del database: ${error.message}`);
      return false;
    }
  }

  // Elimina il database
  async delete() {
    try {
      await this.db.close();
      fs.rmSync(this.dbPath, { recursive: true, force: true });
      this.logger.info('Database blockchain eliminato');
      return true;
    } catch (error) {
      this.logger.error(`Errore nell'eliminazione del database: ${error.message}`);
      return false;
    }
  }

  // Salva un blocco nel database
  async addBlock(block) {
    try {
      // Salva il blocco
      await this.saveBlock(block);
      // Aggiorna l'ultimo hash
      await this.saveLastBlockHash(block.hash);
      // Salva l'altezza del blocco
      await this.db.put(`height:${block.height}`, block.hash);
      this.logger.info(`Blocco aggiunto al database: ${block.hash}`);
      return true;
    } catch (error) {
      this.logger.error(`Errore nell'aggiunta del blocco: ${error.message}`);
      return false;
    }
  }

  // Recupera l'ultimo blocco
  async getLastBlock() {
    try {
      const hash = await this.getLastBlockHash();
      if (!hash) return null;
      return await this.getBlock(hash);
    } catch (error) {
      this.logger.error(`Errore nel recupero dell'ultimo blocco: ${error.message}`);
      return null;
    }
  }

  // Recupera un blocco per altezza
  async getBlockByHeight(height) {
    try {
      const hash = await this.db.get(`height:${height}`);
      return await this.getBlock(hash);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      this.logger.error(`Errore nel recupero del blocco per altezza: ${error.message}`);
      return null;
    }
  }

  // Recupera una lista di blocchi
  async getBlocks(startHeight, endHeight) {
    const blocks = [];
    try {
      for (let height = startHeight; height <= endHeight; height++) {
        const block = await this.getBlockByHeight(height);
        if (block) {
          blocks.push(block);
        }
      }
      return blocks;
    } catch (error) {
      this.logger.error(`Errore nel recupero dei blocchi: ${error.message}`);
      return blocks;
    }
  }

  // Verifica se una transazione esiste
  async hasTransaction(hash) {
    try {
      await this.getTransaction(hash);
      return true;
    } catch (error) {
      return false;
    }
  }
}
