const express = require('express');
const { query } = require('../db');

const router = express.Router();

function validateUserBody(body, partial = false) {
  const errors = [];
  if (!partial || body.email !== undefined) {
    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      errors.push('email must be a valid string');
    }
  }
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      errors.push('name must be at least 2 characters');
    }
  }
  if (body.role !== undefined && !['user', 'admin'].includes(body.role)) {
    errors.push('role must be user or admin');
  }
  return errors;
}

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY id ASC',
    );
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
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const errors = validateUserBody(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const { email, name, role = 'user' } = req.body;
    const { rows } = await query(
      `INSERT INTO users (email, name, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role, created_at, updated_at`,
      [email.trim().toLowerCase(), name.trim(), role],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email already exists' });
    }
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id must be an integer' });
    }

    const errors = validateUserBody(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (req.body.email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(req.body.email.trim().toLowerCase());
    }
    if (req.body.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(req.body.name.trim());
    }
    if (req.body.role !== undefined) {
      fields.push(`role = $${idx++}`);
      values.push(req.body.role);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, email, name, role, created_at, updated_at`,
      values,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email already exists' });
    }
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id must be an integer' });
    }

    const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'user not found' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
