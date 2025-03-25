# 🔗 DRAKON NODE

Un nodo blockchain decentralizzato e scalabile per la rete Drakon.

![Drakon Node Banner](docs/banner.png)

## 🚀 Caratteristiche Principali

- ⚡ Network P2P completamente decentralizzato
- 🔒 Crittografia end-to-end
- 📊 Sistema di consenso distribuito
- 🌐 Discovery automatica dei nodi
- 📈 Monitoraggio in tempo reale
- 🛡️ Sicurezza integrata

## 📋 Prerequisiti

- Node.js >= 18.0.0
- NPM >= 8.0.0
- Porta TCP aperta per P2P (default: 6001)
- Porta TCP aperta per API (default: 3000)

## 🛠️ Installazione

1. Clona il repository:

```bash
git clone https://github.com/tuouser/drakon-node.git
cd drakon-node
```

2. Installa le dipendenze:

```bash
npm install
```

3. Crea il file di configurazione:

```bash
cp .env.example .env
```

4. Modifica il file `.env` secondo le tue necessità:

```env
NODE_ENV=production
API_PORT=3000
P2P_PORT=6001
MAX_PEERS=50
CHANNEL=drakon-mainnet
```

## 🚀 Avvio

### Ambiente di Sviluppo

```bash
npm run start:dev
```

### Ambiente di Produzione

```bash
npm run start:prod
```

### Monitoraggio

```bash
npm run monitor
```

## 📊 Dashboard

La dashboard è accessibile all'indirizzo `http://localhost:3000/dashboard` dopo l'avvio del nodo.

## 🔧 Configurazione

### Configurazione di Base

- `NODE_ENV`: Ambiente di esecuzione (development/production)
- `API_PORT`: Porta per l'API REST
- `P2P_PORT`: Porta per la comunicazione P2P
- `MAX_PEERS`: Numero massimo di peer connessi
- `CHANNEL`: Canale della rete (mainnet/testnet)

### Configurazione Avanzata

Modifica il file `src/config.js` per configurazioni più avanzate come:

- Timeout delle connessioni
- Intervalli di sincronizzazione
- Parametri di sicurezza
- Bootstrap nodes

## 🌐 Networking

Il nodo utilizza una rete P2P decentralizzata basata su DHT (Distributed Hash Table) per:

- Discovery automatica dei peer
- Comunicazione tra nodi
- Sincronizzazione della blockchain
- Propagazione delle transazioni

## 🔒 Sicurezza

- Crittografia end-to-end per tutte le comunicazioni
- Validazione delle transazioni
- Rate limiting integrato
- Protezione contro attacchi DDoS
- Firewall automatico

## 📝 API Documentation

La documentazione dell'API è disponibile all'indirizzo `http://localhost:3000/docs` dopo l'avvio del nodo.

## 🤝 Contributing

Le contribuzioni sono benvenute! Per favore leggi [CONTRIBUTING.md](CONTRIBUTING.md) per i dettagli su come contribuire al progetto.

## 📄 License

Questo progetto è sotto licenza MIT - vedi il file [LICENSE](LICENSE) per i dettagli.

## 📞 Support

- 📧 Email: support@drakon.network
- 💬 Discord: [Drakon Community](https://discord.gg/drakon)
- 📱 Telegram: [@DrakonNetwork](https://t.me/DrakonNetwork)

## ⚠️ Disclaimer

Questo software è in fase beta. Usalo a tuo rischio e pericolo.
