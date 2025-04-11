export const bootstrapConfig = {
  network: {
    type: 'bootstrap',
    maxPeers: 1000,          // Numero massimo di peer gestibili
    connectionTimeout: 5000,  // Timeout per le connessioni in ms
    keepAliveInterval: 30000 // Intervallo per il keep-alive in ms
  },
  p2p: {
    port: process.env.BOOTSTRAP_PORT || 6001,
    host: '0.0.0.0',
    protocols: [
      '/drakon/peer-discovery/1.0.0',
      '/drakon/node-info/1.0.0'
    ]
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'bootstrap-node.log'
  },
  security: {
    maxConnectionsPerIP: 50,    // Limite connessioni per IP
    connectionRateLimit: {      // Rate limiting per prevenire abusi
      windowMs: 60000,          // 1 minuto
      maxRequests: 100          // Massimo 100 richieste al minuto
    }
  }
}; 