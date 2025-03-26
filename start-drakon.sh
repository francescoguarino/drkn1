#!/bin/bash

# Script per avviare facilmente un nodo Drakon
# Uso: ./start-drakon.sh [opzioni]

# Imposta colori per output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per mostrare l'aiuto
function show_help {
    echo -e "${BLUE}Drakon Node - Script di avvio${NC}"
    echo ""
    echo "Uso: ./start-drakon.sh [opzioni]"
    echo ""
    echo "Opzioni:"
    echo "  -p, --port NUM       Porta P2P (default: 6001)"
    echo "  -a, --api-port NUM   Porta API (default: porta P2P + 1000)"
    echo "  -d, --data-dir DIR   Directory dati (default: db/<node-id>)"
    echo "  -b, --bootstrap      Avvia come nodo bootstrap"
    echo "  -n, --node NODE      Aggiungi un nodo bootstrap (formato: host:porta)"
    echo "  -m, --mining         Abilita il mining"
    echo "  -h, --help           Mostra questo messaggio di aiuto"
    echo ""
    echo "Esempi:"
    echo "  ./start-drakon.sh --bootstrap --port 6001"
    echo "  ./start-drakon.sh --node 127.0.0.1:6001"
    echo ""
}

# Controlla dipendenze
if ! command -v node &> /dev/null; then
    echo -e "${RED}Errore: Node.js non è installato${NC}"
    echo "Per favore installa Node.js v16 o superiore"
    exit 1
fi

# Parametri di default
PORT=6001
API_PORT=""
DATA_DIR=""
BOOTSTRAP=false
BOOTSTRAP_NODES=()
MINING=false

# Funzione per avviare il nodo
function start_node {
    echo -e "${YELLOW}Avvio del nodo Drakon...${NC}"
    
    # Costruisci il comando
    CMD="node src/node-runner.js --port $PORT"
    
    if [ "$API_PORT" != "" ]; then
        CMD="$CMD --api-port $API_PORT"
    fi
    
    if [ "$DATA_DIR" != "" ]; then
        CMD="$CMD --data-dir $DATA_DIR"
    fi
    
    if [ "$BOOTSTRAP" = true ]; then
        CMD="$CMD --bootstrap"
    fi
    
    for NODE in "${BOOTSTRAP_NODES[@]}"; do
        CMD="$CMD --bootstrap-node $NODE"
    done
    
    if [ "$MINING" = true ]; then
        CMD="$CMD --mining true"
    fi
    
    echo -e "${BLUE}Esecuzione del comando: ${NC}$CMD"
    echo -e "${YELLOW}Premi CTRL+C per arrestare il nodo${NC}"
    echo ""
    
    # Esegui il comando
    eval $CMD
}

# Analizza parametri da riga di comando
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -a|--api-port)
            API_PORT="$2"
            shift 2
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -b|--bootstrap)
            BOOTSTRAP=true
            shift
            ;;
        -n|--node)
            BOOTSTRAP_NODES+=("$2")
            shift 2
            ;;
        -m|--mining)
            MINING=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Parametro non riconosciuto: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Verifica se il progetto è già installato
if [ ! -f "package.json" ]; then
    echo -e "${RED}Errore: package.json non trovato${NC}"
    echo "Assicurati di eseguire questo script dalla directory principale del progetto"
    exit 1
fi

# Verifica se le dipendenze sono installate
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Dipendenze non trovate, esecuzione di npm install...${NC}"
    npm install
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Errore durante l'installazione delle dipendenze${NC}"
        exit 1
    fi
fi

# Crea le directory necessarie
mkdir -p logs db data

# Avvia il nodo
start_node 