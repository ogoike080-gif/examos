const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/candidates
router.get('/', authenticate, authorize('superadmin','admin','proctor','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { search, class_name, page=1, limit=100 } = req.query;
    const offset = (page-1)*limit;
    let where = "role='candidate' AND is_active=TRUE";
    const params = [];
    if (search) {
      where += ' AND (full_name LIKE ? OR email LIKE ? OR reg_number LIKE ? OR staff_id LIKE ?)';
      params.push(`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`);
    }
    if (class_name) { where += ' AND class_name=?'; params.push(class_name); }
    const [candidates] = await db.execute(
      `SELECT id, email, full_name, reg_number, staff_id, class_name, last_login, created_at,
       (SELECT COUNT(*) FROM exam_sessions es WHERE es.candidate_id=users.id) as exam_count
       FROM users WHERE ${where} ORDER BY class_name ASC, full_name ASC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    res.json({ candidates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/candidates/classes
router.get('/classes', authenticate, authorize('superadmin','admin','proctor','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      "SELECT DISTINCT class_name FROM users WHERE role='candidate' AND is_active=TRUE AND class_name IS NOT NULL ORDER BY class_name"
    );
    res.json({ classes: rows.map(r => r.class_name) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/candidates/bulk
router.post('/bulk', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { candidates } = req.body;
    if (!Array.isArray(candidates) || !candidates.length)
      return res.status(400).json({ error: 'candidates array required' });

    const results = { success: 0, failed: 0, errors: [] };
    for (const c of candidates) {
      try {
        if (!c.full_name?.trim()) {
          results.failed++;
          results.errors.push({ name: c.full_name, error: 'Full name required' });
          continue;
        }
        const regNum = c.reg_number ? c.reg_number.toString().trim() : null;
        const staffId = c.staff_id ? c.staff_id.toString().trim() : null;

        if (regNum) {
          const [ex] = await db.execute('SELECT id FROM users WHERE reg_number=?', [regNum]);
          if (ex.length) {
            results.failed++;
            results.errors.push({ name: c.full_name, error: `Reg number ${regNum} already exists` });
            continue;
          }
        }
        if (staffId) {
          const [ex] = await db.execute('SELECT id FROM users WHERE staff_id=?', [staffId]);
          if (ex.length) {
            results.failed++;
            results.errors.push({ name: c.full_name, error: `Staff ID ${staffId} already exists` });
            continue;
          }
        }

        const email = c.email
          || (regNum ? `${regNum}@ogotech.internal` : null)
          || (staffId ? `${staffId.replace(/[^a-zA-Z0-9]/g,'')}@ogotech.internal` : null)
          || `${uuidv4().slice(0,8)}@ogotech.internal`;

        const password = regNum || staffId || 'Student@2026!';
        const hash = await bcrypt.hash(password, 10);

        await db.execute(
          "INSERT INTO users (id,email,password_hash,full_name,role,reg_number,staff_id,class_name) VALUES (?,?,?,?,'candidate',?,?,?)",
          [uuidv4(), email.toLowerCase(), hash, c.full_name.trim(), regNum||null, staffId||null, c.class_name||null]
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ name: c.full_name, error: err.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/candidates/import-csv
router.post('/import-csv', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { csv_text, class_name } = req.body;
    if (!csv_text) return res.status(400).json({ error: 'csv_text required' });

    const lines = csv_text.trim().split(/\r?\n/);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + data rows' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase());
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = cols[idx] || ''; });

      const full_name = (row.full_name || row.name || row.student_name || '').trim();
      const reg_number = (row.reg_number || row.reg || '').trim() || null;
      const staff_id = (row.staff_id || row.staffid || '').trim() || null;
      const cls = class_name || (row.class_name || row.class || '').trim() || null;

      if (!full_name) { results.failed++; results.errors.push({ row: i+1, error: 'Missing name' }); continue; }

      try {
        const email = reg_number
          ? `${reg_number}@ogotech.internal`
          : staff_id
          ? `${staff_id.replace(/[^a-zA-Z0-9]/g,'')}@ogotech.internal`
          : `${full_name.replace(/\s+/g,'.').toLowerCase()}.${Date.now()}@ogotech.internal`;

        const password = reg_number || staff_id || 'Student@2026!';
        const hash = await bcrypt.hash(password, 10);
        await db.execute(
          "INSERT INTO users (id,email,password_hash,full_name,role,reg_number,staff_id,class_name) VALUES (?,?,?,?,'candidate',?,?,?)",
          [uuidv4(), email, hash, full_name, reg_number||null, staff_id||null, cls]
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row: i+1, name: full_name, error: err.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/candidates/assign-class
router.post('/assign-class', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { class_name, exam_id } = req.body;
    if (!class_name || !exam_id) return res.status(400).json({ error: 'class_name and exam_id required' });
    const [candidates] = await db.execute(
      "SELECT id FROM users WHERE class_name=? AND role='candidate' AND is_active=TRUE", [class_name]
    );
    if (!candidates.length) return res.status(404).json({ error: `No candidates in class "${class_name}"` });
    let assigned = 0, skipped = 0;
    for (const c of candidates) {
      const [ex] = await db.execute('SELECT id FROM exam_sessions WHERE exam_id=? AND candidate_id=?', [exam_id, c.id]);
      if (ex.length) { skipped++; continue; }
      await db.execute("INSERT INTO exam_sessions (id,exam_id,candidate_id,status) VALUES (?,?,?,'waiting')", [uuidv4(), exam_id, c.id]);
      assigned++;
    }
    res.json({ success: true, assigned, skipped, total: candidates.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/candidates/:id/assign-exam
router.post('/:id/assign-exam', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { exam_id } = req.body;
    const [ex] = await db.execute('SELECT id FROM exam_sessions WHERE exam_id=? AND candidate_id=?', [exam_id, req.params.id]);
    if (ex.length) return res.status(409).json({ error: 'Already assigned' });
    await db.execute("INSERT INTO exam_sessions (id,exam_id,candidate_id,status) VALUES (?,?,?,'waiting')", [uuidv4(), exam_id, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/candidates/:id — update including staff_id
router.put('/:id', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { full_name, class_name, reg_number, staff_id } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: 'Full name required' });

    // Check staff_id uniqueness if changed
    if (staff_id) {
      const [ex] = await db.execute('SELECT id FROM users WHERE staff_id=? AND id!=?', [staff_id, req.params.id]);
      if (ex.length) return res.status(409).json({ error: `Staff ID "${staff_id}" already used` });
    }

    await db.execute(
      'UPDATE users SET full_name=?, class_name=?, reg_number=?, staff_id=? WHERE id=?',
      [full_name.trim(), class_name||null, reg_number||null, staff_id||null, req.params.id]
    );
    res.json({ message: 'Candidate updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/candidates/:id
router.delete('/:id', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    await db.execute("UPDATE users SET is_active=FALSE WHERE id=? AND role='candidate'", [req.params.id]);
    res.json({ message: 'Candidate removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/candidates/:id/exam/:examId
router.delete('/:id/exam/:examId', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    await db.execute("DELETE FROM exam_sessions WHERE candidate_id=? AND exam_id=? AND status='waiting'", [req.params.id, req.params.examId]);
    res.json({ message: 'Removed from exam' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/candidates/:id/parents — list parents linked to this candidate
router.get('/:id/parents', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [parents] = await db.execute(
      `SELECT u.id, u.email, u.full_name, u.created_at as linked_note, pl.created_at as linked_at
       FROM parent_links pl JOIN users u ON pl.parent_id = u.id
       WHERE pl.candidate_id = ?`,
      [req.params.id]
    );
    res.json({ parents });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/candidates/:id/link-parent — link an existing parent account, or create one, to this candidate
router.post('/:id/link-parent', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const { parent_email, parent_full_name, parent_password } = req.body;
    if (!parent_email) return res.status(400).json({ error: 'parent_email is required' });

    const [candidateRows] = await db.execute("SELECT id, full_name FROM users WHERE id=? AND role='candidate'", [req.params.id]);
    if (!candidateRows[0]) return res.status(404).json({ error: 'Candidate not found' });

    let [parentRows] = await db.execute("SELECT id, role FROM users WHERE email=?", [parent_email.toLowerCase().trim()]);
    let parentId;

    if (parentRows[0]) {
      if (parentRows[0].role !== 'parent') {
        return res.status(400).json({ error: 'That email belongs to an existing non-parent account' });
      }
      parentId = parentRows[0].id;
    } else {
      if (!parent_password || parent_password.length < 6) {
        return res.status(400).json({ error: 'No account exists for that email yet — provide parent_full_name and a parent_password (min 6 chars) to create one' });
      }
      const hash = await bcrypt.hash(parent_password, 12);
      parentId = uuidv4();
      await db.execute(
        "INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, 'parent')",
        [parentId, parent_email.toLowerCase().trim(), hash, parent_full_name || 'Parent/Guardian']
      );
    }

    await db.execute(
      "INSERT IGNORE INTO parent_links (id, parent_id, candidate_id) VALUES (?, ?, ?)",
      [uuidv4(), parentId, req.params.id]
    );

    res.json({ message: `Linked to ${candidateRows[0].full_name}`, parent_id: parentId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/candidates/:id/parents/:parentId — unlink a parent from this candidate
router.delete('/:id/parents/:parentId', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    await db.execute("DELETE FROM parent_links WHERE candidate_id=? AND parent_id=?", [req.params.id, req.params.parentId]);
    res.json({ message: 'Unlinked' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
