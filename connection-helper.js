/**
 * Drakon Network - Utility per risolvere problemi di connessione dei nodi
 * 
 * Questo script fornisce funzioni di supporto per diagnosticare e
 * risolvere problemi di connessione tra nodi nella rete Drakon.
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dns = require('dns');

/**
 * Controlla se una porta è in uso
 * @param {number} port - Porta da verificare
 * @returns {Promise<boolean>} - true se la porta è disponibile, false se è in uso
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', () => {
      resolve(false); // Porta in uso
    });
    
    server.once('listening', () => {
      server.close();
      resolve(true); // Porta libera
    });
    
    server.listen(port);
  });
}

/**
 * Verifica la disponibilità di tutte le porte necessarie per i nodi
 * @param {Array<number>} apiPorts - Porte API da verificare
 * @param {Array<number>} p2pPorts - Porte P2P da verificare
 * @returns {Promise<Object>} - Risultato del controllo
 */
async function checkPorts(apiPorts = [7001, 7002, 7003], p2pPorts = [6001, 6002, 6003]) {
  const results = {
    api: {},
    p2p: {},
    allAvailable: true
  };
  
  console.log("Verifico disponibilità porte...");
  
  // Controlla porte API
  for (const port of apiPorts) {
    results.api[port] = await isPortAvailable(port);
    if (!results.api[port]) {
      results.allAvailable = false;
      console.log(`⚠️ La porta API ${port} è già in uso`);
    } else {
      console.log(`✅ Porta API ${port} disponibile`);
    }
  }
  
  // Controlla porte P2P
  for (const port of p2pPorts) {
    results.p2p[port] = await isPortAvailable(port);
    if (!results.p2p[port]) {
      results.allAvailable = false;
      console.log(`⚠️ La porta P2P ${port} è già in uso`);
    } else {
      console.log(`✅ Porta P2P ${port} disponibile`);
    }
  }
  
  return results;
}

/**
 * Ottiene tutti gli indirizzi IP locali del sistema
 * @returns {Object} - Indirizzi IPv4 e IPv6 locali
 */
function getAllLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = {
    ipv4: [],
    ipv6: []
  };
  
  Object.keys(interfaces).forEach((interfaceName) => {
    interfaces[interfaceName].forEach((iface) => {
      // Salta indirizzi non interni, loopback e virtuali
      if (!iface.internal) {
        if (iface.family === 'IPv4' || iface.family === 4) {
          addresses.ipv4.push({
            address: iface.address,
            interface: interfaceName
          });
        } else if (iface.family === 'IPv6' || iface.family === 6) {
          addresses.ipv6.push({
            address: iface.address,
            interface: interfaceName
          });
        }
      }
    });
  });
  
  // Aggiungi sempre localhost
  addresses.ipv4.push({ address: '127.0.0.1', interface: 'loopback' });
  addresses.ipv6.push({ address: '::1', interface: 'loopback' });
  
  return addresses;
}

/**
 * Controlla lo stato del firewall di Windows
 * @returns {Promise<Object>} - Stato del firewall
 */
function checkFirewall() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ 
        checked: false, 
        message: 'Controllo firewall disponibile solo su Windows' 
      });
      return;
    }
    
    console.log("Controllo configurazione firewall...");
    exec('netsh advfirewall show allprofiles state', (error, stdout) => {
      if (error) {
        resolve({ 
          checked: false, 
          error: error.message,
          message: 'Impossibile controllare il firewall. Esegui come amministratore.'
        });
        return;
      }
      
      const profiles = ['Domain', 'Private', 'Public'];
      const results = {
        checked: true,
        profiles: {},
        anyActive: false,
        allActive: true
      };
      
      profiles.forEach(profile => {
        const regex = new RegExp(`${profile} Profile Settings:\\r?\\n.*State\\s*(ON|OFF)`);
        const match = stdout.match(regex);
        if (match) {
          const isActive = match[1] === 'ON';
          results.profiles[profile] = isActive;
          results.anyActive = results.anyActive || isActive;
          results.allActive = results.allActive && isActive;
        }
      });
      
      resolve(results);
    });
  });
}

/**
 * Verifica la connettività dei nodi tramite API
 * @param {Array<number>} ports - Porte API dei nodi
 * @returns {Promise<Object>} - Risultato dei test
 */
