import { Logger } from '../utils/logger.js';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class Miner extends EventEmitter {
  constructor(config, blockchain, wallet, mempool) {
    super();
    this.logger = new Logger('Miner');
    this.config = config;
    this.blockchain = blockchain;
    this.wallet = wallet;
    this.mempool = mempool;
    this.isRunning = false;
    this.currentBlock = null;
    this.difficulty = config.mining.difficulty || 4;
    this.maxNonce = config.mining.maxNonce || 2 ** 32;
    this.rewardAddress = config.mining.rewardAddress;
  }

  async start() {
    try {
      if (this.isRunning) {
        this.logger.warn('Miner già in esecuzione');
        return;
      }

      this.logger.info('Avvio del miner...');
      this.isRunning = true;
      await this.mine();
    } catch (error) {
      this.logger.error("Errore nell'avvio del miner:", error);
      this.isRunning = false;
      throw error;
    }
  }

  stop() {
    this.logger.info('Arresto del miner...');
    this.isRunning = false;
  }

  async mine() {
    while (this.isRunning) {
      try {
        // Crea un nuovo blocco
        const lastBlock = await this.blockchain.getLastBlock();
        const transactions = await this.mempool.getPendingTransactions();

        // Aggiungi la transazione di ricompensa
        const rewardTx = this.wallet.createTransaction(
          this.rewardAddress,
          this.config.blockchain.blockReward
        );
        transactions.push(rewardTx);

        this.currentBlock = {
          previousHash: lastBlock ? lastBlock.hash : '0'.repeat(64),
          timestamp: Date.now(),
          transactions,
          nonce: 0,
          height: lastBlock ? lastBlock.height + 1 : 0
        };

        // Calcola il target per la difficoltà
        const target = '0'.repeat(this.difficulty);

        // Inizia il mining
        this.logger.info(`Inizio mining del blocco ${this.currentBlock.height}`);
        this.emit('mining:start', this.currentBlock);

        while (this.isRunning && this.currentBlock.nonce < this.maxNonce) {
          this.currentBlock.hash = this.calculateBlockHash(this.currentBlock);

          if (this.currentBlock.hash.startsWith(target)) {
            // Blocco trovato!
            this.logger.info(
              `Blocco ${this.currentBlock.height} minato con successo! Hash: ${this.currentBlock.hash}`
            );

            // Emetti l'evento di blocco trovato
            this.emit('block:found', this.currentBlock);

            // Aggiungi il blocco alla blockchain
            await this.blockchain.addBlock(this.currentBlock);

            // Rimuovi le transazioni confermate dal mempool
            for (const tx of transactions) {
              await this.mempool.removeTransaction(tx.hash);
            }

            // Emetti l'evento di blocco aggiunto
            this.emit('block:added', this.currentBlock);

            break;
          }

          this.currentBlock.nonce++;

          // Emetti l'evento di progresso ogni 1000 hash
          if (this.currentBlock.nonce % 1000 === 0) {
            this.emit('mining:progress', {
              block: this.currentBlock,
              hashRate: 1000 / (Date.now() - this.currentBlock.timestamp)
            });
          }
        }

        if (!this.isRunning) {
          this.emit('mining:stop');
          break;
        }
      } catch (error) {
        this.logger.error('Errore durante il mining:', error);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Attendi 1 secondo prima di riprovare
      }
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

  getStatus() {
    return {
      isRunning: this.isRunning,
      currentBlock: this.currentBlock,
      difficulty: this.difficulty,
      rewardAddress: this.rewardAddress
    };
  }
}
