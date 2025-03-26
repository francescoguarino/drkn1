#!/bin/bash

# Script per avviare una rete di nodi Drakon per test locale
# Uso: ./start-network.sh [opzioni]

# Imposta colori per output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per mostrare l'aiuto
function show_help {
    echo -e "${BLUE}Drakon Network - Script di avvio rete locale${NC}"
    echo ""
    echo "Uso: ./start-network.sh [opzioni]"
    echo ""
    echo "Opzioni:"
    echo "  -n, --nodes NUM      Numero di nodi da avviare (default: 3)"
    echo "  -p, --base-port NUM  Porta di base per il primo nodo (default: 6001)"
    echo "  -m, --mining         Abilita il mining su tutti i nodi"
    echo "  -h, --help           Mostra questo messaggio di aiuto"
    echo ""
    echo "Esempi:"
    echo "  ./start-network.sh --nodes 5"
    echo "  ./start-network.sh --nodes 3 --base-port 7000 --mining"
    echo ""
}

# Controlla dipendenze
if ! command -v node &> /dev/null; then
    echo -e "${RED}Errore: Node.js non è installato${NC}"
    echo "Per favore installa Node.js v16 o superiore"
    exit 1
fi

# Parametri di default
NUM_NODES=3
BASE_PORT=6001
MINING=false

# Funzione per terminare tutti i processi nodo
function cleanup {
    echo -e "${YELLOW}Arresto della rete in corso...${NC}"
    for PID in "${NODE_PIDS[@]}"; do
        if ps -p $PID > /dev/null; then
            kill $PID
            echo -e "${GREEN}Arrestato nodo con PID $PID${NC}"
        fi
    done
    echo -e "${GREEN}Rete arrestata con successo${NC}"
    exit 0
}

# Cattura CTRL+C
trap cleanup SIGINT SIGTERM

# Analizza parametri da riga di comando
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--nodes)
            NUM_NODES="$2"
            shift 2
            ;;
        -p|--base-port)
            BASE_PORT="$2"
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

# Banner
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                         DRAKON NETWORK LAUNCHER                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${YELLOW}Avvio rete con $NUM_NODES nodi...${NC}"
echo -e "${YELLOW}Porta base: $BASE_PORT${NC}"
echo -e "${YELLOW}Mining: $([ "$MINING" == true ] && echo "Abilitato" || echo "Disabilitato")${NC}"
echo ""

# Array per mantenere i PID dei nodi
declare -a NODE_PIDS

# Avvia il nodo bootstrap
echo -e "${GREEN}Avvio nodo bootstrap (nodo 0) sulla porta $BASE_PORT ${NC}"
BOOTSTRAP_CMD="node src/node-runner.js --port $BASE_PORT --bootstrap"
if [ "$MINING" = true ]; then
    BOOTSTRAP_CMD="$BOOTSTRAP_CMD --mining true"
fi

# Avvia il bootstrap in background e salva il PID
$BOOTSTRAP_CMD > logs/node0.log 2>&1 &
NODE_PIDS+=($!)
echo -e "${GREEN}Nodo bootstrap avviato con PID ${NODE_PIDS[0]}${NC}"

# Attendi che il bootstrap sia avviato
sleep 3

# Avvia gli altri nodi
for (( i=1; i<$NUM_NODES; i++ )); do
    PORT=$((BASE_PORT + i))
    echo -e "${GREEN}Avvio nodo $i sulla porta $PORT${NC}"
    
    NODE_CMD="node src/node-runner.js --port $PORT --bootstrap-node 127.0.0.1:$BASE_PORT"
    if [ "$MINING" = true ]; then
        NODE_CMD="$NODE_CMD --mining true"
    fi
    
    # Avvia il nodo in background e salva il PID
    $NODE_CMD > logs/node$i.log 2>&1 &
    NODE_PIDS+=($!)
    echo -e "${GREEN}Nodo $i avviato con PID ${NODE_PIDS[$i]}${NC}"
    
    # Attendi un po' tra l'avvio dei nodi
    sleep 1
done

echo ""
echo -e "${GREEN}Rete avviata con successo con $NUM_NODES nodi${NC}"
echo -e "${YELLOW}I log dei nodi sono disponibili nella directory 'logs/'${NC}"
echo -e "${YELLOW}Premi CTRL+C per arrestare tutti i nodi${NC}"
echo ""

# Visualizza informazioni sullo stato dei nodi ogni 10 secondi
while true; do
    echo -e "${BLUE}=== STATO DELLA RETE ===${NC}"
    for (( i=0; i<$NUM_NODES; i++ )); do
        PORT=$((BASE_PORT + i))
        API_PORT=$((PORT + 1000))
        PID=${NODE_PIDS[$i]}
        
        # Verifica se il processo è ancora in esecuzione
        if ps -p $PID > /dev/null; then
            STATUS="${GREEN}Running${NC}"
        else
            STATUS="${RED}Stopped${NC}"
        fi
        
        echo -e "Nodo $i (PID $PID): $STATUS - API: http://localhost:$API_PORT"
    done
    echo ""
    
    # Attendi 10 secondi
    sleep 10
done 