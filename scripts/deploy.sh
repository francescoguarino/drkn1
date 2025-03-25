#!/bin/bash

# Colori per l'output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Funzione per stampare messaggi
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Verifica che lo script sia eseguito come root
if [ "$EUID" -ne 0 ]; then
    error "Questo script deve essere eseguito come root"
    exit 1
fi

# Crea l'utente drakon se non esiste
if ! id "drakon" &>/dev/null; then
    log "Creazione utente drakon..."
    useradd -m -s /bin/bash drakon
fi

# Installa Node.js se non è presente
if ! command -v node &>/dev/null; then
    log "Installazione Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Crea la directory dell'applicazione
APP_DIR="/opt/drakon"
log "Creazione directory applicazione in $APP_DIR..."
mkdir -p $APP_DIR
cp -r ../* $APP_DIR/

# Imposta i permessi
log "Configurazione permessi..."
chown -R drakon:drakon $APP_DIR
chmod -R 755 $APP_DIR

# Installa le dipendenze
log "Installazione dipendenze..."
cd $APP_DIR
sudo -u drakon npm install

# Crea il file di servizio systemd
log "Creazione servizio systemd..."
cat > /etc/systemd/system/drakon-node.service << EOL
[Unit]
Description=Drakon Blockchain Node
After=network.target

[Service]
Type=simple
User=drakon
WorkingDirectory=/opt/drakon
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOL

# Configura il firewall
log "Configurazione firewall..."
if command -v ufw &>/dev/null; then
    ufw allow 6000/tcp
    ufw allow 6000/udp
    ufw allow 7000/tcp
fi

# Crea directory per i log
log "Configurazione logging..."
mkdir -p /var/log/drakon
chown drakon:drakon /var/log/drakon

# Configura logrotate
cat > /etc/logrotate.d/drakon << EOL
/var/log/drakon/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 drakon drakon
}
EOL

# Avvia il servizio
log "Avvio del servizio..."
systemctl daemon-reload
systemctl enable drakon-node
systemctl start drakon-node

log "Installazione completata!"
log "Puoi controllare lo stato del servizio con: systemctl status drakon-node"
log "Per vedere i log in tempo reale: journalctl -u drakon-node -f" 