async function testNodesConnectivity(ports = [7001, 7002, 7003]) {
  const results = {
    reachable: {},
    peers: {}
  };
  
  console.log("Verifico connettività nodi...");
  
  for (const port of ports) {
    try {
      // Controlla se il nodo risponde
      const checkResponse = await fetch(`http://localhost:${port}/api/status`, {
        method: 'GET',
        timeout: 3000
      }).catch(() => null);
      
      results.reachable[port] = checkResponse && checkResponse.ok;
      
      if (results.reachable[port]) {
        console.log(`✅ Nodo sulla porta ${port} raggiungibile`);
        
        // Controlla peers connessi
        const peersResponse = await fetch(`http://localhost:${port}/api/peers`, {
          method: 'GET',
          timeout: 3000
        }).catch(() => null);
        
        if (peersResponse && peersResponse.ok) {
          const peersData = await peersResponse.json();
          results.peers[port] = peersData;
          console.log(`ℹ️ Nodo sulla porta ${port} ha ${peersData.length || 0} peers connessi`);
        } else {
          results.peers[port] = [];
          console.log(`⚠️ Impossibile ottenere peers dal nodo sulla porta ${port}`);
        }
      } else {
        console.log(`❌ Nodo sulla porta ${port} non risponde`);
      }
    } catch (error) {
      results.reachable[port] = false;
      console.log(`❌ Errore nel raggiungere il nodo sulla porta ${port}: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * Genera comandi per avviare nodi con configurazioni avanzate
 * @param {number} nodeCount - Numero di nodi da configurare
 * @returns {Object} - Comandi per avviare i nodi
 */
function generateAdvancedNodeCommands(nodeCount = 3) {
  const ipAddresses = getAllLocalIpAddresses();
  const baseApiPort = 7001;
  const baseP2pPort = 6001;
  const commands = [];
  
  console.log("Generazione comandi avanzati per avvio nodi:");
  
  const bootstrapConfig = {
    apiPort: baseApiPort,
    p2pPort: baseP2pPort,
    addresses: [
      `/ip4/127.0.0.1/tcp/${baseP2pPort}`,
      ...ipAddresses.ipv4.map(ip => `/ip4/${ip.address}/tcp/${baseP2pPort}`)
    ]
  };
  
  // Genera ID fittizio per esempio (in realtà verrebbe generato dal nodo)
  const bootstrapId = "QmBootstrapNodeXYZ";
  
  // Generazione comando bootstrap node
  const bootstrapCmd = [
    `set DRAKON_API_PORT=${bootstrapConfig.apiPort}`,
    `set DRAKON_P2P_PORT=${bootstrapConfig.p2pPort}`,
    `set DRAKON_DATA_DIR=C:\\drakon-data\\node1`,
    `set DRAKON_P2P_ANNOUNCE_ADDRESSES=${bootstrapConfig.addresses.join(',')}`,
    `set DRAKON_P2P_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/${bootstrapConfig.p2pPort}`,
    `set DRAKON_MINING_ENABLED=true`,
    `npm start`
  ].join(" && ");
  
  commands.push({
    nodeNumber: 1,
    isBootstrap: true,
    command: bootstrapCmd,
    config: bootstrapConfig
  });
  
  // Configurazione per gli altri nodi
  for (let i = 2; i <= nodeCount; i++) {
    const apiPort = baseApiPort + (i - 1);
    const p2pPort = baseP2pPort + (i - 1);
    
    const nodeConfig = {
      apiPort,
      p2pPort,
      addresses: [
        `/ip4/127.0.0.1/tcp/${p2pPort}`,
        ...ipAddresses.ipv4.map(ip => `/ip4/${ip.address}/tcp/${p2pPort}`)
      ],
      bootstrapAddresses: bootstrapConfig.addresses
    };
    
    const nodeCmd = [
      `set DRAKON_API_PORT=${nodeConfig.apiPort}`,
      `set DRAKON_P2P_PORT=${nodeConfig.p2pPort}`,
      `set DRAKON_DATA_DIR=C:\\drakon-data\\node${i}`,
      `set DRAKON_P2P_ANNOUNCE_ADDRESSES=${nodeConfig.addresses.join(',')}`,
      `set DRAKON_P2P_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/${nodeConfig.p2pPort}`,
      `set DRAKON_P2P_BOOTSTRAP_PEERS=${nodeConfig.bootstrapAddresses.join(',')}`,
      `set DRAKON_MINING_ENABLED=true`,
      `npm start`
    ].join(" && ");
    
    commands.push({
      nodeNumber: i,
      isBootstrap: false,
      command: nodeCmd,
      config: nodeConfig
    });
  }
  
  // Stampa i comandi
  commands.forEach(cmd => {
    console.log(`\n--- Nodo ${cmd.nodeNumber} ${cmd.isBootstrap ? '(bootstrap)' : ''} ---`);
    console.log(cmd.command);
  });
  
  return commands;
}

// Export delle funzioni
module.exports = {
  checkPorts,
  getAllLocalIpAddresses,
  checkFirewall,
  testNodesConnectivity,
  generateAdvancedNodeCommands
};

// Se eseguito direttamente, esegui una diagnosi completa
if (require.main === module) {
  (async () => {
    console.log("=== Drakon Connection Helper - Diagnosi di rete ===\n");
    
    // Controlla le porte
    const portsCheck = await checkPorts();
    console.log("\nRisultato verifica porte:", 
      portsCheck.allAvailable ? "✅ Tutte le porte sono disponibili" : "⚠️ Alcune porte sono in uso");
    
    // Elenca gli indirizzi IP
    const ipAddresses = getAllLocalIpAddresses();
    console.log("\nIndirizzi IP disponibili:");
    console.log("IPv4:", ipAddresses.ipv4.map(ip => `${ip.address} (${ip.interface})`).join(", "));
    
    // Controlla il firewall (solo su Windows)
    const firewallStatus = await checkFirewall();
    if (firewallStatus.checked) {
      console.log("\nStato Firewall Windows:");
      Object.entries(firewallStatus.profiles).forEach(([profile, isActive]) => {
        console.log(`- Profilo ${profile}: ${isActive ? 'Attivo' : 'Disattivo'}`);
      });
      
      if (firewallStatus.anyActive) {
        console.log("\n⚠️ Attenzione: il firewall è attivo e potrebbe bloccare le connessioni.");
        console.log("   Verifica che il programma Node.js sia consentito nelle regole del firewall.");
      }
    } else {
      console.log("\nImpossibile verificare lo stato del firewall:", firewallStatus.message);
    }
    
    // Genera comandi avanzati
    console.log("\n=== Comandi avanzati per avvio nodi ===");
    generateAdvancedNodeCommands();
    
    console.log("\n=== Fine diagnosi ===");
    console.log("Per utilizzare le funzioni di questo script, importalo nel test-local-network.js");
  })().catch(console.error);
} 