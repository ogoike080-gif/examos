const express = require('express');
const { authenticate } = require('../middleware/auth');
const { chatWithStudyAssistant } = require('../ai/questionGenerator');

const router = express.Router();

// POST /api/ai/chat  ← Student AI Study Assistant
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const reply = await chatWithStudyAssistant({
      history: Array.isArray(history) ? history : [],
      message: message.trim(),
    });

    res.json({ reply });
  } catch (err) {
    console.error('AI chat error:', err.message);
    res.status(500).json({ error: "I'm having trouble connecting. Please try again in a moment." });
  }
});

module.exports = router;
