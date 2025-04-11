/**
 * Registro centralizzato dei nodi bootstrap della rete Drakon.
 * Questo file contiene l'elenco dei nodi bootstrap conosciuti,
 * che vengono utilizzati come punti di ingresso nella rete.
 * 
 * In futuro, questo file potrà essere aggiornato dinamicamente
 * quando un nodo si connette ad un nodo bootstrap esistente.
 */

// Lista dei nodi bootstrap ufficiali
const OFFICIAL_BOOTSTRAP_NODES = [
  {
    id: '12D3KooWMrCy57meFXrLRjJQgNT1civBXRASsRBLnMDP5aGdQW3F',
    host: '51.89.148.92',
    port: 6001,
    isOfficial: true,
    location: 'EU-West',
    name: 'drakon-bootstrap-1',
    status: 'active'
  },
  {
    id: '12D3KooWGa15XBTP5i1JWMBo4N6sG9Wd3XfY76KYBE9KAiSS1sdK',
    host: '135.125.232.233',
    port: 6001,
    isOfficial: true,
    location: 'EU-Central',
    name: 'drakon-bootstrap-2',
    status: 'active'
  }
];

// Lista di nodi bootstrap comunità
const COMMUNITY_BOOTSTRAP_NODES = [
  // Per ora vuota, in futuro potrà essere popolata dai nodi bootstrap gestiti dalla comunità
];

// Lista di nodi bootstrap personali
// Qui puoi aggiungere i tuoi nodi bootstrap locali o quelli che conosci
const PERSONAL_BOOTSTRAP_NODES = [
  // Esempio:
  // {
  //   id: 'identifcativo-peer',
  //   host: '192.168.1.100',
  //   port: 6001,
  //   isOfficial: false,
  //   name: 'mio-nodo-locale',
  //   status: 'active'
  // }
];

// Unisci tutte le liste
const ALL_BOOTSTRAP_NODES = [
  ...OFFICIAL_BOOTSTRAP_NODES,
  ...COMMUNITY_BOOTSTRAP_NODES,
  ...PERSONAL_BOOTSTRAP_NODES
];

/**
 * Restituisce tutti i nodi bootstrap conosciuti
 * @returns {Array} Lista di tutti i nodi bootstrap
 */
function getAllBootstrapNodes() {
  return ALL_BOOTSTRAP_NODES;
}

/**
 * Restituisce solo i nodi bootstrap ufficiali
 * @returns {Array} Lista dei nodi bootstrap ufficiali
 */
function getOfficialBootstrapNodes() {
  return OFFICIAL_BOOTSTRAP_NODES;
}

/**
 * Restituisce solo i nodi bootstrap attivi
 * @returns {Array} Lista dei nodi bootstrap attivi
 */
function getActiveBootstrapNodes() {
  return ALL_BOOTSTRAP_NODES.filter(node => node.status === 'active');
}

/**
 * Converte un nodo bootstrap nel formato multiaddr utilizzato da libp2p
 * @param {Object} node Nodo bootstrap
 * @returns {String} Indirizzo multiaddr
 */
function toMultiAddr(node) {
  return `/ip4/${node.host}/tcp/${node.port}/p2p/${node.id}`;
}

/**
 * Restituisce gli indirizzi multiaddr di tutti i nodi bootstrap
 * @returns {Array} Lista degli indirizzi multiaddr
 */
function getAllMultiaddrs() {
  return ALL_BOOTSTRAP_NODES.map(toMultiAddr);
}

/**
 * Aggiunge un nuovo nodo bootstrap alla lista locale
 * Nota: questa funzione aggiorna solo la lista in memoria, non il file
 * @param {Object} node Nodo bootstrap da aggiungere
 */
function addBootstrapNode(node) {
  // Verifica che il nodo non sia già presente
  const exists = ALL_BOOTSTRAP_NODES.some(n => n.id === node.id);
  
  if (!exists) {
    ALL_BOOTSTRAP_NODES.push({
      ...node,
      isOfficial: false,
      status: 'active'
    });
  }
}

// Esporta le funzioni e i dati
export {
  getAllBootstrapNodes,
  getOfficialBootstrapNodes,
  getActiveBootstrapNodes,
  toMultiAddr,
  getAllMultiaddrs,
  addBootstrapNode,
  OFFICIAL_BOOTSTRAP_NODES,
  COMMUNITY_BOOTSTRAP_NODES,
  PERSONAL_BOOTSTRAP_NODES,
  ALL_BOOTSTRAP_NODES
}; 