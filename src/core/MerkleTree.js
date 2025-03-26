const crypto = require("crypto");

class MerkleTree {
  constructor() {
    this.leaves = [];
    this.tree = [];
  }

  // Aggiunge una transazione come foglia
  addLeaf(transaction) {
    const hash = this._hashTransaction(transaction);
    this.leaves.push(hash);
    this._buildTree();
  }

  // Costruisce l'albero di Merkle
  _buildTree() {
    this.tree = [...this.leaves];

    let level = 0;
    while (this.tree[level].length > 1) {
      const levelSize = this.tree[level].length;
      const nextLevel = [];

      for (let i = 0; i < levelSize; i += 2) {
        const left = this.tree[level][i];
        const right = i + 1 < levelSize ? this.tree[level][i + 1] : left;
        nextLevel.push(this._hashPair(left, right));
      }

      this.tree.push(nextLevel);
      level++;
    }
  }

  // Calcola l'hash di una transazione
  _hashTransaction(transaction) {
    const data = JSON.stringify(transaction);
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  // Calcola l'hash di una coppia di hash
  _hashPair(left, right) {
    return crypto
      .createHash("sha256")
      .update(left + right)
      .digest("hex");
  }

  // Restituisce la root dell'albero
  getRoot() {
    return this.tree[this.tree.length - 1][0];
  }

  // Genera la prova di Merkle per una transazione
  getProof(transaction) {
    const leafHash = this._hashTransaction(transaction);
    const leafIndex = this.leaves.indexOf(leafHash);

    if (leafIndex === -1) {
      throw new Error("Transaction not found in tree");
    }

    const proof = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < this.tree[level].length) {
        proof.push({
          hash: this.tree[level][siblingIndex],
          isRight: !isRight,
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  // Verifica una prova di Merkle
  verifyProof(transaction, proof, root) {
    let currentHash = this._hashTransaction(transaction);

    for (const step of proof) {
      if (step.isRight) {
        currentHash = this._hashPair(currentHash, step.hash);
      } else {
        currentHash = this._hashPair(step.hash, currentHash);
      }
    }

    return currentHash === root;
  }
}

module.exports = MerkleTree;
