const express = require('express');
const router = express.Router();

function setupRoutes(networkManager) {
  // Endpoint per test broadcast
  router.post('/broadcast', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Messaggio richiesto' });
      }

      const success = await networkManager.broadcastMessage(message);
      if (success) {
        res.json({
          status: 'success',
          message: 'Messaggio inviato con successo'
        });
      } else {
        res.status(500).json({ error: "Errore nell'invio del messaggio" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint per statistiche di rete
  router.get('/network/stats', async (req, res) => {
    try {
      const stats = networkManager.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint per lista peer connessi
  router.get('/network/peers', async (req, res) => {
    try {
      const peers = networkManager.getConnectedPeers();
      res.json({
        total: peers.length,
        peers: peers
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = setupRoutes;
