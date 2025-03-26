const crypto = require("crypto");
const logger = require("../utils/logger");

class Transaction {
  constructor(from, to, amount, timestamp = Date.now()) {
    this.from = from;
    this.to = to;
    this.amount = amount;
    this.timestamp = timestamp;
    this.signature = null;
  }

  // Calcola l'hash della transazione
  calculateHash() {
    const data = `${this.from}${this.to}${this.amount}${this.timestamp}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  // Firma la transazione
  sign(privateKey) {
    if (this.from === "network") {
      logger.warn("Impossibile firmare una transazione di ricompensa");
      return false;
    }

    const hash = this.calculateHash();
    const sign = crypto.createSign("SHA256");
    sign.update(hash);
    this.signature = sign.sign(privateKey, "hex");

    logger.info("Transazione firmata con successo");
    return true;
  }

  // Verifica la validità della transazione
  isValid() {
    if (this.from === "network") {
      return true;
    }

    if (!this.signature) {
      logger.error("Transazione non firmata");
      return false;
    }

    const hash = this.calculateHash();
    const verify = crypto.createVerify("SHA256");
    verify.update(hash);

    const isValid = verify.verify(this.from, this.signature, "hex");
    if (!isValid) {
      logger.error("Firma della transazione non valida");
    }

    return isValid;
  }

  // Converte la transazione in formato JSON
  toJSON() {
    return {
      from: this.from,
      to: this.to,
      amount: this.amount,
      timestamp: this.timestamp,
      signature: this.signature,
      hash: this.calculateHash(),
    };
  }

  // Crea una transazione da un oggetto JSON
  static fromJSON(json) {
    const transaction = new Transaction(
      json.from,
      json.to,
      json.amount,
      json.timestamp
    );
    transaction.signature = json.signature;
    return transaction;
  }
}

module.exports = Transaction;
