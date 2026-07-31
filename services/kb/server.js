const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.KB_PORT || 3000;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'threadsflow',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Settings
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const obj = {};
    rows.forEach(r => { obj[r.key] = r.value; });
    res.json(obj);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, JSON.stringify(value)]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Products API
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.uid, p.name, p.brand, p.price, p.commission_rate, p.shopee_url, p.affiliate_url,
              p.media_urls, p.media_kinds, p.status, p.created_at, p.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', pi.id,
                    'public_url', pi.public_url,
                    'media_kind', pi.media_kind,
                    'sort_order', pi.sort_order
                  ) ORDER BY pi.sort_order
                ) FILTER (WHERE pi.id IS NOT NULL),
                '[]'
              ) AS media
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const { rows } = await pool.query(
      `SELECT p.uid, p.name, p.brand, p.price, p.commission_rate, p.shopee_url, p.affiliate_url,
              p.media_urls, p.media_kinds, p.status, p.created_at, p.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', pi.id,
                    'public_url', pi.public_url,
                    'media_kind', pi.media_kind,
                    'sort_order', pi.sort_order
                  ) ORDER BY pi.sort_order
                ) FILTER (WHERE pi.id IS NOT NULL),
                '[]'
              ) AS media
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id
       WHERE p.uid = $1
       GROUP BY p.id`,
      [uid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls, media_kinds, status } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO products (name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls, media_kinds, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING uid, name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls, media_kinds, status, created_at, updated_at`,
      [name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls || [], media_kinds || [], status || 'active']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/products/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const { name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls, media_kinds, status, media } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update product basic info
      const updateResult = await client.query(`
        UPDATE products
        SET name = $1, brand = $2, price = $3, commission_rate = $4, shopee_url = $5, affiliate_url = $6,
            media_urls = $7, media_kinds = $8, status = $9, updated_at = NOW()
        WHERE uid = $10
        RETURNING *
      `, [name, brand, price, commission_rate, shopee_url, affiliate_url, media_urls || [], media_kinds || [], status || 'active', uid]);
      
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Product not found' });
      }
      
      // Update media if provided (new media table)
      if (media !== undefined && Array.isArray(media)) {
        // Delete existing media
        await client.query('DELETE FROM product_images WHERE product_id = $1', [updateResult.rows[0].id]);
        
        // Insert new media
        for (let i = 0; i < media.length; i++) {
          const m = media[i];
          if (m.url && m.media_kind && ['image', 'video'].includes(m.media_kind)) {
            await client.query(`
              INSERT INTO product_images (product_id, public_url, media_kind, sort_order)
              VALUES ($1, $2, $3, $4)
            `, [updateResult.rows[0].id, m.url, m.media_kind, m.sort_order ?? i]);
          }
        }
      }
      
      await client.query('COMMIT');
      
      // Fetch updated product with media
      const { rows } = await pool.query(
        `SELECT p.uid, p.name, p.brand, p.price, p.commission_rate, p.shopee_url, p.affiliate_url,
                p.media_urls, p.media_kinds, p.status, p.created_at, p.updated_at,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', pi.id,
                      'public_url', pi.public_url,
                      'media_kind', pi.media_kind,
                      'sort_order', pi.sort_order
                    ) ORDER BY pi.sort_order
                  ) FILTER (WHERE pi.id IS NOT NULL),
                  '[]'
                ) AS media
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id
         WHERE p.uid = $1
         GROUP BY p.id`,
        [uid]
      );
      
      res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/products/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const { rowCount } = await pool.query('DELETE FROM products WHERE uid = $1', [uid]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Review Queue API
app.get('/api/review', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT id, uid, text, media_urls, media_kinds, product_uids, status, topic_context,
             created_at, scheduled_at, published_at, review_note
      FROM posts
      WHERE status = 'pending_review'
    `;
    const params = [];
    if (status) {
      query += ' AND status = $1';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/review/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, media_urls, media_kinds, product_uids, status, topic_context, review_note } = req.body;
    const { rows } = await pool.query(
      `UPDATE posts
       SET text = COALESCE($1, text),
           media_urls = COALESCE($2, media_urls),
           media_kinds = COALESCE($3, media_kinds),
           product_uids = COALESCE($4, product_uids),
           status = COALESCE($5, status),
           topic_context = COALESCE($6, topic_context),
           review_note = COALESCE($7, review_note),
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, uid, text, media_urls, media_kinds, product_uids, status, topic_context,
                 created_at, scheduled_at, published_at, review_note`,
      [text, media_urls, media_kinds, product_uids, status, topic_context, review_note, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Topic action endpoint (accept AI suggestion or clear topic)
app.post('/api/review/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, topic_action, topic, edited_body, reason_code } = req.body;
    
    if (action === 'topic') {
      // Get current post to access existing topic_context
      const { rows: current } = await pool.query('SELECT topic_context FROM posts WHERE id = $1', [id]);
      if (current.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }
      
      let newTopicContext = current[0].topic_context || {};
      
      if (topic_action === 'accept') {
        // Keep the existing AI suggestion or use the provided topic
        if (topic && topic !== 'accept_suggestion') {
          newTopicContext = { topic, topic_id: null, is_exploration: false };
        }
        // If topic is 'accept_suggestion', keep the existing topic_context as-is
      } else if (topic_action === 'clear') {
        newTopicContext = { topic: null, topic_id: null, is_exploration: false };
      }
      
      const { rows } = await pool.query(
        `UPDATE posts SET topic_context = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(newTopicContext), id]
      );
      return res.json(rows[0]);
    }
    
    // Handle approve/edit/reject from review.html
    if (action === 'approve') {
      const { rows } = await pool.query(
        `UPDATE posts SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      return res.json(rows[0]);
    }
    
    if (action === 'edit') {
      const { rows } = await pool.query(
        `UPDATE posts SET text = $1, status = 'approved', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [edited_body, id]
      );
      return res.json(rows[0]);
    }
    
    if (action === 'reject') {
      const { rows } = await pool.query(
        `UPDATE posts SET status = 'rejected', review_note = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [reason_code || 'Rejected in review', id]
      );
      return res.json(rows[0]);
    }
    
    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/review/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE posts SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/review/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { review_note } = req.body;
    const { rows } = await pool.query(
      `UPDATE posts SET status = 'rejected', review_note = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [review_note || 'Rejected in review', id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Queue API
app.get('/api/queue', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, uid, text, media_urls, media_kinds, product_uids, status, topic_context,
              created_at, scheduled_at
       FROM posts
       WHERE status IN ('draft', 'scheduled', 'approved')
       ORDER BY scheduled_at ASC NULLS LAST, created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Techniques API
app.get('/api/techniques', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM techniques ORDER BY category, name');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Levers API
app.get('/api/levers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM levers ORDER BY name');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Persona Topics API
app.get('/api/persona-topics', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pt.*, pts.slug as source_slug, pts.label as source_label
      FROM persona_topics pt
      JOIN persona_topic_sources pts ON pt.source_id = pts.id
      ORDER BY pts.slug, pt.topic
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`KB server listening on http://localhost:${PORT}`);
});