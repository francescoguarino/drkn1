# Drakon Network

Drakon è una rete blockchain peer-to-peer progettata per essere scalabile, sicura e facile da usare. Questo repository contiene il codice sorgente per un nodo Drakon, che può essere eseguito su qualsiasi sistema che supporti Node.js.

## Caratteristiche principali

- Struttura blockchain completa con supporto per transazioni
- Rete peer-to-peer basata su libp2p
- Scoperta automatica dei nodi attraverso bootstrap nodes e DHT
- API REST per interagire con il nodo
- Gestione di wallet integrata
- Sincronizzazione della blockchain tra nodi

## Requisiti

- Node.js v14 o superiore
- NPM v6 o superiore

## Installazione

```bash
# Clona il repository
git clone https://github.com/tuoUsername/drakon.git
cd drakon

# Installa le dipendenze
npm install
```

## Avvio di un nodo

Per avviare un nodo con la configurazione predefinita:

```bash
node src/index.js
```

Il nodo creerà automaticamente una directory `.drakon-node` nella home dell'utente, dove verranno salvati tutti i dati del nodo, inclusi blockchain, wallet e configurazioni.

### Opzioni di avvio

Il nodo supporta diverse opzioni di configurazione che possono essere specificate tramite variabili d'ambiente:

- `API_PORT`: Porta per l'API REST (default: 7001)
- `P2P_PORT`: Porta per la comunicazione P2P (default: 6001)
- `DATA_DIR`: Directory per i dati (default: ~/.drakon-node)
- `MINING_ENABLED`: Abilita il mining (default: false)
- `BOOTSTRAP_NODES`: Lista di nodi bootstrap in formato JSON
- `IS_BOOTSTRAP`: Imposta il nodo come bootstrap node (default: false)

Esempio:

```bash
API_PORT=8080 P2P_PORT=9000 MINING_ENABLED=true node src/index.js
```

## Connessione tra nodi su diversi server

Per far comunicare i nodi tra loro su macchine diverse, è necessario configurare i bootstrap nodes. Drakon utilizza un sistema di discovery distribuito che permette ai nodi di trovarsi automaticamente una volta connessi alla rete.

### Procedura per connettere due nodi

1. **Avvio del primo nodo**

   ```bash
   node src/index.js
   ```

   Dai log, prendi nota dell'indirizzo IP e del PeerId (una stringa come `12D3KooWXXX...`)

2. **Avvio del secondo nodo**

   ```bash
   BOOTSTRAP_NODES='[{"host":"IP-DEL-PRIMO-NODO","port":6001,"id":"PEER-ID-DEL-PRIMO-NODO"}]' node src/index.js
   ```

   Sostituisci `IP-DEL-PRIMO-NODO` e `PEER-ID-DEL-PRIMO-NODO` con i valori ottenuti dal primo nodo.

3. **Aggiornamento del primo nodo (opzionale, ma consigliato)**
   Riavvia il primo nodo con la conoscenza del secondo:
   ```bash
   BOOTSTRAP_NODES='[{"host":"IP-DEL-SECONDO-NODO","port":6001,"id":"PEER-ID-DEL-SECONDO-NODO"}]' node src/index.js
   ```

### Nodi bootstrap predefiniti

La rete Drakon include due nodi bootstrap predefiniti attivi che facilitano l'ingresso nella rete:

```
Server 1: 51.89.148.92:6001 (ID: 12D3KooWMrCy57meFXrLRjJQgNT1civBXRASsRBLnMDP5aGdQW3F)
Server 2: 135.125.232.233:6001 (ID: 12D3KooWGa15XBTP5i1JWMBo4N6sG9Wd3XfY76KYBE9KAiSS1sdK)
```

Questi nodi sono configurati nella rete per impostazione predefinita, quindi i nuovi nodi dovrebbero essere in grado di connettersi automaticamente alla rete senza configurazione aggiuntiva.

Per connettersi manualmente a questi nodi, è possibile utilizzare:

```bash
BOOTSTRAP_NODES='[{"host":"51.89.148.92","port":6001,"id":"12D3KooWMrCy57meFXrLRjJQgNT1civBXRASsRBLnMDP5aGdQW3F"},{"host":"135.125.232.233","port":6001,"id":"12D3KooWGa15XBTP5i1JWMBo4N6sG9Wd3XfY76KYBE9KAiSS1sdK"}]' node src/index.js
```

## API REST

Una volta avviato, il nodo espone un'API REST sulla porta specificata (default: 7001).

Endpoint principali:

- `GET /status`: Restituisce lo stato del nodo
- `GET /blocks`: Elenco dei blocchi nella blockchain
- `GET /peers`: Elenco dei peer connessi
- `POST /transactions`: Crea una nuova transazione

## Persistenza dei dati

Tutti i dati vengono salvati nella directory `.drakon-node` nella home dell'utente, che contiene:

- `data/`: Database blockchain
- `wallet/`: File del wallet
- `peer-id/`: Identificativo permanente del nodo
- `known-peers.json`: Cache dei peer conosciuti

## Risoluzione dei problemi

### Il nodo non si connette ad altri nodi

1. Verifica che le porte necessarie (6001 per P2P, 7001 per API) siano aperte nel firewall
2. Controlla che l'indirizzo IP fornito come bootstrap node sia raggiungibile
3. Verifica che il formato del PeerId sia corretto nel parametro BOOTSTRAP_NODES

### Errore "Transport could not listen on any available address"

Questo errore può verificarsi se:

- La porta è già in uso: prova a cambiare porta con P2P_PORT
- Non ci sono permessi sufficienti: verifica i permessi dell'utente

## Sviluppo

Per contribuire al progetto:

1. Forka il repository
2. Crea un branch per la tua feature (`git checkout -b feature/amazing-feature`)
3. Committa i tuoi cambiamenti (`git commit -m 'Aggiungi una feature fantastica'`)
4. Pusha al branch (`git push origin feature/amazing-feature`)
5. Apri una Pull Request

## Contatti

Per assistenza o per entrare in contatto con gli sviluppatori:

- Francesco Guarino - guarinofrancesco42@gmail.com

## Licenza

Questo progetto è sotto licenza MIT - vedi il file [LICENSE](LICENSE) per i dettagli.
