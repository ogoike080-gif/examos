const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const archiver = require('archiver');

const router = express.Router();

// GET /api/results/classes — list all classes that have submitted results
router.get('/classes', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(`
      SELECT
        u.class_name,
        COUNT(DISTINCT u.id) as student_count,
        COUNT(es.id) as total_sessions,
        SUM(CASE WHEN es.status='submitted' THEN 1 ELSE 0 END) as submitted_count,
        AVG(CASE WHEN es.status='submitted' THEN es.percentage ELSE NULL END) as avg_percentage,
        MAX(es.submitted_at) as last_submitted
      FROM users u
      LEFT JOIN exam_sessions es ON es.candidate_id = u.id
      WHERE u.role='candidate' AND u.is_active=TRUE AND u.class_name IS NOT NULL
      GROUP BY u.class_name
      ORDER BY u.class_name ASC
    `);
    res.json({ classes: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/results/class/:className — all results for a class
router.get('/class/:className', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { exam_id } = req.query;
    const className = decodeURIComponent(req.params.className);

    let where = 'u.class_name = ? AND u.role = ? AND u.is_active = TRUE';
    const params = [className, 'candidate'];
    if (exam_id) { where += ' AND es.exam_id = ?'; params.push(exam_id); }

    const [results] = await db.execute(`
      SELECT
        u.id as candidate_id,
        u.full_name,
        u.reg_number,
        u.staff_id,
        u.class_name,
        e.title as exam_title,
        e.total_marks as exam_total,
        e.pass_marks,
        s.name as subject_name,
        es.id as session_id,
        es.status as session_status,
        es.score,
        es.percentage,
        es.submitted_at,
        es.started_at
      FROM users u
      LEFT JOIN exam_sessions es ON es.candidate_id = u.id
      LEFT JOIN exams e ON es.exam_id = e.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      WHERE ${where}
      ORDER BY u.full_name ASC, e.title ASC
    `, params);

    // Also get list of exams taken by this class
    const [exams] = await db.execute(`
      SELECT DISTINCT e.id, e.title, e.total_marks, e.pass_marks, s.name as subject_name
      FROM exam_sessions es
      JOIN users u ON es.candidate_id = u.id
      JOIN exams e ON es.exam_id = e.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      WHERE u.class_name = ? AND u.role = 'candidate'
      ORDER BY e.title ASC
    `, [className]);

    // Summary stats
    const submitted = results.filter(r => r.session_status === 'submitted');
    const passed = submitted.filter(r => parseFloat(r.percentage) >= (r.pass_marks / r.exam_total * 100));
    const avgScore = submitted.length
      ? (submitted.reduce((s, r) => s + parseFloat(r.percentage || 0), 0) / submitted.length).toFixed(1)
      : 0;

    res.json({
      class_name: className,
      results,
      exams,
      summary: {
        total_students: new Set(results.map(r => r.candidate_id)).size,
        total_sessions: results.length,
        submitted: submitted.length,
        passed: passed.length,
        failed: submitted.length - passed.length,
        avg_percentage: avgScore,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/results/class/:className/download — download CSV of results for a class
router.get('/class/:className/download', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const className = decodeURIComponent(req.params.className);
    const { exam_id } = req.query;

    let where = 'u.class_name = ? AND u.role = ? AND u.is_active = TRUE';
    const params = [className, 'candidate'];
    if (exam_id) { where += ' AND es.exam_id = ?'; params.push(exam_id); }

    const [results] = await db.execute(`
      SELECT
        u.full_name, u.reg_number, u.staff_id, u.class_name,
        e.title as exam_title, e.total_marks as exam_total, e.pass_marks,
        s.name as subject_name,
        es.status as session_status, es.score, es.percentage,
        es.submitted_at, es.started_at
      FROM users u
      LEFT JOIN exam_sessions es ON es.candidate_id = u.id
      LEFT JOIN exams e ON es.exam_id = e.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      WHERE ${where}
      ORDER BY u.full_name ASC
    `, params);

    // Build CSV
    const headers = [
      'Full Name', 'Reg Number', 'Staff ID', 'Class',
      'Exam', 'Subject', 'Score', 'Total Marks', 'Percentage',
      'Grade', 'Pass Mark', 'Result', 'Status', 'Submitted At'
    ];

    function getGrade(pct) {
      if (pct >= 90) return 'A1';
      if (pct >= 80) return 'B2';
      if (pct >= 75) return 'B3';
      if (pct >= 70) return 'C4';
      if (pct >= 65) return 'C5';
      if (pct >= 60) return 'C6';
      if (pct >= 55) return 'D7';
      if (pct >= 50) return 'E8';
      return 'F9';
    }

    const rows = results.map(r => {
      const pct = parseFloat(r.percentage || 0);
      const passThreshold = r.pass_marks && r.exam_total
        ? (r.pass_marks / r.exam_total) * 100
        : 50;
      const passed = pct >= passThreshold;
      const submittedAt = r.submitted_at
        ? new Date(r.submitted_at).toLocaleString('en-NG')
        : '—';
      return [
        r.full_name || '',
        r.reg_number || '',
        r.staff_id || '',
        r.class_name || '',
        r.exam_title || '',
        r.subject_name || '',
        r.score != null ? r.score : '',
        r.exam_total || '',
        pct.toFixed(2) + '%',
        r.session_status === 'submitted' ? getGrade(pct) : '',
        r.pass_marks || '',
        r.session_status === 'submitted' ? (passed ? 'PASSED' : 'FAILED') : '',
        r.session_status || 'not started',
        submittedAt,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
    const safeClass = className.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Results_${safeClass}_${new Date().toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/results/class/:className/download-zip — download all results as ZIP (CSV inside)
router.get('/class/:className/download-zip', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const className = decodeURIComponent(req.params.className);

    // Get all exams this class took
    const [exams] = await db.execute(`
      SELECT DISTINCT e.id, e.title, e.total_marks, e.pass_marks, s.name as subject_name
      FROM exam_sessions es
      JOIN users u ON es.candidate_id = u.id
      JOIN exams e ON es.exam_id = e.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      WHERE u.class_name = ? AND u.role = 'candidate'
      ORDER BY e.title ASC
    `, [className]);

    function getGrade(pct) {
      if (pct >= 90) return 'A1'; if (pct >= 80) return 'B2';
      if (pct >= 75) return 'B3'; if (pct >= 70) return 'C4';
      if (pct >= 65) return 'C5'; if (pct >= 60) return 'C6';
      if (pct >= 55) return 'D7'; if (pct >= 50) return 'E8';
      return 'F9';
    }

    const safeClass = className.replace(/[^a-zA-Z0-9]/g, '_');
    const zipFilename = `Results_${safeClass}_${new Date().toISOString().slice(0,10)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    // 1. Combined results CSV (all exams)
    const [allResults] = await db.execute(`
      SELECT u.full_name, u.reg_number, u.staff_id, u.class_name,
        e.title as exam_title, e.total_marks as exam_total, e.pass_marks,
        s.name as subject_name, es.status as session_status,
        es.score, es.percentage, es.submitted_at
      FROM users u
      LEFT JOIN exam_sessions es ON es.candidate_id = u.id
      LEFT JOIN exams e ON es.exam_id = e.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      WHERE u.class_name = ? AND u.role = 'candidate' AND u.is_active = TRUE
      ORDER BY u.full_name ASC, e.title ASC
    `, [className]);

    const headers = ['Full Name','Reg Number','Staff ID','Class','Exam','Subject','Score','Total Marks','Percentage','Grade','Pass Mark','Result','Status','Submitted At'];
    const allRows = allResults.map(r => {
      const pct = parseFloat(r.percentage || 0);
      const passThreshold = r.pass_marks && r.exam_total ? (r.pass_marks / r.exam_total) * 100 : 50;
      return [
        r.full_name||'', r.reg_number||'', r.staff_id||'', r.class_name||'',
        r.exam_title||'', r.subject_name||'',
        r.score != null ? r.score : '', r.exam_total||'',
        pct.toFixed(2)+'%',
        r.session_status === 'submitted' ? getGrade(pct) : '',
        r.pass_marks||'',
        r.session_status === 'submitted' ? (pct >= passThreshold ? 'PASSED' : 'FAILED') : '',
        r.session_status||'not started',
        r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-NG') : '—',
      ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
    });
    const allCSV = '\uFEFF' + [headers.map(h=>`"${h}"`).join(','), ...allRows].join('\r\n');
    archive.append(allCSV, { name: `${safeClass}_All_Results.csv` });

    // 2. Per-exam CSVs
    for (const exam of exams) {
      const [examResults] = await db.execute(`
        SELECT u.full_name, u.reg_number, u.staff_id,
          es.status, es.score, es.percentage, es.submitted_at,
          ? as exam_total, ? as pass_marks
        FROM users u
        LEFT JOIN exam_sessions es ON es.candidate_id = u.id AND es.exam_id = ?
        WHERE u.class_name = ? AND u.role = 'candidate' AND u.is_active = TRUE
        ORDER BY u.full_name ASC
      `, [exam.total_marks, exam.pass_marks, exam.id, className]);

      const examHeaders = ['Full Name','Reg Number','Staff ID','Score','Total Marks','Percentage','Grade','Pass Mark','Result','Status','Submitted At'];
      const examRows = examResults.map(r => {
        const pct = parseFloat(r.percentage || 0);
        const passThreshold = r.pass_marks && r.exam_total ? (r.pass_marks / r.exam_total) * 100 : 50;
        return [
          r.full_name||'', r.reg_number||'', r.staff_id||'',
          r.score != null ? r.score : '', r.exam_total||'',
          pct.toFixed(2)+'%',
          r.status === 'submitted' ? getGrade(pct) : '—',
          r.pass_marks||'',
          r.status === 'submitted' ? (pct >= passThreshold ? 'PASSED' : 'FAILED') : '—',
          r.status||'not started',
          r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-NG') : '—',
        ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
      });

      const safeExam = exam.title.replace(/[^a-zA-Z0-9]/g,'_').slice(0,40);
      const examCSV = '\uFEFF' + [examHeaders.map(h=>`"${h}"`).join(','), ...examRows].join('\r\n');
      archive.append(examCSV, { name: `${safeClass}_${safeExam}.csv` });
    }

    // 3. Summary CSV
    const summaryHeaders = ['Class','Total Students','Exams Taken','Avg Score','Generated'];
    const submitted = allResults.filter(r => r.session_status === 'submitted');
    const avgPct = submitted.length
      ? (submitted.reduce((s,r) => s + parseFloat(r.percentage||0), 0) / submitted.length).toFixed(1)
      : '0.0';
    const summaryRow = [className, new Set(allResults.map(r=>r.full_name)).size, exams.length, avgPct+'%', new Date().toLocaleString('en-NG')];
    const summaryCSV = '\uFEFF' + [summaryHeaders.map(h=>`"${h}"`).join(','), summaryRow.map(v=>`"${v}"`).join(',')].join('\r\n');
    archive.append(summaryCSV, { name: `${safeClass}_Summary.csv` });

    archive.finalize();
  } catch (err) {
    console.error('ZIP download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
