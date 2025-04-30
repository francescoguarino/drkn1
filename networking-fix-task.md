# **Roadmap per risolvere i problemi di rete e gestione dei nodi**

## **Fase 1: Correggere il salvataggio e il caricamento del `PeerId`**
### Problema
- Il `NodeStorage` salva solo il `nodeId` e non il `PeerId`, causando la rigenerazione del `PeerId` ad ogni riavvio.

### Task
1. **Aggiornare il metodo `saveNodeInfo` in `NodeStorage`**:
   - Salvare il `PeerId` completo (inclusi `privKey` e `pubKey`).
   ```javascript
   async saveNodeInfo(nodeInfo) {
     const dataToSave = {
       ...nodeInfo,
       peerId: this.peerId ? this.peerId.toJSON() : null
     };
     await fs.writeFile(this.nodeInfoPath, JSON.stringify(dataToSave, null, 2));
   }
   ```

2. **Aggiornare il metodo `loadNodeInfo` in `NodeStorage`**:
   - Caricare il `PeerId` dal file salvato.
   ```javascript
   async loadNodeInfo() {
     const data = JSON.parse(await fs.readFile(this.nodeInfoPath, 'utf8'));
     if (data.peerId) {
       this.peerId = await createFromPrivKey(data.peerId.privKey);
     }
     return data;
   }
   ```

3. **Aggiornare il `NetworkManager` per utilizzare il `PeerId` caricato**:
   - Assicurarsi che il `PeerId` venga passato correttamente al nodo libp2p.

---

## **Fase 2: Risolvere i problemi di connessione tra nodi**
### Problema
- I nodi normali non riescono a connettersi ai nodi bootstrap o ad altri nodi.

### Task
1. **Aggiornare `_connectToBootstrapPeers` in `NetworkManager`**:
   - Gestire meglio i tentativi di connessione ai nodi bootstrap.
   ```javascript
   async _connectToBootstrapPeers() {
     for (const bootstrapNode of this.config.p2p.bootstrapNodes) {
       try {
         await this.node.dial(bootstrapNode);
         this.logger.info(`Connesso al bootstrap node: ${bootstrapNode}`);
       } catch (error) {
         this.logger.warn(`Errore nella connessione al bootstrap node: ${error.message}`);
       }
     }
   }
   ```

2. **Implementare un meccanismo di riconnessione automatica**:
   - Riconnettere i peer disconnessi periodicamente.
   ```javascript
   setInterval(() => {
     this._checkAndReconnect(this.peers);
   }, 30000);
   ```

3. **Verificare che i nodi bootstrap siano configurati correttamente**:
   - Aggiungere controlli per garantire che i nodi bootstrap siano raggiungibili.

---

## **Fase 3: Migliorare la gestione degli eventi di rete**
### Problema
- Gli eventi `peer:connect`, `peer:disconnect` e `message` non sono gestiti in modo coerente.

### Task
1. **Centralizzare la gestione degli eventi in `NetworkManager`**:
   - Aggiornare `_setupEventHandlers` per gestire correttamente gli eventi.
   ```javascript
   _setupEventHandlers() {
     this.node.addEventListener('peer:connect', (evt) => {
       const peerId = evt.detail.toString();
       if (!this.peers.has(peerId)) {
         this.peers.add(peerId);
         this.logger.info(`Peer connesso: ${peerId}`);
       }
     });

     this.node.addEventListener('peer:disconnect', (evt) => {
       const peerId = evt.detail.toString();
       if (this.peers.has(peerId)) {
         this.peers.delete(peerId);
         this.logger.info(`Peer disconnesso: ${peerId}`);
       }
     });
   }
   ```

2. **Aggiungere controlli per evitare duplicazioni**:
   - Verificare che un peer non venga aggiunto più volte alla lista.

3. **Gestire errori durante la propagazione dei messaggi**:
   - Loggare errori e continuare l'elaborazione per gli altri peer.

---

## **Fase 4: Correggere il bootstrap runner e il node runner**
### Problema
- I nodi non vengono configurati correttamente all'avvio.

### Task
1. **Aggiornare il `bootstrap-runner`**:
   - Verificare che il nodo bootstrap sia raggiungibile.
   ```javascript
   async function testBootstrapConnection(node) {
     try {
       await node.dial(this.config.p2p.bootstrapNodes[0]);
       this.logger.info('Nodo bootstrap raggiungibile');
     } catch (error) {
       this.logger.error('Errore nella connessione al nodo bootstrap:', error.message);
     }
   }
   ```

2. **Aggiornare il `node-runner`**:
   - Configurare correttamente i nodi normali per connettersi ai nodi bootstrap.
   ```javascript
   if (options.bootstrapNodes) {
     config.config.p2p.bootstrapNodes = options.bootstrapNodes;
   }
   ```

3. **Aggiungere log dettagliati per il debug**:
   - Loggare ogni passaggio durante l'avvio del nodo.

---

## **Fase 5: Test e debug**
### Problema
- Mancano test per verificare che le modifiche funzionino correttamente.

### Task
1. **Scrivere test per il salvataggio e il caricamento del `PeerId`**:
   - Verificare che il `PeerId` venga salvato e caricato correttamente.

2. **Scrivere test per la connessione tra nodi**:
   - Verificare che i nodi normali possano connettersi ai nodi bootstrap.

3. **Scrivere test per la propagazione dei messaggi**:
   - Verificare che i messaggi vengano propagati correttamente tra i peer.

---

## **Fase 6: Ottimizzazione e pulizia**
### Problema
- Il codice contiene parti ridondanti o non utilizzate.

### Task
1. **Rimuovere codice non utilizzato**:
   - Eliminare funzioni e metodi non utilizzati nel `NetworkManager`, `GossipManager`, e `DHTManager`.

2. **Ottimizzare la gestione dei peer**:
   - Consolidare la gestione dei peer in un unico componente.

3. **Documentare il codice**:
   - Aggiungere commenti e documentazione per migliorare la leggibilità.

---

### **Conclusione**
Seguendo questa roadmap, è possibile risolvere i problemi principali relativi alla rete e migliorare la stabilità e la funzionalità del sistema. Ogni fase è progettata per affrontare un problema specifico, garantendo un approccio strutturato e progressivo.