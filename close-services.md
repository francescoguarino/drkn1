# Come Chiudere le Porte Aperte o Servizi di Drakon

Questa guida descrive come identificare e chiudere le porte aperte o terminare i servizi di Drakon.

---

## 1. **Identificare le Porte Aperte**

### Comando per trovare le porte aperte:
- **Windows**:
  ```bash
  netstat -ano | findstr :<PORTA>
  ```
  Sostituisci `<PORTA>` con la porta che vuoi verificare (es. `6001` per P2P o `7001` per API).

- **Linux/macOS**:
  ```bash
  lsof -i :<PORTA>
  ```

---

## 2. **Terminare i Processi che Usano le Porte**

### Comando per terminare i processi:
- **Windows**:
  1. Identifica il PID del processo con il comando `netstat`.
  2. Termina il processo:
     ```bash
     taskkill /PID <PID> /F
     ```

- **Linux/macOS**:
  1. Identifica il PID del processo con il comando `lsof`.
  2. Termina il processo:
     ```bash
     kill -9 <PID>
     ```

---

## 3. **Chiudere i Servizi di Drakon**

### Metodo 1: Terminare manualmente i processi Node.js
1. Trova i processi Node.js in esecuzione:
   - **Windows**:
     ```bash
     tasklist | findstr node
     ```
   - **Linux/macOS**:
     ```bash
     ps aux | grep node
     ```
2. Termina i processi Node.js:
   - **Windows**:
     ```bash
     taskkill /IM node.exe /F
     ```
   - **Linux/macOS**:
     ```bash
     killall node
     ```

### Metodo 2: Usare script per chiudere i servizi
Se hai uno script per avviare i nodi, puoi modificarlo per includere un comando di chiusura. Ad esempio:
```bash
pkill -f "node test-local-network.js"
```

---

## 4. **Disabilitare le Porte in Configurazione**

### Modifica delle porte in `test-local-network.js`:
```javascript
const apiPorts = [8001, 8002, 8003]; // Cambia le porte API
const p2pPorts = [9001, 9002, 9003]; // Cambia le porte P2P
```

### Modifica delle porte in `src/config/index.js`:
```javascript
// filepath: c:\Users\franc\Desktop\drkn1\src\config\index.js
// ...existing code...
network: {
  p2pPort: 6001, // Cambia la porta P2P
  defaultHTTPPort: 7001, // Cambia la porta API
  // ...existing code...
},
// ...existing code...
```

---

## 5. **Verifica delle Porte Chiuse**

### Comando per verificare:
- **Windows**:
  ```bash
  netstat -ano | findstr :<PORTA>
  ```
- **Linux/macOS**:
  ```bash
  lsof -i :<PORTA>
  ```

Se il comando non restituisce risultati, la porta è chiusa.

---

## 6. **Note Importanti**
- Assicurati di avere i permessi di amministratore per terminare i processi o modificare le configurazioni.
- Se utilizzi un firewall, verifica che le regole siano configurate correttamente per bloccare le porte non necessarie.