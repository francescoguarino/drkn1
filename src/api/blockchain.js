const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");

// Middleware per verificare che il nodo sia attivo
const checkNodeActive = (req, res, next) => {
  if (!req.app.locals.blockchain) {
    return res.status(503).json({
      error: "Il nodo blockchain non è attivo",
    });
  }
  next();
};

// GET /api/blockchain/stats
router.get("/stats", checkNodeActive, (req, res) => {
  try {
    const stats = req.app.locals.blockchain.getStats();
    res.json(stats);
  } catch (error) {
    logger.error(`Errore nel recupero delle statistiche: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero delle statistiche",
    });
  }
});

// GET /api/blockchain/blocks
router.get("/blocks", checkNodeActive, (req, res) => {
  try {
    const blocks = req.app.locals.blockchain.chain;
    res.json(blocks);
  } catch (error) {
    logger.error(`Errore nel recupero dei blocchi: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero dei blocchi",
    });
  }
});

// GET /api/blockchain/blocks/:hash
router.get("/blocks/:hash", checkNodeActive, (req, res) => {
  try {
    const block = req.app.locals.blockchain.chain.find(
      (b) => b.hash === req.params.hash
    );

    if (!block) {
      return res.status(404).json({
        error: "Blocco non trovato",
      });
      
    }

    res.json(block);
  } catch (error) {
    logger.error(`Errore nel recupero del blocco: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero del blocco",
    });
  }
});

// GET /api/blockchain/transactions
router.get("/transactions", checkNodeActive, (req, res) => {
  try {
    const transactions = req.app.locals.blockchain.pendingTransactions;
    res.json(transactions);
  } catch (error) {
    logger.error(`Errore nel recupero delle transazioni: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero delle transazioni",
    });
  }
});

// POST /api/blockchain/transactions
router.post("/transactions", checkNodeActive, (req, res) => {
  try {
    const { from, to, amount } = req.body;

    if (!from || !to || !amount) {
      return res.status(400).json({
        error: "Parametri mancanti",
      });
    }

    const transaction = req.app.locals.blockchain.createTransaction(
      from,
      to,
      amount
    );

    if (!transaction) {
      return res.status(400).json({
        error: "Impossibile creare la transazione",
      });
    }

    res.status(201).json(transaction);
  } catch (error) {
    logger.error(`Errore nella creazione della transazione: ${error.message}`);
    res.status(500).json({
      error: "Errore nella creazione della transazione",
    });
  }
});

// GET /api/blockchain/wallet/:address
router.get("/wallet/:address", checkNodeActive, (req, res) => {
  try {
    const balance = req.app.locals.blockchain.getBalanceOfAddress(
      req.params.address
    );

    res.json({
      address: req.params.address,
      balance,
    });
  } catch (error) {
    logger.error(`Errore nel recupero del saldo: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero del saldo",
    });
  }
});

// POST /api/blockchain/mine
router.post("/mine", checkNodeActive, (req, res) => {
  try {
    const { minerAddress } = req.body;

    if (!minerAddress) {
      return res.status(400).json({
        error: "Indirizzo del miner mancante",
      });
    }

    req.app.locals.blockchain.minePendingTransactions(minerAddress);

    res.json({
      message: "Mining completato con successo",
    });
  } catch (error) {
    logger.error(`Errore nel mining: ${error.message}`);
    res.status(500).json({
      error: "Errore nel mining",
    });
  }
});

// GET /api/blockchain/peers
router.get("/peers", checkNodeActive, (req, res) => {
  try {
    const peers = req.app.locals.networkManager.getConnectedPeers();
    res.json(peers);
  } catch (error) {
    logger.error(`Errore nel recupero dei peer: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero dei peer",
    });
  }
});

// GET /api/blockchain/mempool
router.get("/mempool", checkNodeActive, (req, res) => {
  try {
    const mempool = req.app.locals.mempool;
    res.json({
      transactions: mempool.getAllTransactions(),
      stats: mempool.getStats(),
    });
  } catch (error) {
    logger.error(`Errore nel recupero del mempool: ${error.message}`);
    res.status(500).json({
      error: "Errore nel recupero del mempool",
    });
  }
});

module.exports = router;
