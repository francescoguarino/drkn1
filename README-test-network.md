# Istruzioni per testare la rete Drakon in locale

Questo documento spiega come utilizzare lo script `test-local-network.js` per avviare una rete Drakon locale con tre nodi che comunicano tra loro.

## Prerequisiti

- Node.js (versione 14 o superiore)
- NPM (versione 6 o superiore)
- Il progetto Drakon installato e configurato
- Nessuna applicazione attiva sulle porte da 6001 a 6003 e da 7001 a 7003

## Preparazione

1. Assicurati che il firewall Windows permetta la comunicazione tra applicazioni sulla tua macchina
2. Disattiva temporaneamente l'antivirus se blocca le connessioni tra processi
3. Assicurati di essere nella directory principale del progetto Drakon

## Avvio della rete di test

1. Esegui lo script con Node.js:

```bash
node test-local-network.js
```

Questo comando:
- Creerà e pulirà le directory di dati in `C:\drakon-data\`
- Avvierà tre nodi Drakon con le seguenti configurazioni:
  - Nodo 1 (bootstrap): API porta 7001, P2P porta 6001
  - Nodo 2: API porta 7002, P2P porta 6002, connesso al nodo 1
  - Nodo 3: API porta 7003, P2P porta 6003, connesso al nodo 1

## Verificare il funzionamento

Una volta che i tre nodi sono in esecuzione, dovresti vedere messaggi che indicano quando i nodi si connettono tra loro.

Per interagire con i nodi puoi utilizzare le API REST disponibili:

- Nodo 1: `http://localhost:7001/api`
- Nodo 2: `http://localhost:7002/api`
- Nodo 3: `http://localhost:7003/api`

### Test da eseguire

1. **Verifica connessioni**: Controlla i peer connessi:
   ```
   GET http://localhost:7001/api/peers
   GET http://localhost:7002/api/peers
   GET http://localhost:7003/api/peers
   ```

2. **Crea un wallet**:
   ```
   POST http://localhost:7001/api/wallet/create
   ```

3. **Crea una transazione**:
   ```
   POST http://localhost:7001/api/transactions
   Body: {
     "recipientAddress": "INDIRIZZO_DESTINATARIO",
     "amount": 10,
     "fee": 1
   }
   ```

4. **Verifica sincronizzazione**:
   - Crea una transazione nel nodo 1
   - Verifica che appaia nel pool di transazioni degli altri nodi
   - Avvia il mining su uno dei nodi
   - Verifica che il blocco venga propagato a tutti i nodi

## Arresto della rete

Per arrestare tutti i nodi, premi semplicemente `CTRL+C` nella finestra del terminale.

## Risoluzione dei problemi

Se riscontri problemi di connessione tra i nodi:

1. Verifica i log per messaggi di errore specifici
2. Assicurati che nessun'altra applicazione stia utilizzando le porte designate
3. Controlla che il firewall non stia bloccando le connessioni
4. Prova a eseguire lo script con privilegi di amministratore

## Risoluzione problemi avanzata

Se stai riscontrando problemi persistenti di connettività tra i nodi, puoi utilizzare lo script helper incluso `connection-helper.js` che fornisce strumenti di diagnostica e configurazione avanzata.

### Utilizzo dello script helper

Lo script può essere eseguito in modalità standalone per una diagnosi completa:

```bash
node connection-helper.js
```

Questo eseguirà automaticamente:
- Verifica della disponibilità delle porte necessarie
- Identificazione di tutti gli indirizzi IP locali disponibili
- Controllo dello stato del firewall (su Windows)
- Generazione di comandi avanzati per l'avvio dei nodi con configurazione dettagliata

### Integrazione con il test-local-network.js

In alternativa, puoi importare le funzioni utili nel tuo script principale:

```javascript
const connectionHelper = require('./connection-helper.js');

// Esempio: verifica disponibilità porte prima di avviare i nodi
async function checkNetworkRequirements() {
  const portsCheck = await connectionHelper.checkPorts();
  if (!portsCheck.allAvailable) {
    console.error("ERRORE: Alcune porte necessarie sono già in uso.");
    return false;
  }
  return true;
}

// Esempio: ottieni indirizzi IP locali per configurazione avanzata
const ipAddresses = connectionHelper.getAllLocalIpAddresses();
console.log("Indirizzi IP disponibili:", ipAddresses.ipv4.map(ip => ip.address));
```

### Problemi comuni e soluzioni

#### 1. I nodi non si connettono tra loro

Possibili cause e soluzioni:

- **Firewall attivo**: Assicurati che Node.js sia autorizzato nelle regole del firewall di Windows
  ```
  netsh advfirewall firewall add rule name="Drakon Node" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes profile=any
  ```

- **Limitazioni di loopback**: Su alcune configurazioni Windows, il loopback multiporta potrebbe essere limitato
  ```
  CheckNetIsolation LoopbackExempt -a -n="Microsoft.Win32WebViewHost_cw5n1h2txyewy"
  ```

- **Configurazione IP errata**: Usa indirizzi IP locali espliciti invece di 127.0.0.1
  ```
  set DRAKON_P2P_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/6001
  set DRAKON_P2P_ANNOUNCE_ADDRESSES=/ip4/192.168.1.X/tcp/6001
  ```

#### 2. Porte già in uso

Se lo script segnala porte già in uso, puoi:

- Terminare i processi che utilizzano quelle porte:
  ```
  # Windows
  netstat -ano | findstr :6001
  taskkill /PID <PID> /F

  # Linux/macOS
  lsof -i :6001
  kill -9 <PID>
  ```

- Modificare le porte utilizzate in `test-local-network.js`:
  ```javascript
  const apiPorts = [8001, 8002, 8003]; // Invece di 7001, 7002, 7003
  const p2pPorts = [9001, 9002, 9003]; // Invece di 6001, 6002, 6003
  ```

#### 3. Problemi di DNS locale

In alcuni casi, i problemi di risoluzione del nome dell'host locale possono causare problemi di connessione:

- Aggiungi esplicitamente al file hosts:
  ```
  # In C:\Windows\System32\drivers\etc\hosts (Windows)
  # o in /etc/hosts (Linux/macOS)
  127.0.0.1 localhost
  ```

- Utilizza indirizzi IP espliciti invece di nomi host:
  ```
  set DRAKON_P2P_BOOTSTRAP_PEERS=/ip4/192.168.1.X/tcp/6001
  ```

### Verifica della connettività

Per verificare la connettività tra nodi tramite API, puoi utilizzare la funzione `testNodesConnectivity`:

```javascript
const connectionHelper = require('./connection-helper.js');

// Verifica la connettività tra i nodi in esecuzione
async function checkNodesConnection() {
  const connectivityResults = await connectionHelper.testNodesConnectivity();
  console.log("Risultati connettività:", connectivityResults);
}
```

Questa verifica aiuterà a diagnosticare se i nodi sono avviati correttamente ma non riescono a stabilire connessioni P2P tra loro.

## Note tecniche

Lo script configura automaticamente i nodi con le seguenti opzioni:

- Utilizza sia l'indirizzo localhost (`127.0.0.1`) che l'IP locale della macchina
- Configura correttamente i bootstrap nodes con più formati di indirizzo
- Crea directory di dati separate per ogni nodo
- Attiva il mining su tutti i nodi 