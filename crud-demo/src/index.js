require('dotenv').config();

const express = require('express');
const { pool } = require('./db');
const usersRouter = require('./routes/users');
const productsRouter = require('./routes/products');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

app.use('/api/users', usersRouter);
app.use('/api/products', productsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
