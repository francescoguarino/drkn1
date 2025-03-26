const EventEmitter = require("events");
const logger = require("../utils/logger");

class BlockchainEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // Emette un evento di nuovo blocco
  emitNewBlock(block) {
    this.emit("newBlock", block);
    logger.info(`Evento 'newBlock' emesso per il blocco ${block.hash}`);
  }

  // Emette un evento di nuova transazione
  emitNewTransaction(transaction) {
    this.emit("newTransaction", transaction);
    logger.info(
      `Evento 'newTransaction' emesso per la transazione ${transaction.calculateHash()}`
    );
  }

  // Emette un evento di mining completato
  emitMiningComplete(block) {
    this.emit("miningComplete", block);
    logger.info(`Evento 'miningComplete' emesso per il blocco ${block.hash}`);
  }

  // Emette un evento di sincronizzazione completata
  emitSyncComplete(stats) {
    this.emit("syncComplete", stats);
    logger.info("Evento 'syncComplete' emesso");
  }

  // Emette un evento di errore
  emitError(error) {
    this.emit("error", error);
    logger.error(`Evento 'error' emesso: ${error.message}`);
  }

  // Emette un evento di stato del wallet aggiornato
  emitWalletUpdate(address, balance) {
    this.emit("walletUpdate", { address, balance });
    logger.info(`Evento 'walletUpdate' emesso per l'indirizzo ${address}`);
  }

  // Emette un evento di peer connesso
  emitPeerConnected(peer) {
    this.emit("peerConnected", peer);
    logger.info(`Evento 'peerConnected' emesso per il peer ${peer.id}`);
  }

  // Emette un evento di peer disconnesso
  emitPeerDisconnected(peer) {
    this.emit("peerDisconnected", peer);
    logger.info(`Evento 'peerDisconnected' emesso per il peer ${peer.id}`);
  }

  // Emette un evento di gossip ricevuto
  emitGossipReceived(peerId, data) {
    this.emit("gossipReceived", { peerId, data });
    logger.info(`Evento 'gossipReceived' emesso dal peer ${peerId}`);
  }

  // Emette un evento di mempool aggiornato
  emitMempoolUpdate(stats) {
    this.emit("mempoolUpdate", stats);
    logger.info("Evento 'mempoolUpdate' emesso");
  }

  // Emette un evento di blockchain aggiornata
  emitBlockchainUpdate(stats) {
    this.emit("blockchainUpdate", stats);
    logger.info("Evento 'blockchainUpdate' emesso");
  }

  // Rimuove tutti i listener
  removeAllListeners() {
    super.removeAllListeners();
    logger.info("Tutti i listener rimossi");
  }

  // Rimuove un listener specifico
  removeListener(event, listener) {
    super.removeListener(event, listener);
    logger.info(`Listener rimosso per l'evento ${event}`);
  }

  // Verifica se ci sono listener per un evento
  hasListeners(event) {
    return this.listenerCount(event) > 0;
  }

  // Ottiene il numero di listener per un evento
  getListenerCount(event) {
    return this.listenerCount(event);
  }
}
