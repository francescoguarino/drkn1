const { Block, BlockHeader } = require("./block.js");
const moment = require("moment");
const CryptoJS = require("crypto-js");
const { Level } = require("level");
const fs = require("fs");
let db;

let blockchain;

let createDb = async (peerId) => {
  let dir = __dirname + "/db/" + peerId;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    db = new Level(dir);
    blockchain = [getGenesisBlock()];
    await storeBlock(getGenesisBlock());
  }
};

let getGenesisBlock = () => {
  let blockHeader = new BlockHeader(
    1,
    null,
    "0x1bc3300000000000000000000000000000000000000000000",
    moment().unix()
  );
  return new Block(blockHeader, 0, null);
};

let getLatestBlock = () => blockchain[blockchain.length - 1];

let addBlock = async (newBlock) => {
  let prevBlock = getLatestBlock();
  if (
    prevBlock.index < newBlock.index &&
    newBlock.blockHeader.previousBlockHeader ===
      prevBlock.blockHeader.merkleRoot
  ) {
    blockchain.push(newBlock);
    await storeBlock(newBlock);
  }
};

let storeBlock = async (newBlock) => {
  try {
    await db.put(newBlock.index.toString(), JSON.stringify(newBlock));
    console.log("--- Inserting block index: " + newBlock.index);
  } catch (err) {
    console.log("Ooops!", err);
  }
};

let getDbBlock = async (index, res) => {
  try {
    const value = await db.get(index.toString());
    return res.send(value);
  } catch (err) {
    return res.send(JSON.stringify(err));
  }
};

let getBlock = (index) => {
  if (blockchain.length - 1 >= index) return blockchain[index];
  else return null;
};

const generateNextBlock = async (txns) => {
  const prevBlock = getLatestBlock(),
    prevMerkleRoot = prevBlock.blockHeader.merkleRoot;
  nextIndex = prevBlock.index + 1;
  nextTime = moment().unix();
  nextMerkleRoot = CryptoJS.SHA256(1, prevMerkleRoot, nextTime).toString();

  const blockHeader = new BlockHeader(
    1,
    prevMerkleRoot,
    nextMerkleRoot,
    nextTime
  );
  const newBlock = new Block(blockHeader, nextIndex, txns);
  blockchain.push(newBlock);
  await storeBlock(newBlock);
  return newBlock;
};

if (typeof exports != "undefined") {
  exports.addBlock = addBlock;
  exports.getBlock = getBlock;
  exports.blockchain = blockchain;
  exports.getLatestBlock = getLatestBlock;
  exports.generateNextBlock = generateNextBlock;
  exports.createDb = createDb;
  exports.getDbBlock = getDbBlock;
}
