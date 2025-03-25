#!/bin/bash

# Colori per l'output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}Inizializzazione installazione nodo Drakon...${NC}"

# Verifica se l'utente è root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Questo script deve essere eseguito come root${NC}"
    exit 1
fi

# Crea utente drakon se non esiste
if ! id "drakon" &>/dev/null; then
    useradd -r -m -s /bin/bash drakon
    echo -e "${GREEN}Utente drakon creato${NC}"
fi

# Installa Node.js e npm se non presenti
if ! command -v node &> /dev/null; then
    echo -e "${GREEN}Installazione Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Crea directory dell'applicazione
mkdir -p /opt/drakon
cd /opt/drakon

# Copia i file necessari
cp -r ../drakonNode.js ../chain.js ../wallet.js ../routing.js ../network.js ../config.js ../package.json ./

# Imposta i permessi
chown -R drakon:drakon /opt/drakon
chmod 755 /opt/drakon

# Installa le dipendenze
su - drakon -c "cd /opt/drakon && npm install"

# Copia il file di servizio systemd
cp ../drakon-node.service /etc/systemd/system/

# Ricarica systemd e abilita il servizio
systemctl daemon-reload
systemctl enable drakon-node
systemctl start drakon-node

# Configura il firewall (assumendo ufw)
if command -v ufw &> /dev/null; then
    ufw allow 6000/tcp
    ufw allow 6000/udp
    ufw allow 7000/tcp
    echo -e "${GREEN}Porte firewall configurate${NC}"
fi

# Crea directory per i log
mkdir -p /var/log/drakon
chown drakon:drakon /var/log/drakon

# Configura logrotate
cat > /etc/logrotate.d/drakon << EOF
/var/log/drakon/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 drakon drakon
}
EOF

echo -e "${GREEN}Installazione completata!${NC}"
echo -e "Puoi controllare lo stato del servizio con: systemctl status drakon-node"
echo -e "I log sono disponibili con: journalctl -u drakon-node -f" 