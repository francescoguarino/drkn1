# Linee Guida per l'Infrastruttura di Rete

Questo documento descrive le logiche principali e i file coinvolti nella gestione della rete P2P, dei peer, dei nodi (full e bootstrap), delle API, dei protocolli P2P e degli eventi.

---

## 1. **Rete P2P**

### Funzionalità principali:
- **Connessione ai peer**: Gestisce la connessione ai peer tramite protocolli P2P.
- **Scoperta dei peer**: Utilizza bootstrap nodes e DHT per scoprire nuovi peer.
- **Propagazione dei messaggi**: Permette la trasmissione di messaggi tra i nodi.
- **Manutenzione della rete**: Include la pulizia dei peer inattivi e la gestione della DHT.

### File principali:
- `src/network/NetworkManager.js`: Gestisce la logica principale della rete P2P.
- `src/network/DHT.js`: Implementa una DHT basata su Kademlia per la scoperta dei nodi.
- `src/network/PeerManager.js`: Gestisce lo stato e le connessioni dei peer.
- `src/network/PeerConnection.js`: Gestisce la comunicazione con un singolo peer.

---

## 2. **Gestione dei Peer**

### Funzionalità principali:
- **Aggiunta e rimozione**: Aggiunge nuovi peer e rimuove quelli inattivi.
- **Stato dei peer**: Monitora lo stato (attivo/inattivo) e le statistiche dei peer.
- **Broadcast**: Invia messaggi a tutti i peer connessi.

### File principali:
- `src/network/PeerManager.js`: Contiene metodi come `addPeer`, `removePeer`, `broadcast`, `getPeerStats`.
- `src/network/PeerConnection.js`: Gestisce la coda dei messaggi e la comunicazione con i peer.

---

## 3. **Nodo Full**

### Funzionalità principali:
- **Sincronizzazione blockchain**: Sincronizza i dati della blockchain con altri nodi.
- **Gestione delle transazioni**: Propaga e riceve transazioni.
- **Mining**: Supporta il mining locale.

### File principali:
- `src/noode-runner.js`: SI OCCUPA DI AVVIARE UN NODO O INIZZIALIZZARLO PER LA PRIMA VOLTA.
- `src/network/NetworkManager.js`: Gestisce la logica del nodo full.
- `src/network/DHT.js`: Pubblica e aggiorna il `nodeId` nella DHT.
- `src/network/PeerManager.js`: Monitora i peer connessi.

---

## 4. **Nodo Bootstrap**

### Funzionalità principali:
- **Punto di ingresso**: Fornisce un punto di connessione iniziale per nuovi nodi.
- **Distribuzione dei peer**: Condivide informazioni sui peer connessi.

### File principali:
- `src/bootstrap-runner.js`: SI OCCUPA DI AVVIARE UN NODO BOOTSTRAP O INIZZIALIZZARLO PER LA PRIMA VOLTA.
- `src/network/NetworkManager.js`: Contiene la logica per connettersi ai bootstrap nodes.
- `src/network/DHT.js`: Gestisce la tabella di routing per i nodi bootstrap.

---

## 5. **API**

### Funzionalità principali:
- **Endpoint REST**: Fornisce endpoint per interagire con la rete.
  - `/network/peers`: Restituisce la lista dei peer connessi.
  - `/transactions`: Gestisce le transazioni.
  - `/wallet/create`: Crea un nuovo wallet.

### File principali:
- `src/api/routes.js`: Configura gli endpoint REST.
- `src/network/NetworkManager.js`: Fornisce i dati richiesti dagli endpoint.

---

## 6. **Protocolli P2P**

### Protocolli supportati:
- **/drakon/1.0.0**: Protocollo principale per la comunicazione tra i nodi.
- **DHT**: Per la scoperta e la gestione dei nodi.
- **Gossipsub**: Per la propagazione dei messaggi.

### File principali:
- `src/network/NetworkManager.js`: Configura i protocolli durante la creazione del nodo libp2p.
- `src/network/DHT.js`: Implementa il protocollo DHT.

---

## 7. **Eventi**

### Eventi principali:
- **peer:connect**: Emette un evento quando un peer si connette.
- **peer:disconnect**: Emette un evento quando un peer si disconnette.
- **message:received**: Emette un evento quando un messaggio viene ricevuto.  (noon funzionante)

### File principali:
- `src/network/NetworkManager.js`: Configura gli event listeners per i peer.
- `src/network/PeerConnection.js`: Emette eventi per la gestione della connessione.

---

## 8. **Manutenzione della Rete**

### Funzionalità principali:
- **Pulizia dei peer inattivi**: Rimuove i peer che non rispondono.
- **Manutenzione della DHT**: Aggiorna e pulisce i nodi nella tabella di routing.

### File principali:
- `src/network/PeerManager.js`: Metodo `cleanup` per rimuovere i peer inattivi.
- `src/network/DHT.js`: Metodo `cleanupStaleNodes` per rimuovere i nodi non più attivi.

---

## 9. **Altre Note**

- **Configurazione**: Le porte P2P e API possono essere configurate in `src/config/index.js`.
- **Test della rete**: Usa `test-local-network.js` per avviare una rete di test locale.
