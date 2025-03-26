import express from 'express';
import cors from 'cors';
import { Logger } from '../utils/logger.js';

/**
 * Server API per il nodo Drakon
 */
export class APIServer {
  constructor(config, node) {
    this.config = config;
    this.node = node;
    this.logger = new Logger('APIServer');
    this.app = express();
    this.server = null;
    this.isRunning = false;
  }

  /**
   * Inizializza e avvia il server API
   */
  async start() {
    try {
      if (this.isRunning) {
        this.logger.warn('API Server già in esecuzione');
        return;
      }

      // Configurazione di base
      this.app.use(express.json());
      this.app.use(express.urlencoded({ extended: true }));

      // Abilita CORS
      const corsOptions = {
        origin: this.config.api?.cors?.origin || '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization']
      };
      this.app.use(cors(corsOptions));

      // Logging delle richieste
      this.app.use((req, res, next) => {
        this.logger.debug(`${req.method} ${req.path}`);
        next();
      });

      // Routes di base
      this.setupRoutes();

      // Middleware per la gestione degli errori
      this.setupErrorHandling();

      // Avvia il server
      const port = this.config.api?.port || 3000;
      const host = this.config.api?.host || '0.0.0.0';

      return new Promise((resolve, reject) => {
        this.server = this.app.listen(port, host, () => {
          this.isRunning = true;
          this.logger.info(`API Server in ascolto su ${host}:${port}`);
          resolve();
        });

        this.server.on('error', error => {
          this.logger.error(`Errore nell'avvio del server API: ${error.message}`);
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error(`Errore nell'inizializzazione del server API: ${error.message}`);
      throw error;
    }
  }

  /**
   * Arresta il server API
   */
  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.server || !this.isRunning) {
        this.logger.warn('API Server non in esecuzione');
        resolve();
        return;
      }

      this.server.close(error => {
        if (error) {
          this.logger.error(`Errore nella chiusura del server API: ${error.message}`);
          reject(error);
          return;
        }

        this.isRunning = false;
        this.logger.info('API Server arrestato con successo');
        resolve();
      });
    });
  }

  /**
   * Configura le routes dell'API
   */
  setupRoutes() {
    // Route principale
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Drakon Node API',
        version: this.config.version || '1.0.0',
        status: 'running'
      });
    });

    // Informazioni sul nodo
    this.app.get('/status', (req, res) => {
      try {
        res.json({
          node: {
            id: this.config.node?.id || 'unknown',
            version: this.config.version || '1.0.0',
            uptime: process.uptime(),
            isRunning: true
          },
          network: this.node.networkManager
            ? {
                peers: this.node.networkManager.getPeers().length,
                connections: this.node.networkManager.getStats().activeConnections,
                dhtNodes: this.node.networkManager.getDHTNodes?.() || []
              }
            : { status: 'not_available' },
          blockchain: this.node.blockchain
            ? {
                height: this.node.blockchain.getHeight(),
                difficulty: this.node.blockchain.getDifficulty(),
                latestBlock: this.node.blockchain.getLatestBlockHash?.()
              }
            : { status: 'not_available' },
          mining: {
            enabled: this.config.mining?.enabled || false,
            hashrate: this.node.miner?.getHashrate?.() || 0
          },
          mempool: {
            transactions: this.node.mempool?.getSize() || 0
          }
        });
      } catch (error) {
        this.logger.error(`Errore nella generazione dello stato: ${error.message}`);
        res.status(500).json({
          error: 'Errore interno',
          message: 'Impossibile recuperare lo stato del nodo'
        });
      }
    });

    // API Blockchain
    this.app.get('/blocks', async (req, res) => {
      try {
        const start = parseInt(req.query.start || 0);
        const limit = parseInt(req.query.limit || 10);

        if (!this.node.blockchain) {
          return res.status(503).json({ error: 'Blockchain non disponibile' });
        }

        const blocks = await this.node.blockchain.getBlocks(start, start + limit - 1);
        res.json({ blocks });
      } catch (error) {
        this.logger.error(`Errore nel recupero dei blocchi: ${error.message}`);
        res.status(500).json({ error: 'Errore nel recupero dei blocchi' });
      }
    });

    this.app.get('/blocks/:height', async (req, res) => {
      try {
        const height = parseInt(req.params.height);

        if (isNaN(height)) {
          return res.status(400).json({ error: 'Altezza blocco non valida' });
        }

        if (!this.node.blockchain) {
          return res.status(503).json({ error: 'Blockchain non disponibile' });
        }

        const block = await this.node.blockchain.getBlockByHeight(height);

        if (!block) {
          return res.status(404).json({ error: 'Blocco non trovato' });
        }

        res.json({ block });
      } catch (error) {
        this.logger.error(`Errore nel recupero del blocco: ${error.message}`);
        res.status(500).json({ error: 'Errore nel recupero del blocco' });
      }
    });

    // API Transazioni
    this.app.get('/transactions', (req, res) => {
      try {
        if (!this.node.mempool) {
          return res.status(503).json({ error: 'Mempool non disponibile' });
        }

        const transactions = this.node.mempool.getTransactions();
        res.json({ transactions });
      } catch (error) {
        this.logger.error(`Errore nel recupero delle transazioni: ${error.message}`);
        res.status(500).json({ error: 'Errore nel recupero delle transazioni' });
      }
    });

    this.app.post('/transactions', async (req, res) => {
      try {
        const { transaction } = req.body;

        if (!transaction) {
          return res.status(400).json({ error: 'Transazione mancante' });
        }

        if (!this.node.mempool) {
          return res.status(503).json({ error: 'Mempool non disponibile' });
        }

        const result = await this.node.mempool.addTransaction(transaction);

        // Propaga la transazione alla rete
        if (result && this.node.networkManager) {
          await this.node.networkManager.broadcast({
            type: 'new_transaction',
            transaction
          });
        }

        res.json({ success: !!result, transactionId: transaction.id || transaction.hash });
      } catch (error) {
        this.logger.error(`Errore nell'aggiunta della transazione: ${error.message}`);
        res.status(500).json({ error: "Errore nell'aggiunta della transazione" });
      }
    });

    // API Peer
    this.app.get('/peers', (req, res) => {
      try {
        if (!this.node.networkManager) {
          return res.status(503).json({ error: 'Network Manager non disponibile' });
        }

        const peers = this.node.networkManager.getPeers();
        res.json({ peers });
      } catch (error) {
        this.logger.error(`Errore nel recupero dei peer: ${error.message}`);
        res.status(500).json({ error: 'Errore nel recupero dei peer' });
      }
    });

    // Mining control API
    this.app.post('/mining/start', (req, res) => {
      try {
        if (!this.node.miner) {
          return res.status(503).json({ error: 'Miner non disponibile' });
        }

        this.node.miner.start();
        res.json({ success: true, status: 'mining_started' });
      } catch (error) {
        this.logger.error(`Errore nell'avvio del mining: ${error.message}`);
        res.status(500).json({ error: "Errore nell'avvio del mining" });
      }
    });

    this.app.post('/mining/stop', (req, res) => {
      try {
        if (!this.node.miner) {
          return res.status(503).json({ error: 'Miner non disponibile' });
        }

        this.node.miner.stop();
        res.json({ success: true, status: 'mining_stopped' });
      } catch (error) {
        this.logger.error(`Errore nell'arresto del mining: ${error.message}`);
        res.status(500).json({ error: "Errore nell'arresto del mining" });
      }
    });

    // Wallet API
    this.app.get('/wallet/balance/:address', async (req, res) => {
      try {
        const { address } = req.params;

        if (!address) {
          return res.status(400).json({ error: 'Indirizzo mancante' });
        }

        if (!this.node.wallet) {
          return res.status(503).json({ error: 'Wallet non disponibile' });
        }

        const balance = await this.node.wallet.getBalance(address);
        res.json({ address, balance });
      } catch (error) {
        this.logger.error(`Errore nel recupero del saldo: ${error.message}`);
        res.status(500).json({ error: 'Errore nel recupero del saldo' });
      }
    });
  }

  /**
   * Configura la gestione degli errori
   */
  setupErrorHandling() {
    // Gestione 404
    this.app.use((req, res, next) => {
      res.status(404).json({
        error: 'Not Found',
        message: `La risorsa ${req.path} non è stata trovata`
      });
    });

    // Gestione errori generali
    this.app.use((err, req, res, next) => {
      this.logger.error(`Errore API: ${err.message}`);

      res.status(err.status || 500).json({
        error: err.name || 'Errore interno',
        message: err.message || 'Si è verificato un errore interno'
      });
    });
  }
}
