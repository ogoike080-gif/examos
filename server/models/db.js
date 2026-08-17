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

  console.log('✅ Database schema ready');
}

module.exports = { initDB, getDB };
