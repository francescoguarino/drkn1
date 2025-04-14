import { Logger } from '../utils/logger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class Wallet {
  constructor(config) {
    this.logger = new Logger('Wallet');
    this.config = config || {};

    // Verifica che ci sia la configurazione wallet
    if (!this.config.wallet) {
      this.config.wallet = {
        path: path.join(process.cwd(), 'wallet'),
        saveToFile: true
      };
    }

    this.privateKey = null;
    this.publicKey = null;
    this.address = null;
  }

  async init() {
    try {
      this.logger.info('Inizializzazione Wallet...');

      // Verifica che ci siano tutte le proprietà necessarie
      if (!this.config.wallet.path) {
        this.config.wallet.path = path.join(process.cwd(), 'wallet');
      }

      if (this.config.wallet.saveToFile === undefined) {
        this.config.wallet.saveToFile = true;
      }

      // Crea la directory del wallet se non esiste
      if (this.config.wallet.saveToFile && !fs.existsSync(this.config.wallet.path)) {
        fs.mkdirSync(this.config.wallet.path, { recursive: true });
      }

      // Carica o genera le chiavi
      if (this.config.wallet.privateKey) {
        // Usa la chiave privata fornita
        this.privateKey = this.config.wallet.privateKey;
        this.publicKey = crypto.createPublicKey(this.privateKey).export({
          type: 'spki',
          format: 'der'
        });
      } else {
        // Prova a caricare le chiavi dal file
        const keyPath = path.join(this.config.wallet.path, 'wallet.key');
        if (this.config.wallet.saveToFile && fs.existsSync(keyPath)) {
          const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          this.privateKey = keyData.privateKey;
          this.publicKey = keyData.publicKey;
        } else {
          // Genera nuove chiavi
          const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem'
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem'
            }
          });

          this.privateKey = privateKey;
          this.publicKey = publicKey;

          // Salva le chiavi su file
          if (this.config.wallet.saveToFile) {
            const keyData = {
              privateKey: this.privateKey,
              publicKey: this.publicKey
            };
            fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2));
            this.logger.info('Chiavi del wallet salvate su file');
          }
        }
      }

      // Genera l'indirizzo
      const publicKeyBuffer = Buffer.from(this.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g, ''), 'base64');
      this.address = crypto.createHash('sha256').update(publicKeyBuffer).digest('hex');

      this.logger.info(`Wallet inizializzato con indirizzo: ${this.address}`);
    } catch (error) {
      this.logger.error("Errore nell'inizializzazione del wallet:", error);
      throw error;
    }
  }

  createTransaction(to, amount) {
    try {
      const transaction = {
        from: this.address,
        to,
        amount,
        timestamp: Date.now()
      };

      // Firma la transazione
      const sign = crypto.createSign('SHA256');
      sign.update(
        JSON.stringify({
          from: transaction.from,
          to: transaction.to,
          amount: transaction.amount,
          timestamp: transaction.timestamp
        })
      );

      transaction.signature = sign.sign(this.privateKey, 'hex');
      transaction.hash = this.calculateTransactionHash(transaction);

      this.logger.info(`Nuova transazione creata: ${transaction.hash}`);
      return transaction;
    } catch (error) {
      this.logger.error('Errore nella creazione della transazione:', error);
      throw error;
    }
  }

  calculateTransactionHash(transaction) {
    const data = JSON.stringify({
      from: transaction.from,
      to: transaction.to,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
      signature: transaction.signature
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  getAddress() {
    return this.address;
  }

  getPublicKey() {
    return this.publicKey;
  }

  getPrivateKey() {
    return this.privateKey;
  }
}
