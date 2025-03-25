#!/bin/bash

# Colori per l'output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Verifica se l'utente è root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Questo script deve essere eseguito come root${NC}"
    exit 1
fi

echo -e "${GREEN}=== Drakon Node Installer ===${NC}"

# Verifica i prerequisiti
echo -e "\n${YELLOW}Verifico i prerequisiti...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js non trovato. Installalo prima di continuare.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm non trovato. Installalo prima di continuare.${NC}"
    exit 1
fi

# Verifica la versione di Node.js
NODE_VERSION=$(node -v | cut -d 'v' -f 2)
if [ $(echo "$NODE_VERSION 18.0.0" | awk '{print ($1 < $2)}') -eq 1 ]; then
    echo -e "${RED}È richiesto Node.js >= 18.0.0${NC}"
    exit 1
fi

# Crea l'utente drakon se non esiste
echo -e "\n${YELLOW}Configurazione utente...${NC}"
if ! id "drakon" &>/dev/null; then
    useradd -r -m -s /bin/bash drakon
    echo -e "${GREEN}Utente drakon creato${NC}"
fi

# Crea la directory di installazione
echo -e "\n${YELLOW}Creazione directory...${NC}"
mkdir -p /opt/drakon-node
chown -R drakon:drakon /opt/drakon-node

# Copia i file
echo -e "\n${YELLOW}Copia dei file...${NC}"
cp -r . /opt/drakon-node/
chown -R drakon:drakon /opt/drakon-node

# Crea il file .env se non esiste
echo -e "\n${YELLOW}Creazione file di configurazione...${NC}"
if [ ! -f /opt/drakon-node/.env ]; then
    cat > /opt/drakon-node/.env << EOF
# Ambiente
NODE_ENV=production

# Porte
API_PORT=3000
P2P_PORT=6001

# Network
MAX_PEERS=50
CHANNEL=drakon-mainnet

# Sicurezza
API_RATE_LIMIT=100
API_RATE_WINDOW=15m

# Logging
LOG_LEVEL=info
LOG_FILE=logs/node.log

# Database
DB_PATH=db/blockchain

# Bootstrap Nodes (separati da virgola)
BOOTSTRAP_NODES=node1.drakon.network:6001,node2.drakon.network:6001

# Wallet
WALLET_PATH=data/wallet.json
WALLET_PASSWORD=

# API Security
API_KEY=
API_SECRET=

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9100
EOF
    chown drakon:drakon /opt/drakon-node/.env
    chmod 600 /opt/drakon-node/.env
    echo -e "${GREEN}File .env creato${NC}"
fi

# Crea le directory necessarie
echo -e "\n${YELLOW}Creazione directory di supporto...${NC}"
mkdir -p /opt/drakon-node/logs
mkdir -p /opt/drakon-node/data
mkdir -p /opt/drakon-node/db
chown -R drakon:drakon /opt/drakon-node/logs
chown -R drakon:drakon /opt/drakon-node/data
chown -R drakon:drakon /opt/drakon-node/db

# Installa le dipendenze
echo -e "\n${YELLOW}Installazione dipendenze...${NC}"
cd /opt/drakon-node
su - drakon -c "cd /opt/drakon-node && npm install --omit=dev"

# Configura il servizio systemd
echo -e "\n${YELLOW}Configurazione servizio...${NC}"
cat > /etc/systemd/system/drakon-node.service << EOF
[Unit]
Description=Drakon Blockchain Node
After=network.target

[Service]
Type=simple
User=drakon
Group=drakon
WorkingDirectory=/opt/drakon-node
Environment=NODE_ENV=production
Environment=HOME=/home/drakon
ExecStart=/usr/bin/npm run start:prod
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=drakon-node

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable drakon-node

echo -e "\n${GREEN}Installazione completata!${NC}"
echo -e "\nPer avviare il nodo:"
echo -e "${YELLOW}sudo systemctl start drakon-node${NC}"
echo -e "\nPer verificare lo stato:"
echo -e "${YELLOW}sudo systemctl status drakon-node${NC}"
echo -e "\nPer visualizzare i log:"
echo -e "${YELLOW}sudo journalctl -u drakon-node -f${NC}" 