const axios = require("axios");
const chalk = require("chalk");
const clear = require("clear");
const figlet = require("figlet");
const Table = require("cli-table3");

const config = require("./config");

const REFRESH_INTERVAL = 5000; // 5 secondi

async function getNodeInfo() {
  try {
    const response = await axios.get(
      `http://localhost:${config.defaultHTTPPort}/info`
    );
    return response.data;
  } catch (error) {
    console.error(
      "Errore nel recupero delle informazioni del nodo:",
      error.message
    );
    return null;
  }
}

async function getPeers() {
  try {
    const response = await axios.get(
      `http://localhost:${config.defaultHTTPPort}/peers`
    );
    return response.data;
  } catch (error) {
    console.error("Errore nel recupero dei peers:", error.message);
    return [];
  }
}

async function getBlocks() {
  try {
    const response = await axios.get(
      `http://localhost:${config.defaultHTTPPort}/blocks`
    );
    return response.data;
  } catch (error) {
    console.error("Errore nel recupero dei blocchi:", error.message);
    return [];
  }
}

function showBanner() {
  clear();
  console.log(
    chalk.yellow(figlet.textSync("DRAKON MONITOR", { font: "Standard" }))
  );
}

function formatUptime(uptime) {
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  return `${hours}h ${minutes}m ${seconds}s`;
}

async function displayStats() {
  const nodeInfo = await getNodeInfo();
  const peers = await getPeers();
  const blocks = await getBlocks();

  if (!nodeInfo) {
    console.log(chalk.red("Nodo non raggiungibile"));
    return;
  }

  showBanner();
  console.log(chalk.yellow("=".repeat(80)));

  // Informazioni del nodo
  const nodeTable = new Table({
    head: [chalk.cyan("Proprietà"), chalk.cyan("Valore")],
  });

  nodeTable.push(
    ["Node ID", nodeInfo.nodeId.substring(0, 16) + "..."],
    ["Uptime", formatUptime(nodeInfo.uptime)],
    ["Blocchi Creati", nodeInfo.blocksCreated],
    ["Peers Connessi", nodeInfo.peersConnected],
    [
      "Ultimo Blocco",
      nodeInfo.lastBlockTime
        ? new Date(nodeInfo.lastBlockTime).toLocaleString()
        : "N/A",
    ]
  );

  console.log(nodeTable.toString());
  console.log(chalk.yellow("=".repeat(80)));

  // Lista dei peers
  if (peers.length > 0) {
    const peerTable = new Table({
      head: [chalk.cyan("Peer ID"), chalk.cyan("Connesso da")],
    });

    peers.forEach((peer) => {
      peerTable.push([peer.id, new Date(peer.connectedSince).toLocaleString()]);
    });

    console.log(chalk.green("\nPeers Connessi:"));
    console.log(peerTable.toString());
  } else {
    console.log(chalk.yellow("\nNessun peer connesso"));
  }

  // Ultimi blocchi
  if (blocks.length > 0) {
    const blockTable = new Table({
      head: [chalk.cyan("Indice"), chalk.cyan("Hash"), chalk.cyan("Timestamp")],
    });

    blocks.slice(-5).forEach((block) => {
      blockTable.push([
        block.index,
        block.hash.substring(0, 16) + "...",
        new Date(block.timestamp).toLocaleString(),
      ]);
    });

    console.log(chalk.green("\nUltimi 5 Blocchi:"));
    console.log(blockTable.toString());
  } else {
    console.log(chalk.yellow("\nNessun blocco nella blockchain"));
  }
}

// Aggiorna le statistiche ogni REFRESH_INTERVAL millisecondi
setInterval(displayStats, REFRESH_INTERVAL);
displayStats();
