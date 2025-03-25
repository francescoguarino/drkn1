const { generatePrime } = require("crypto");
const { ec: EC } = require("elliptic");
const fs = require("fs");

const ec = new EC("secp256k1");
const privateKeyLocation = __dirname + "/wallet/private_key";

const generatePrivateKey = () => {
  const keyPair = ec.genKeyPair();
  const privateKey = keyPair.getPrivate();
  return privateKey.toString(16);
};

const initWallet = () => {
  let privateKey;
  if (fs.existsSync(privateKeyLocation)) {
    const buffer = fs.readFileSync(privateKeyLocation, "utf8");
    privateKey = buffer.toString();
  } else {
    privateKey = generatePrivateKey();
    fs.writeFileSync(privateKeyLocation, privateKey);
  }

  const key = ec.keyFromPrivate(privateKey, "hex");
  const publicKey = key.getPublic().encode("hex");
  return { privateKeyLocation, publicKey };
};

module.exports = {
  initWallet,
};
