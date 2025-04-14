/**
 * Script per avviare una rete locale di test per Drakon
 * Questo script configura e avvia tre nodi nella stessa macchina
 * che dovrebbero connettersi tra loro.
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configura i percorsi base
const DATA_DIR_BASE = path.join('C:\\', 'drakon-data');
const NODE1_DIR = path.join(DATA_DIR_BASE, 'node1');
const NODE2_DIR = path.join(DATA_DIR_BASE, 'node2');
const NODE3_DIR = path.join(DATA_DIR_BASE, 'node3');

// Crea le directory se non esistono
function setupDirectories() {
  console.log('Configurazione directory di dati...');
  
  // Crea la directory base
  if (!fs.existsSync(DATA_DIR_BASE)) {
    fs.mkdirSync(DATA_DIR_BASE, { recursive: true });
  }
  
  // Pulisci e crea le directory dei nodi
  [NODE1_DIR, NODE2_DIR, NODE3_DIR].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'storage'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  });
  
  console.log('Directory pronte!');
}

// Ottieni indirizzo IP locale
function getLocalIpAddress() {
  const networkInterfaces = os.networkInterfaces();
  
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal && !interfaceName.startsWith('vEthernet')) {
        return iface.address;
      }
    }
  }
  
  return '127.0.0.1';  // Fallback a localhost
}

// Funzione per avviare un nodo
function startNode(nodeNumber, bootstrapId = null, bootstrapPort = null) {
  const localIp = getLocalIpAddress();
  const nodeDir = path.join(DATA_DIR_BASE, `node${nodeNumber}`);
  const p2pPort = 6000 + nodeNumber;
  const apiPort = 7000 + nodeNumber;
  
  console.log(`Avvio nodo ${nodeNumber} sulla porta P2P ${p2pPort} e API ${apiPort}...`);
  
  // Configura le variabili d'ambiente
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    API_PORT: apiPort.toString(),
    P2P_PORT: p2pPort.toString(),
    DATA_DIR: nodeDir,
    MINING_ENABLED: 'true'
  };
  
  // Se è il primo nodo, imposta come bootstrap
  if (nodeNumber === 1) {
    env.IS_BOOTSTRAP = 'true';
  } 
  // Altrimenti configura per connettersi al nodo bootstrap
  else if (bootstrapId && bootstrapPort) {
    // Aggiungi configurazione bootstrap in tutti i formati possibili per garantire connettività
    env.BOOTSTRAP_NODES = JSON.stringify([
      { host: '127.0.0.1', port: bootstrapPort, id: bootstrapId },
      { host: localIp, port: bootstrapPort, id: bootstrapId },
      { host: 'localhost', port: bootstrapPort, id: bootstrapId }
    ]);
  }
  
  // Avvia il nodo con Node.js (nota: useremo nodemon attraverso npm)
  const nodeProcess = spawn('npm', ['run', 'dev'], { 
    env,
    cwd: process.cwd(),
    shell: true,
    stdio: 'pipe'  // Cattura stdout e stderr
  });
  
  // Segnale per quando il nodo è pronto
  let nodeReady = false;
  let peerId = null;
  
  // Gestisci l'output
  nodeProcess.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Cerca l'ID del peer nei log
    const peerIdMatch = output.match(/PeerId utilizzato: (12D3KooW[a-zA-Z0-9]+)/);
    if (peerIdMatch && peerIdMatch[1]) {
      peerId = peerIdMatch[1];
      console.log(`Nodo ${nodeNumber} ha PeerId: ${peerId}`);
    }
    
    // Verifica se il nodo è pronto
    if (output.includes('API Server in ascolto') && !nodeReady) {
      nodeReady = true;
      console.log(`✅ Nodo ${nodeNumber} avviato e pronto! (API: http://localhost:${apiPort})`);
      
      // Se è il nodo 1 (bootstrap), segnala il completamento
      if (nodeNumber === 1 && peerId) {
        node1Ready(peerId, p2pPort);
      }
    }
    
    // Mostra informazioni sulla connessione tra peer
    if (output.includes('Connesso al peer:')) {
      console.log(`🔗 Nodo ${nodeNumber}: ${output.trim()}`);
    }
    
    // Limita l'output solo a messaggi importanti
    if (output.includes('error') || output.includes('ERRORE') || 
        output.includes('Nodo avviato con successo') ||
        output.includes('Connesso al') ||
        output.includes('Avvio del miner')) {
      console.log(`[Nodo ${nodeNumber}] ${output.trim()}`);
    }
  });
  
  // Mostra errori
  nodeProcess.stderr.on('data', (data) => {
    console.error(`[Nodo ${nodeNumber} ERROR] ${data.toString().trim()}`);
  });
  
  return nodeProcess;
}

// Funzione chiamata quando il nodo 1 è pronto
let node1Process, node2Process, node3Process;
function node1Ready(peerId, port) {
  console.log('👍 Nodo bootstrap pronto, avvio dei nodi client...');
  
  // Avvia il nodo 2
  setTimeout(() => {
    node2Process = startNode(2, peerId, port);
    
    // Avvia il nodo 3
    setTimeout(() => {
      node3Process = startNode(3, peerId, port);
    }, 5000);
  }, 3000);
}

// Gestione della chiusura
process.on('SIGINT', () => {
  console.log('\nArresto dei nodi...');
  [node1Process, node2Process, node3Process].forEach(proc => {
    if (proc) {
      proc.kill();
    }
  });
  process.exit(0);
});

// Avvia la rete
console.log('⭐️ Avvio della rete di test Drakon con 3 nodi...');
setupDirectories();
node1Process = startNode(1);

console.log('✨ Rete in fase di avvio...');
console.log('Per arrestare tutti i nodi, premi CTRL+C'); 