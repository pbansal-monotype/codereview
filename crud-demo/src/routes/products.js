const express = require('express');
const { query } = require('../db');

const router = express.Router();

function validateProductBody(body, partial = false) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      errors.push('name must be at least 2 characters');
    }
  }
  if (!partial || body.price_cents !== undefined) {
    if (!Number.isInteger(body.price_cents) || body.price_cents < 0) {
      errors.push('price_cents must be a non-negative integer');
    }
  }
  if (body.stock !== undefined && (!Number.isInteger(body.stock) || body.stock < 0)) {
    errors.push('stock must be a non-negative integer');
  }
  if (!partial || body.owner_id !== undefined) {
    if (!Number.isInteger(body.owner_id) || body.owner_id <= 0) {
      errors.push('owner_id must be a positive integer');
    }
  }
  return errors;
}

router.get('/', async (req, res, next) => {
  try {
    const ownerId = req.query.owner_id ? Number(req.query.owner_id) : null;
    let sql =
      'SELECT id, name, description, price_cents, stock, owner_id, created_at, updated_at FROM products';
    const params = [];

    if (ownerId) {
      if (!Number.isInteger(ownerId)) {
        return res.status(400).json({ error: 'owner_id must be an integer' });
      }
      sql += ' WHERE owner_id = $1';
      params.push(ownerId);
    }

    sql += ' ORDER BY id ASC';
    const { rows } = await query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id must be an integer' });
    }

    const { rows } = await query(
      `SELECT id, name, description, price_cents, stock, owner_id, created_at, updated_at
       FROM products WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'product not found' });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const errors = validateProductBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const { name, description = null, price_cents, stock = 0, owner_id } = req.body;

    const ownerCheck = await query('SELECT id FROM users WHERE id = $1', [owner_id]);
    if (ownerCheck.rows.length === 0) {
      return res.status(400).json({ error: 'owner_id does not exist' });
    }

    const { rows } = await query(
      `INSERT INTO products (name, description, price_cents, stock, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, price_cents, stock, owner_id, created_at, updated_at`,
      [name.trim(), description, price_cents, stock, owner_id],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id must be an integer' });
    }

    const errors = validateProductBody(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    if (req.body.owner_id !== undefined) {
      const ownerCheck = await query('SELECT id FROM users WHERE id = $1', [req.body.owner_id]);
      if (ownerCheck.rows.length === 0) {
        return res.status(400).json({ error: 'owner_id does not exist' });
      }
    }

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, column] of [
      ['name', 'name'],
      ['description', 'description'],
      ['price_cents', 'price_cents'],
      ['stock', 'stock'],
      ['owner_id', 'owner_id'],
    ]) {
      if (req.body[key] !== undefined) {
        fields.push(`${column} = $${idx++}`);
        values.push(key === 'name' ? req.body[key].trim() : req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, description, price_cents, stock, owner_id, created_at, updated_at`,
      values,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'product not found' });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id must be an integer' });
    }

    const { rowCount } = await query('DELETE FROM products WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'product not found' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
