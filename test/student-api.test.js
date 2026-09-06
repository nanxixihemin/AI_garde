const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { after, before, test } = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-stage-student-api-'));
const databasePath = path.join(tempDir, 'students.sqlite');
const seedPath = path.join(tempDir, 'seed.json');

fs.writeFileSync(seedPath, JSON.stringify([
  { student_id: '202500000001', name: '测试甲', class_name: '人工智能2025级1班', gender: '男' },
  { student_id: '202500000002', name: '测试乙', class_name: '人工智能2025级2班', gender: '女' },
]), 'utf8');

process.env.STUDENT_DB_PATH = databasePath;
process.env.STUDENT_SEED_PATH = seedPath;
delete process.env.STUDENT_ADMIN_TOKEN;

const app = require('../server');
const studentDb = require('../student-db');
let server;
let baseUrl;

before(async () => {
  await studentDb.ready;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await studentDb.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(urlPath, options = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  return { response, body };
}

test('student list is seeded and searchable without a token by default', async () => {
  const { response, body } = await request('/api/students?q=测试甲&sort=student_id_asc');
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.rows[0].student_id, '202500000001');
});

test('GPA and achievement records update aggregate scores', async () => {
  const patch = await request('/api/students/202500000001', {
    method: 'PATCH',
    body: JSON.stringify({ gpa: 4.12, notes: 'API测试' }),
  });
  assert.equal(patch.response.status, 200);
  assert.equal(patch.body.data.gpa, 4.12);

  const created = await request('/api/students/202500000001/records', {
    method: 'POST',
    body: JSON.stringify({
      record_type: 'award',
      title: '测试竞赛一等奖',
      level: '校级',
      role: '一等奖',
      record_date: '2026-09-06',
      points: 3.5,
      evidence_url: 'https://example.com/evidence',
    }),
  });
  assert.equal(created.response.status, 201);

  const detail = await request('/api/students/202500000001');
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.total_points, 3.5);
  assert.equal(detail.body.award_count, 1);
  assert.equal(detail.body.records.length, 1);

  const removed = await request(`/api/student-records/${created.body.data.id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
});

test('invalid evidence URLs are rejected', async () => {
  const created = await request('/api/students/202500000002/records', {
    method: 'POST',
    body: JSON.stringify({
      record_type: 'paper',
      title: '测试论文',
      points: 2,
      evidence_url: 'javascript:alert(1)',
    }),
  });
  assert.equal(created.response.status, 400);
  assert.match(created.body.error, /http/);
});

test('configured token protects student APIs', async () => {
  process.env.STUDENT_ADMIN_TOKEN = 'temporary-test-token';
  const denied = await request('/api/students/summary');
  assert.equal(denied.response.status, 401);
  const allowed = await request('/api/students/summary', {
    headers: { Authorization: 'Bearer temporary-test-token' },
  });
  assert.equal(allowed.response.status, 200);
  delete process.env.STUDENT_ADMIN_TOKEN;
});
