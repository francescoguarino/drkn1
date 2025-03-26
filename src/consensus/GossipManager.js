import { Logger } from '../utils/logger.js';

export class GossipManager {
  constructor(config, networkManager, mempool, blockchain) {
    this.logger = new Logger('GossipManager');
    this.config = config;
    this.networkManager = networkManager;
    this.mempool = mempool;
    this.blockchain = blockchain;
    this.gossipInterval = config.gossip.interval || 5000; // 5 secondi
    this.maxPeersPerGossip = config.gossip.maxPeersPerGossip || 3;
  }

  async start() {
    try {
      this.logger.info('Avvio del GossipManager...');

      // Avvia il gossip periodico
      setInterval(() => {
        this.gossip();
      }, this.gossipInterval);
    } catch (error) {
      this.logger.error("Errore nell'avvio del GossipManager:", error);
      throw error;
    }
  }

  async stop() {
    this.logger.info('Arresto del GossipManager...');
  }

  async gossip() {
    try {
      // Ottieni i peer disponibili
      const peers = this.networkManager.getPeers();
      if (peers.length === 0) {
        return;
      }

      // Seleziona casualmente alcuni peer
      const selectedPeers = this.selectRandomPeers(peers, this.maxPeersPerGossip);

      // Gossip delle transazioni
      await this.gossipTransactions(selectedPeers);

      // Gossip dei blocchi
      await this.gossipBlocks(selectedPeers);
    } catch (error) {
      this.logger.error('Errore durante il gossip:', error);
    }
  }

  async gossipTransactions(peers) {
    try {
      // Ottieni le transazioni dal mempool
      const transactions = await this.mempool.getPendingTransactions();
      if (transactions.length === 0) {
        return;
      }

      // Invia le transazioni ai peer selezionati
      for (const peer of peers) {
        await this.networkManager.sendTransactions(peer.id, transactions);
      }
    } catch (error) {
      this.logger.error('Errore nel gossip delle transazioni:', error);
    }
  }

  async gossipBlocks(peers) {
    try {
      // Ottieni l'ultimo blocco
      const lastBlock = await this.blockchain.getLastBlock();
      if (!lastBlock) {
        return;
      }

      // Invia l'ultimo blocco ai peer selezionati
      for (const peer of peers) {
        await this.networkManager.sendBlock(peer.id, lastBlock);
      }
    } catch (error) {
      this.logger.error('Errore nel gossip dei blocchi:', error);
    }
  }

  selectRandomPeers(peers, count) {
    const shuffled = [...peers].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, peers.length));
  }

  async handleNewTransaction(transaction) {
    try {
      // Verifica se la transazione è già presente nel mempool
      if (await this.mempool.hasTransaction(transaction.hash)) {
        return;
      }

      // Verifica la validità della transazione
      if (!(await this.blockchain.isValidTransaction(transaction))) {
        return;
      }

      // Aggiungi la transazione al mempool
      await this.mempool.addTransaction(transaction);

      // Propaga la transazione ai peer
      const peers = this.networkManager.getPeers();
      const selectedPeers = this.selectRandomPeers(peers, this.maxPeersPerGossip);

      for (const peer of selectedPeers) {
        await this.networkManager.sendTransaction(peer.id, transaction);
      }
    } catch (error) {
      this.logger.error('Errore nella gestione della nuova transazione:', error);
    }
  }

  async handleNewBlock(block) {
    try {
      // Verifica se il blocco è già presente
      const existingBlock = await this.blockchain.getBlock(block.hash);
      if (existingBlock) {
        return;
      }

      // Verifica la validità del blocco
      if (!(await this.blockchain.isValidBlock(block))) {
        return;
      }

      // Aggiungi il blocco alla blockchain
      await this.blockchain.addBlock(block);

      // Rimuovi le transazioni confermate dal mempool
      for (const tx of block.transactions) {
        await this.mempool.removeTransaction(tx.hash);
      }

      // Propaga il blocco ai peer
      const peers = this.networkManager.getPeers();
      const selectedPeers = this.selectRandomPeers(peers, this.maxPeersPerGossip);

      for (const peer of selectedPeers) {
        await this.networkManager.sendBlock(peer.id, block);
      }
    } catch (error) {
      this.logger.error('Errore nella gestione del nuovo blocco:', error);
    }
  }

  getStatus() {
    return {
      gossipInterval: this.gossipInterval,
      maxPeersPerGossip: this.maxPeersPerGossip,
      mempoolSize: this.mempool.getSize()
    };
  }
}
