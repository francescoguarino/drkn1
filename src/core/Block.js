const crypto = require('crypto');
const MerkleTree = require('./MerkleTree');

class Block {
  constructor(previousHash, timestamp, transactions, difficulty = 4) {
    this.version = '1.0.0';
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.difficulty = difficulty;
    this.nonce = 0;
    this.merkleTree = new MerkleTree();
    this.merkleRoot = null;
    this.hash = null;
  }

  // Aggiunge transazioni e aggiorna il Merkle Tree
  addTransactions(transactions) {
    this.transactions = transactions;
    this.merkleTree = new MerkleTree();
    transactions.forEach(tx => this.merkleTree.addLeaf(tx));
    this.merkleRoot = this.merkleTree.getRoot();
  }

  // Calcola l'hash del blocco
  calculateHash() {
    const data = JSON.stringify({
      version: this.version,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      merkleRoot: this.merkleRoot,
      difficulty: this.difficulty,
      nonce: this.nonce
    });

    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Verifica se il blocco soddisfa la difficoltà
  hasValidHash() {
    return this.hash.startsWith('0'.repeat(this.difficulty));
  }

  // Esegue il mining del blocco
  mine() {
    do {
      this.nonce++;
      this.hash = this.calculateHash();
    } while (!this.hasValidHash());

    return this.hash;
  }

  // Verifica la validità del blocco
  isValid() {
    return (
      this.hash === this.calculateHash() &&
      this.hasValidHash() &&
      this.merkleRoot === this.merkleTree.getRoot()
    );
  }

  // Converte il blocco in formato JSON
  toJSON() {
    return {
      version: this.version,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      transactions: this.transactions,
      merkleRoot: this.merkleRoot,
      difficulty: this.difficulty,
      nonce: this.nonce,
      hash: this.hash
    };
  }

  // Crea un blocco da JSON
  static fromJSON(json) {
    const block = new Block(json.previousHash, json.timestamp, json.transactions, json.difficulty);
    block.nonce = json.nonce;
    block.hash = json.hash;
    block.merkleRoot = json.merkleRoot;
    return block;
  }
}

module.exports = Block;
