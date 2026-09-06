const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DEFAULT_DATABASE_PATH = process.env.STUDENT_DB_PATH || path.join(__dirname, 'data', 'students.sqlite');
const DEFAULT_SEED_PATH = process.env.STUDENT_SEED_PATH || path.join(__dirname, 'student_seed.json');
const ALLOWED_SORTS = new Map([
  ['points_desc', 'total_points DESC, s.student_id ASC'],
  ['points_asc', 'total_points ASC, s.student_id ASC'],
  ['gpa_desc', 's.gpa IS NULL ASC, s.gpa DESC, total_points DESC, s.student_id ASC'],
  ['gpa_asc', 's.gpa IS NULL ASC, s.gpa ASC, s.student_id ASC'],
  ['name_asc', 's.name COLLATE NOCASE ASC, s.student_id ASC'],
  ['student_id_asc', 's.student_id ASC'],
]);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, maxLength, fieldName, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) {
    throw createError(`${fieldName}不能为空`);
  }
  if (text.length > maxLength) {
    throw createError(`${fieldName}不能超过${maxLength}个字符`);
  }
  return text;
}

function cleanOptionalNumber(value, fieldName) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw createError(`${fieldName}必须是非负数字`);
  }
  return number;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

class StudentDatabase {
  constructor(options = {}) {
    this.databasePath = options.databasePath || DEFAULT_DATABASE_PATH;
    this.seedPath = options.seedPath || DEFAULT_SEED_PATH;
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.connection = new sqlite3.Database(this.databasePath);
    this.ready = this.initialize();
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row || null);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.connection.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve(rows || []);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.connection.exec(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async initialize() {
    await this.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS students (
        student_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        gender TEXT NOT NULL,
        gpa REAL CHECK (gpa IS NULL OR gpa >= 0),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS student_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN ('award', 'paper', 'other')),
        title TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        organization TEXT NOT NULL DEFAULT '',
        record_date TEXT,
        points REAL NOT NULL DEFAULT 0 CHECK (points >= 0),
        evidence_url TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
      CREATE INDEX IF NOT EXISTS idx_students_class_name ON students(class_name);
      CREATE INDEX IF NOT EXISTS idx_student_records_student_id ON student_records(student_id);
      CREATE INDEX IF NOT EXISTS idx_student_records_type ON student_records(record_type);
    `);

    const countRow = await this.get('SELECT COUNT(*) AS count FROM students');
    if ((countRow?.count || 0) === 0) {
      await this.seedStudents();
    }
  }

  async seedStudents() {
    if (!fs.existsSync(this.seedPath)) return;
    const seed = JSON.parse(fs.readFileSync(this.seedPath, 'utf8'));
    if (!Array.isArray(seed)) {
      throw new Error('student_seed.json must contain an array');
    }

    await this.run('BEGIN IMMEDIATE');
    try {
      for (const item of seed) {
        await this.run(
          `INSERT OR IGNORE INTO students (student_id, name, class_name, gender)
           VALUES (?, ?, ?, ?)`,
          [
            cleanText(item.student_id, 32, '学号', { required: true }),
            cleanText(item.name, 80, '姓名', { required: true }),
            cleanText(item.class_name, 120, '班级', { required: true }),
            cleanText(item.gender, 20, '性别', { required: true }),
          ]
        );
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  async getSummary() {
    await this.ready;
    return this.get(`
      SELECT
        COUNT(DISTINCT s.student_id) AS student_count,
        COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN s.student_id END) AS students_with_records,
        COUNT(r.id) AS record_count,
        COALESCE(SUM(r.points), 0) AS total_points
      FROM students s
      LEFT JOIN student_records r ON r.student_id = s.student_id
    `);
  }

  async listStudents(options = {}) {
    await this.ready;
    const query = cleanText(options.query, 100, '搜索内容');
    const className = cleanText(options.className, 120, '班级');
    const sort = ALLOWED_SORTS.has(options.sort) ? options.sort : 'points_desc';
    const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(options.offset, 10) || 0, 0);
    const clauses = [];
    const params = [];

    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      clauses.push("(s.student_id LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    if (className) {
      clauses.push('s.class_name = ?');
      params.push(className);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const totalRow = await this.get(`SELECT COUNT(*) AS count FROM students s ${where}`, params);
    const rows = await this.all(
      `SELECT
         s.student_id,
         s.name,
         s.class_name,
         s.gender,
         s.gpa,
         s.notes,
         COALESCE(SUM(r.points), 0) AS total_points,
         SUM(CASE WHEN r.record_type = 'award' THEN 1 ELSE 0 END) AS award_count,
         SUM(CASE WHEN r.record_type = 'paper' THEN 1 ELSE 0 END) AS paper_count,
         SUM(CASE WHEN r.record_type = 'other' THEN 1 ELSE 0 END) AS other_count
       FROM students s
       LEFT JOIN student_records r ON r.student_id = s.student_id
       ${where}
       GROUP BY s.student_id
       ORDER BY ${ALLOWED_SORTS.get(sort)}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { rows, total: totalRow?.count || 0, limit, offset, sort };
  }

