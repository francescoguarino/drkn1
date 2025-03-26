module.exports = {
  // Configurazione della blockchain
  blockchain: {
    // Difficoltà iniziale per il mining
    initialDifficulty: 4,

    // Ricompensa per il mining di un blocco
    miningReward: 10,

    // Numero massimo di transazioni per blocco
    maxTransactionsPerBlock: 10,

    // Intervallo di tempo tra i blocchi (in millisecondi)
    blockInterval: 10000,

    // Numero di conferme necessarie per considerare una transazione valida
    requiredConfirmations: 6,

    // Dimensione massima della mempool
    maxMempoolSize: 1000,

    // Timeout per le transazioni in mempool (in millisecondi)
    mempoolTimeout: 3600000, // 1 ora

    // Configurazione del Merkle Tree
    merkleTree: {
      // Algoritmo di hashing utilizzato
      hashAlgorithm: "sha256",

      // Dimensione massima delle foglie nel Merkle Tree
      maxLeaves: 1000,
    },
  },

  // Configurazione della rete
  network: {
    // Porta per le comunicazioni P2P
    p2pPort: 6001,

    // Timeout per le connessioni peer (in millisecondi)
    peerTimeout: 30000,

    // Numero massimo di peer connessi
    maxPeers: 50,

    // Intervallo di ping ai peer (in millisecondi)
    pingInterval: 30000,

    // Timeout per le richieste di sincronizzazione (in millisecondi)
    syncTimeout: 60000,
  },

  // Configurazione del logging
  logging: {
    // Livello di log (error, warn, info, debug)
    level: "info",

    // Directory per i file di log
    logDir: "logs",

    // Rotazione dei log (in giorni)
    rotationDays: 7,

    // Dimensione massima del file di log (in MB)
    maxFileSize: 10,
  },
};
