const mysql = require('mysql2/promise');

let pool;

async function initDB() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'examos_db',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    acquireTimeout: 60000,
    timezone: '+00:00',
  });

  // Test connection
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();

  // Run schema
  await createSchema();
  return pool;
}

function getDB() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

async function createSchema() {
  const db = pool;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role ENUM('superadmin','admin','examiner','proctor','candidate') NOT NULL DEFAULT 'candidate',
      is_active BOOLEAN DEFAULT TRUE,
      last_login DATETIME,
      avatar_url VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS subjects (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(50) UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS questions (
      id VARCHAR(36) PRIMARY KEY,
      subject_id VARCHAR(36),
      question_text TEXT NOT NULL,
      question_type ENUM('mcq','multi_answer','essay','true_false','fill_blank','coding','drag_drop') DEFAULT 'mcq',
      options JSON,
      correct_answers JSON,
      explanation TEXT,
      difficulty ENUM('easy','medium','hard') DEFAULT 'medium',
      marks DECIMAL(5,2) DEFAULT 1,
      tags JSON,
      media_url VARCHAR(500),
      exam_types JSON,
      p_value DECIMAL(5,4),
      discrimination_index DECIMAL(5,4),
      times_used INT DEFAULT 0,
      created_by VARCHAR(36),
      version INT DEFAULT 1,
      is_active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS exams (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      subject_id VARCHAR(36),
      exam_type VARCHAR(100),
      duration_minutes INT NOT NULL DEFAULT 60,
      total_marks DECIMAL(8,2),
      pass_marks DECIMAL(8,2),
      instructions TEXT,
      settings JSON,
      question_config JSON,
      status ENUM('draft','scheduled','active','paused','completed','archived') DEFAULT 'draft',
      scheduled_at DATETIME,
      started_at DATETIME,
      ended_at DATETIME,
      created_by VARCHAR(36),
      center_id VARCHAR(36),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id VARCHAR(36) PRIMARY KEY,
      exam_id VARCHAR(36) NOT NULL,
      question_id VARCHAR(36) NOT NULL,
      display_order INT,
      marks_override DECIMAL(5,2),
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      UNIQUE KEY unique_exam_question (exam_id, question_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id VARCHAR(36) PRIMARY KEY,
      exam_id VARCHAR(36) NOT NULL,
      candidate_id VARCHAR(36) NOT NULL,
      status ENUM('waiting','active','paused','submitted','terminated','disqualified') DEFAULT 'waiting',
      answers JSON,
      score DECIMAL(8,2),
      percentage DECIMAL(5,2),
      started_at DATETIME,
      submitted_at DATETIME,
      time_remaining_seconds INT,
      question_order JSON,
      device_fingerprint JSON,
      ip_address VARCHAR(45),
      browser_info TEXT,
      auto_save_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS proctor_events (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL,
      candidate_id VARCHAR(36) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      severity ENUM('info','warning','critical') DEFAULT 'info',
      description TEXT,
      ai_confidence DECIMAL(5,4),
      screenshot_url VARCHAR(500),
      metadata JSON,
      reviewed BOOLEAN DEFAULT FALSE,
      reviewed_by VARCHAR(36),
      action_taken VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES exam_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS exam_centers (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100) DEFAULT 'Nigeria',
      capacity INT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      action VARCHAR(255) NOT NULL,
      resource_type VARCHAR(100),
      resource_id VARCHAR(36),
      ip_address VARCHAR(45),
      metadata JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default admin if not exists
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const [admins] = await db.execute("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (admins.length === 0) {
    const hash = await bcrypt.hash('Admin@2026!', 12);
    await db.execute(
      "INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, 'superadmin')",
      [uuidv4(), 'admin@examos.ng', hash, 'System Administrator']
    );
    console.log('✅ Default admin created: admin@examos.ng / Admin@2026!');
  }

  // Seed subjects
  const [subjects] = await db.execute('SELECT COUNT(*) as cnt FROM subjects');
  if (subjects[0].cnt === 0) {
    const subs = [
      ['Mathematics', 'MTH'],
      ['English Language', 'ENG'],
      ['Physics', 'PHY'],
      ['Chemistry', 'CHM'],
      ['Biology', 'BIO'],
      ['Economics', 'ECO'],
      ['Government', 'GOV'],
      ['Literature in English', 'LIT'],
      ['Geography', 'GEO'],
      ['Computer Studies', 'CMP'],
    ];
    for (const [name, code] of subs) {
      await db.execute(
        'INSERT INTO subjects (id, name, code) VALUES (?, ?, ?)',
        [uuidv4(), name, code]
      );
    }
    console.log('✅ Subjects seeded');
  }

  // Add staff_id column if upgrading from older version
  try {
    await db.execute('ALTER TABLE users ADD COLUMN staff_id VARCHAR(50) UNIQUE NULL');
    console.log('✅ staff_id column added');
  } catch (e) { /* already exists — safe to ignore */ }

  // Add reg_number column if upgrading from older version
  try {
    await db.execute('ALTER TABLE users ADD COLUMN reg_number VARCHAR(20) UNIQUE NULL');
    console.log('✅ reg_number column added');
  } catch (e) { /* already exists — safe to ignore */ }

  // Add class_name column if upgrading from older version
  try {
    await db.execute('ALTER TABLE users ADD COLUMN class_name VARCHAR(100) NULL');
    console.log('✅ class_name column added');
  } catch (e) { /* already exists — safe to ignore */ }

  // Add 'parent' role if upgrading from older version
  try {
    await db.execute(
      "ALTER TABLE users MODIFY COLUMN role ENUM('superadmin','admin','examiner','proctor','candidate','parent') NOT NULL DEFAULT 'candidate'"
    );
    console.log('✅ parent role enabled');
  } catch (e) { /* already up to date — safe to ignore */ }

  // Parent ↔ Candidate links (a parent can be linked to more than one child)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS parent_links (
      id VARCHAR(36) PRIMARY KEY,
      parent_id VARCHAR(36) NOT NULL,
      candidate_id VARCHAR(36) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_link (parent_id, candidate_id)
    )
  `);

  // Archived source photos — original question-paper pages, organized by exam body + year
  await db.execute(`
    CREATE TABLE IF NOT EXISTS source_papers (
      id VARCHAR(36) PRIMARY KEY,
      exam_body VARCHAR(20) NOT NULL,
      year VARCHAR(10) NOT NULL,
      subject_id VARCHAR(36) NULL,
      file_path VARCHAR(500) NOT NULL,
      original_filename VARCHAR(255) NULL,
      uploaded_by VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_body_year (exam_body, year)
    )
  `);

  // ── Import pipeline v2: staging tables + structured exam metadata ──────────
  // Additive only — nothing above this line is touched, nothing existing loses data.

  // Promote exam body / year / paper type / printed question number out of the
  // `tags` JSON grab-bag into real, filterable columns on the live question bank.
  // Nullable so existing rows (which have none of this) stay valid as-is.
  try {
    await db.execute(`ALTER TABLE questions ADD COLUMN exam_body VARCHAR(20) NULL`);
    console.log('✅ questions.exam_body column added');
  } catch (e) { /* already exists — safe to ignore */ }

  try {
    await db.execute(
      `ALTER TABLE questions ADD COLUMN paper_type ENUM('objective','theory','essay','practical','combined') NULL`
    );
    console.log('✅ questions.paper_type column added');
  } catch (e) { /* already exists — safe to ignore */ }

  try {
    await db.execute(`ALTER TABLE questions ADD COLUMN question_number INT NULL`);
    console.log('✅ questions.question_number column added');
  } catch (e) { /* already exists — safe to ignore */ }

  // Composite index for the Exam Body -> Year -> Subject -> Paper Type -> Question
  // Number lookup pattern (year still lives in `tags` for now — see Milestone 3
  // note in the routes layer — so this index covers the three new columns plus
  // subject_id, which together do most of the filtering work).
  try {
    await db.execute(
      `ALTER TABLE questions ADD INDEX idx_exam_structure (exam_body, subject_id, paper_type, question_number)`
    );
    console.log('✅ questions exam-structure index added');
  } catch (e) { /* already exists — safe to ignore */ }

  // One row per upload (single image, zip batch, CSV, or JSON import). Tracks
  // the whole run so a browser tab closing mid-review doesn't lose the work,
  // and so partial failures can be retried without redoing the whole batch.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id VARCHAR(36) PRIMARY KEY,
      exam_body VARCHAR(20) NOT NULL,
      year VARCHAR(10) NOT NULL,
      subject_id VARCHAR(36) NULL,
      paper_type ENUM('objective','theory','essay','practical','combined') DEFAULT 'objective',
      source_type ENUM('zip','image','csv','json') NOT NULL,
      original_filename VARCHAR(255) NULL,
      expected_count INT NULL,
      pages_total INT DEFAULT 0,
      pages_processed INT DEFAULT 0,
      pages_failed INT DEFAULT 0,
      extracted_count INT DEFAULT 0,
      verified_count INT DEFAULT 0,
      needs_review_count INT DEFAULT 0,
      duplicate_count INT DEFAULT 0,
      missing_count INT DEFAULT 0,
      answer_conflict_count INT DEFAULT 0,
      number_gaps JSON NULL,
      quality_score DECIMAL(5,2) NULL,
      status ENUM('processing','staging','review','published','cancelled') DEFAULT 'processing',
      created_by VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_batch_status (status),
      INDEX idx_batch_body_year (exam_body, year)
    )
  `);

  // Every question a batch produces lands here first, never directly in the
  // live `questions` table. Only rows explicitly published (via review) get
  // copied over — see `published_question_id` once that happens. This is the
  // gate that section 26 (database safety) requires and the old flow lacked.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS staged_questions (
      id VARCHAR(36) PRIMARY KEY,
      import_batch_id VARCHAR(36) NOT NULL,
      subject_id VARCHAR(36) NULL,
      exam_body VARCHAR(20) NOT NULL,
      year VARCHAR(10) NOT NULL,
      paper_type ENUM('objective','theory','essay','practical','combined') DEFAULT 'objective',
      question_number INT NULL,
      question_text TEXT NOT NULL,
      question_type ENUM('mcq','essay') DEFAULT 'mcq',
      options JSON,
      correct_answers JSON,
      explanation TEXT,
      difficulty ENUM('easy','medium','hard') DEFAULT 'medium',
      marks DECIMAL(5,2) DEFAULT 1,
      media_url VARCHAR(500) NULL,
      source_photo VARCHAR(255) NULL,
      source_paper_id VARCHAR(36) NULL,
      confidence_score DECIMAL(5,2) NULL,
      confidence_label ENUM('high','medium','low') NULL,
      review_status ENUM('verified','needs_review','answer_conflict','duplicate','missing','rejected') DEFAULT 'needs_review',
      review_notes TEXT NULL,
      answer_candidates JSON NULL,
      reviewed_by VARCHAR(36) NULL,
      reviewed_at DATETIME NULL,
      published_question_id VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (source_paper_id) REFERENCES source_papers(id) ON DELETE SET NULL,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (published_question_id) REFERENCES questions(id) ON DELETE SET NULL,
      INDEX idx_staged_batch (import_batch_id),
      INDEX idx_staged_status (review_status),
      INDEX idx_staged_number (import_batch_id, paper_type, question_number)
    )
  `);

  console.log('✅ Import pipeline v2 schema ready');

  // ── Milestone 5: per-page retry + missing-question completion ──────────────
  // One row per photo in a batch. Previously only aggregate counts existed on
  // import_batches (pages_processed/pages_failed) — a single failed page had
  // no individually addressable record, so the only way to "retry" it was
  // re-uploading the entire zip. This table makes each page retryable on its
  // own, and always links to the archived source photo regardless of whether
  // extraction succeeded, so retry never requires the original zip again.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS batch_pages (
      id VARCHAR(36) PRIMARY KEY,
      import_batch_id VARCHAR(36) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      source_paper_id VARCHAR(36) NULL,
      status ENUM('success','failed') NOT NULL,
      error_message TEXT NULL,
      questions_extracted INT DEFAULT 0,
      retry_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (source_paper_id) REFERENCES source_papers(id) ON DELETE SET NULL,
      INDEX idx_page_batch (import_batch_id),
      INDEX idx_page_status (import_batch_id, status)
    )
  `);
  console.log('✅ batch_pages table ready');

  // ── Milestone 6: answer conflict resolution + source traceability ─────────
  // Backfill for deployments where staged_questions already exists — new
  // installs get this column from the CREATE TABLE above, existing ones need
  // it added explicitly.
  try {
    await db.execute(`ALTER TABLE staged_questions ADD COLUMN answer_candidates JSON NULL`);
    console.log('✅ staged_questions.answer_candidates column added');
  } catch (e) { /* already exists — safe to ignore */ }

  console.log('✅ Database schema ready');

  // ═══════════════════════════════════════════════════════════════════════
  // Exam Preparation Learning System — Milestone A: syllabus data model
  // ═══════════════════════════════════════════════════════════════════════
  // A separate hierarchy from the existing flat `subjects` table (which
  // stays as-is, still used by the CBT question bank/exams engine). This
  // models Exam Body -> Examination -> Subject -> Topic -> Subtopic, with an
  // optional link from a syllabus subject to an existing CBT subject so
  // Milestone D can pull real practice/test questions for a topic without
  // duplicating the question bank.

  await db.execute(`
    CREATE TABLE IF NOT EXISTS exam_bodies (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(20) UNIQUE NOT NULL,
      description TEXT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // One-time seed — the exam bodies the import pipeline has always assumed
  // existed (WAEC, JAMB, etc.) were previously just hardcoded strings in the
  // client, never real rows here. Now that the import page's "Exam Body"
  // dropdown reads from this table (so admins can add universities or any
  // other exam body and have it show up there), seeding these as real rows
  // means adding a new one doesn't wipe the familiar defaults off the list —
  // they were never in the table to begin with otherwise. Only runs if the
  // table is empty, so this never overwrites anything an admin has already
  // customized (renamed, deactivated, reordered) since this seed inserted.
  const [[{ cnt }]] = await db.execute('SELECT COUNT(*) as cnt FROM exam_bodies');
  if (cnt === 0) {
    const defaults = [
      ['WAEC', 'West African Examinations Council'],
      ['JAMB', 'Joint Admissions and Matriculation Board'],
      ['NECO', 'National Examinations Council'],
      ['NABTEB', 'National Business and Technical Examinations Board'],
      ['BECE', 'Basic Education Certificate Examination'],
      ['POST-UTME', 'Post-UTME'],
      ['GENERAL', 'General / Uncategorized'],
    ];
    for (let i = 0; i < defaults.length; i++) {
      const [code, name] = defaults[i];
      await db.execute(
        'INSERT INTO exam_bodies (id, name, code, display_order) VALUES (?, ?, ?, ?)',
        [uuidv4(), name, code, i]
      );
    }
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS examinations (
      id VARCHAR(36) PRIMARY KEY,
      exam_body_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(30) NOT NULL,
      description TEXT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (exam_body_id) REFERENCES exam_bodies(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_exam_per_body (exam_body_id, code),
      INDEX idx_exam_body (exam_body_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS syllabus_subjects (
      id VARCHAR(36) PRIMARY KEY,
      examination_id VARCHAR(36) NOT NULL,
      linked_subject_id VARCHAR(36) NULL,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(30) NULL,
      description TEXT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (examination_id) REFERENCES examinations(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
      INDEX idx_syllabus_subject_exam (examination_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS syllabus_topics (
      id VARCHAR(36) PRIMARY KEY,
      syllabus_subject_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NULL,
      description TEXT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (syllabus_subject_id) REFERENCES syllabus_subjects(id) ON DELETE CASCADE,
      INDEX idx_topic_subject (syllabus_subject_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS syllabus_subtopics (
      id VARCHAR(36) PRIMARY KEY,
      topic_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      INDEX idx_subtopic_topic (topic_id)
    )
  `);

  // One content record per topic. AI drafts it, admin edits/approves it —
  // same draft-then-publish shape as the question import pipeline's staging
  // table, just for learning content instead of questions. Students only
  // ever see 'published' rows (section 20: never show unreviewed AI content
  // as if it were official).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS topic_content (
      id VARCHAR(36) PRIMARY KEY,
      topic_id VARCHAR(36) NOT NULL UNIQUE,
      learning_objectives TEXT NULL,
      key_concepts TEXT NULL,
      formulas TEXT NULL,
      definitions TEXT NULL,
      worked_examples TEXT NULL,
      exam_tips TEXT NULL,
      common_mistakes TEXT NULL,
      status ENUM('draft','published') DEFAULT 'draft',
      generated_by ENUM('ai','admin','ai_then_admin') DEFAULT 'ai',
      ai_generated_at DATETIME NULL,
      reviewed_by VARCHAR(36) NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Per-student, per-topic progress — section 5's status/progress table and
  // section 19's "Continue Learning" both read from this.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS student_topic_progress (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      status ENUM('not_started','in_progress','completed','needs_revision') DEFAULT 'not_started',
      progress_percent DECIMAL(5,2) DEFAULT 0,
      practice_score DECIMAL(5,2) NULL,
      test_score DECIMAL(5,2) NULL,
      last_activity_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_student_topic (student_id, topic_id),
      INDEX idx_progress_student (student_id)
    )
  `);

  console.log('✅ Exam preparation syllabus schema ready');

  // ═══════════════════════════════════════════════════════════════════════
  // Textbook Library — Milestone C
  // ═══════════════════════════════════════════════════════════════════════
  // Scoping decision, stated plainly: automatic text extraction runs for PDF
  // (pdf-parse) and DOCX (mammoth) so those formats get a searchable preview
  // and page-accurate "Recommended Reading" links. PPTX and scanned-image
  // textbooks are stored and readable as-is, but chapters for those formats
  // are defined manually by the admin rather than auto-detected — a full
  // PPTX text parser and page-level OCR pipeline for scanned books is a
  // meaningfully bigger scope than this milestone, and admin-entered chapter
  // titles/page numbers cover section 9's actual requirement (mapping
  // chapters to topics) either way.

  await db.execute(`
    CREATE TABLE IF NOT EXISTS textbooks (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      author VARCHAR(255) NULL,
      description TEXT NULL,
      file_type ENUM('pdf','docx','pptx','txt','image') NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_size_bytes INT NULL,
      page_count INT NULL,
      extracted_text LONGTEXT NULL,
      extraction_status ENUM('not_applicable','pending','done','failed') DEFAULT 'not_applicable',
      exam_body_id VARCHAR(36) NULL,
      examination_id VARCHAR(36) NULL,
      syllabus_subject_id VARCHAR(36) NULL,
      uploaded_by VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (exam_body_id) REFERENCES exam_bodies(id) ON DELETE SET NULL,
      FOREIGN KEY (examination_id) REFERENCES examinations(id) ON DELETE SET NULL,
      FOREIGN KEY (syllabus_subject_id) REFERENCES syllabus_subjects(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_textbook_subject (syllabus_subject_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS textbook_chapters (
      id VARCHAR(36) PRIMARY KEY,
      textbook_id VARCHAR(36) NOT NULL,
      title VARCHAR(500) NOT NULL,
      start_page INT NULL,
      end_page INT NULL,
      display_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (textbook_id) REFERENCES textbooks(id) ON DELETE CASCADE,
      INDEX idx_chapter_textbook (textbook_id)
    )
  `);

  // Many-to-many: one chapter can cover several topics (e.g. a single
  // "Organic Chemistry" chapter mapping to Hydrocarbons, Alkanes, Alkenes),
  // and one topic could reasonably draw from chapters in more than one book.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS textbook_topic_links (
      id VARCHAR(36) PRIMARY KEY,
      chapter_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chapter_id) REFERENCES textbook_chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_chapter_topic (chapter_id, topic_id),
      INDEX idx_link_topic (topic_id)
    )
  `);

  console.log('✅ Textbook library schema ready');

  // ═══════════════════════════════════════════════════════════════════════
  // Milestone D: link past questions to syllabus topics
  // ═══════════════════════════════════════════════════════════════════════
  // Connects the CBT question bank to the Read-by-Topic system — without
  // this, "Practice Questions" on a topic page has nothing to pull from.
  // Nullable: existing questions stay valid untagged; tagging happens during
  // batch review (or later, in bulk, from Question Bank).
  try {
    await db.execute(`ALTER TABLE questions ADD COLUMN topic_id VARCHAR(36) NULL`);
    console.log('✅ questions.topic_id column added');
  } catch (e) { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE questions ADD INDEX idx_question_topic (topic_id)`);
  } catch (e) { /* already exists */ }

  try {
    await db.execute(`ALTER TABLE staged_questions ADD COLUMN topic_id VARCHAR(36) NULL`);
    console.log('✅ staged_questions.topic_id column added');
  } catch (e) { /* already exists */ }

  console.log('✅ Database schema ready');

  // ═══════════════════════════════════════════════════════════════════════
  // Milestone E2: AI diagram reconstruction
  // ═══════════════════════════════════════════════════════════════════════
  // Separate from media_url (the original cropped photo, which stays as the
  // admin's reference/fallback). diagram_svg only gets set when an admin
  // explicitly clicks "Reconstruct Diagram" and accepts the result — never
  // automatically, since an AI-generated geometry diagram can look plausible
  // while being subtly wrong, and that's worse than a slightly rough photo.
  try {
    await db.execute(`ALTER TABLE staged_questions ADD COLUMN diagram_svg LONGTEXT NULL`);
    console.log('✅ staged_questions.diagram_svg column added');
  } catch (e) { /* already exists */ }
  try {
    await db.execute(`ALTER TABLE questions ADD COLUMN diagram_svg LONGTEXT NULL`);
    console.log('✅ questions.diagram_svg column added');
  } catch (e) { /* already exists */ }

  console.log('✅ Diagram reconstruction schema ready');

  // ═══════════════════════════════════════════════════════════════════════
  // Milestone E4: quality checklist (spec section 11)
  // ═══════════════════════════════════════════════════════════════════════
  // Stores the last-run checklist result so it persists in the review UI
  // without re-running the AI check on every page load. Opt-in per question
  // (admin-triggered), same cost-control principle as diagram reconstruction.
  try {
    await db.execute(`ALTER TABLE staged_questions ADD COLUMN quality_check JSON NULL`);
    console.log('✅ staged_questions.quality_check column added');
  } catch (e) { /* already exists */ }

  console.log('✅ Quality checklist schema ready');

  // One-time cleanup, safe to run on every boot (idempotent — does nothing
  // once there's nothing left to fix): questions published before the fix
  // to routes/importBatches.js had their media_url fall back to the ENTIRE
  // raw scanned source page whenever the diagram crop failed at import
  // time — so a student would see the whole exam page (unrelated
  // questions, handwriting, everything) instead of a proper cropped
  // diagram. That fix only stops it from happening to NEW imports; it
  // can't retroactively fix rows that already have the bad URL saved. This
  // finds any question whose media_url points into source-papers/ (whole
  // pages) rather than diagrams/ (actual crops) and clears it, which:
  //   - immediately stops showing the wrong full-page image to students
  //   - flips it back into the same state a freshly-failed crop would be
  //     in, so it shows up correctly in "Fix / Re-crop Diagrams" for an
  //     admin to give it a real crop
  try {
    const [result] = await db.execute(
      `UPDATE questions SET media_url = NULL
       WHERE media_url LIKE '/uploads/source-papers/%'`
    );
    if (result.affectedRows > 0) {
      console.log(`✅ Cleared ${result.affectedRows} question(s) that were showing a full scanned page instead of a cropped diagram`);
    }
  } catch (e) {
    console.error('media_url cleanup failed (non-fatal):', e.message);
  }
}

module.exports = { initDB, getDB };