  async getClasses() {
    await this.ready;
    return this.all('SELECT class_name, COUNT(*) AS student_count FROM students GROUP BY class_name ORDER BY class_name');
  }

  async getStudent(studentId) {
    await this.ready;
    const id = cleanText(studentId, 32, '学号', { required: true });
    const student = await this.get(
      `SELECT
         s.student_id,
         s.name,
         s.class_name,
         s.gender,
         s.gpa,
         s.notes,
         COALESCE(SUM(r.points), 0) AS total_points,
         SUM(CASE WHEN r.record_type = 'award' THEN 1 ELSE 0 END) AS award_count,
         SUM(CASE WHEN r.record_type = 'paper' THEN 1 ELSE 0 END) AS paper_count,
         SUM(CASE WHEN r.record_type = 'other' THEN 1 ELSE 0 END) AS other_count
       FROM students s
       LEFT JOIN student_records r ON r.student_id = s.student_id
       WHERE s.student_id = ?
       GROUP BY s.student_id`,
      [id]
    );
    if (!student) throw createError('未找到该学生', 404);
    student.records = await this.all(
      `SELECT id, student_id, record_type, title, level, role, organization,
              record_date, points, evidence_url, notes, created_at, updated_at
       FROM student_records
       WHERE student_id = ?
       ORDER BY CASE WHEN record_date IS NULL OR record_date = '' THEN 1 ELSE 0 END,
                record_date DESC,
                id DESC`,
      [id]
    );
    return student;
  }

  async updateStudent(studentId, patch = {}) {
    await this.ready;
    const id = cleanText(studentId, 32, '学号', { required: true });
    const gpa = cleanOptionalNumber(patch.gpa, '绩点');
    const notes = cleanText(patch.notes, 1000, '备注');
    const result = await this.run(
      `UPDATE students SET gpa = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
      [gpa, notes, id]
    );
    if (!result.changes) throw createError('未找到该学生', 404);
    return this.getStudent(id);
  }

  normalizeRecord(input = {}) {
    const recordType = cleanText(input.record_type, 20, '成果类型', { required: true });
    if (!['award', 'paper', 'other'].includes(recordType)) {
      throw createError('成果类型必须是 award、paper 或 other');
    }
    const recordDate = cleanText(input.record_date, 10, '日期');
    if (recordDate && !/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      throw createError('日期格式必须为 YYYY-MM-DD');
    }
    const evidenceUrl = cleanText(input.evidence_url, 500, '证明链接');
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
      throw createError('证明链接必须以 http:// 或 https:// 开头');
    }
    return {
      record_type: recordType,
      title: cleanText(input.title, 240, '成果名称', { required: true }),
      level: cleanText(input.level, 120, '级别'),
      role: cleanText(input.role, 120, '位次或奖项'),
      organization: cleanText(input.organization, 200, '组织或期刊'),
      record_date: recordDate || null,
      points: cleanOptionalNumber(input.points, '加分') ?? 0,
      evidence_url: evidenceUrl,
      notes: cleanText(input.notes, 1000, '备注'),
    };
  }

  async addRecord(studentId, input = {}) {
    await this.ready;
    const id = cleanText(studentId, 32, '学号', { required: true });
    const exists = await this.get('SELECT student_id FROM students WHERE student_id = ?', [id]);
    if (!exists) throw createError('未找到该学生', 404);
    const record = this.normalizeRecord(input);
    const result = await this.run(
      `INSERT INTO student_records
       (student_id, record_type, title, level, role, organization, record_date, points, evidence_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.record_type,
        record.title,
        record.level,
        record.role,
        record.organization,
        record.record_date,
        record.points,
        record.evidence_url,
        record.notes,
      ]
    );
    return this.get('SELECT * FROM student_records WHERE id = ?', [result.lastID]);
  }

  async updateRecord(recordId, input = {}) {
    await this.ready;
    const id = Number.parseInt(recordId, 10);
    if (!Number.isInteger(id) || id <= 0) throw createError('成果记录ID无效');
    const record = this.normalizeRecord(input);
    const result = await this.run(
      `UPDATE student_records
       SET record_type = ?, title = ?, level = ?, role = ?, organization = ?,
           record_date = ?, points = ?, evidence_url = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        record.record_type,
        record.title,
        record.level,
        record.role,
        record.organization,
        record.record_date,
        record.points,
        record.evidence_url,
        record.notes,
        id,
      ]
    );
    if (!result.changes) throw createError('未找到该成果记录', 404);
    return this.get('SELECT * FROM student_records WHERE id = ?', [id]);
  }

  async deleteRecord(recordId) {
    await this.ready;
    const id = Number.parseInt(recordId, 10);
    if (!Number.isInteger(id) || id <= 0) throw createError('成果记录ID无效');
    const result = await this.run('DELETE FROM student_records WHERE id = ?', [id]);
    if (!result.changes) throw createError('未找到该成果记录', 404);
    return { id };
  }

  close() {
    return new Promise((resolve, reject) => {
      this.connection.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createStudentDatabase(options) {
  return new StudentDatabase(options);
}

const studentDatabase = createStudentDatabase();

module.exports = studentDatabase;
module.exports.createStudentDatabase = createStudentDatabase;
