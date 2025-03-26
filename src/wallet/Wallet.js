import crypto from 'crypto';

export class Wallet {
  constructor(privateKey = null) {
    if (privateKey) {
      this.privateKey = Buffer.from(privateKey, 'hex');
    } else {
      this.privateKey = crypto.randomBytes(32);
    }
    this.publicKey = this._derivePublicKey();
    this.address = this._deriveAddress();
  }

  _derivePublicKey() {
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(this.privateKey);
    return ecdh.getPublicKey();
  }

  _deriveAddress() {
    const hash = crypto.createHash('sha256').update(this.publicKey).digest();
    return hash.slice(0, 20).toString('hex');
  }

  getAddress() {
    return this.address;
  }

  getPublicKey() {
    return this.publicKey.toString('hex');
  }

  getPrivateKey() {
    return this.privateKey.toString('hex');
  }

  sign(data) {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    return sign.sign(this.privateKey, 'hex');
  }

  verify(data, signature) {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    return verify.verify(this.publicKey, signature, 'hex');
  }

  createTransaction(to, amount, nonce = 0) {
    const transaction = {
      from: this.address,
      to,
      amount,
      nonce,
      timestamp: Date.now()
    };

    // Aggiungi la firma
    const dataToSign = JSON.stringify(transaction);
    transaction.signature = this.sign(dataToSign);

    return transaction;
  }
}
