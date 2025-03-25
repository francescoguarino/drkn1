#!/bin/bash

# Colori per l'output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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
    sudo useradd -r -s /bin/false drakon
    echo -e "${GREEN}Utente drakon creato${NC}"
fi

# Crea la directory di installazione
echo -e "\n${YELLOW}Creazione directory...${NC}"
sudo mkdir -p /opt/drakon-node
sudo chown -R drakon:drakon /opt/drakon-node

# Copia i file
echo -e "\n${YELLOW}Copia dei file...${NC}"
sudo cp -r . /opt/drakon-node/
sudo chown -R drakon:drakon /opt/drakon-node

# Installa le dipendenze
echo -e "\n${YELLOW}Installazione dipendenze...${NC}"
cd /opt/drakon-node
sudo -u drakon npm install --production

# Configura il servizio systemd
echo -e "\n${YELLOW}Configurazione servizio...${NC}"
sudo cp deployment/drakon-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable drakon-node

# Crea il file di configurazione
echo -e "\n${YELLOW}Creazione configurazione...${NC}"
if [ ! -f /opt/drakon-node/.env ]; then
    sudo -u drakon cp .env.example /opt/drakon-node/.env
    echo -e "${GREEN}File .env creato. Modificalo secondo le tue necessità.${NC}"
fi

echo -e "\n${GREEN}Installazione completata!${NC}"
echo -e "\nPer avviare il nodo:"
echo -e "${YELLOW}sudo systemctl start drakon-node${NC}"
echo -e "\nPer verificare lo stato:"
echo -e "${YELLOW}sudo systemctl status drakon-node${NC}"
echo -e "\nPer visualizzare i log:"
echo -e "${YELLOW}sudo journalctl -u drakon-node -f${NC}" 