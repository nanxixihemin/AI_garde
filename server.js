const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support larger payloads for bulk sync

// REST API Endpoints

// 1. GET Plan Scores
app.get('/api/plan-scores', async (req, res) => {
  try {
    const scores = await db.getPlanScores();
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST Plan Score (insert, update, or delete if empty/null)
app.post('/api/plan-scores', async (req, res) => {
  const { courseId, score } = req.body;
  
  if (courseId === undefined) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  try {
    if (score === null || score === '' || score === undefined) {
      const scores = await db.savePlanScore(courseId, null);
      res.json({ success: true, action: 'deleted', data: scores });
    } else {
      const numScore = Number(score);
      if (isNaN(numScore) || numScore < 0 || numScore > 100) {
        return res.status(400).json({ error: 'Score must be a number between 0 and 100' });
      }
      const scores = await db.savePlanScore(courseId, numScore);
      res.json({ success: true, action: 'saved', data: { courseId, score: numScore } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET Core Course Custom Names
app.get('/api/core-course-names', async (req, res) => {
  try {
    const names = await db.getCoreCourseNames();
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST Core Course Custom Name (save or delete if empty)
app.post('/api/core-course-names', async (req, res) => {
  const { courseId, customName } = req.body;

  if (courseId === undefined) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  try {
    const cleanName = String(customName || '').trim();
    if (!cleanName) {
      await db.saveCoreCourseName(courseId, null);
      res.json({ success: true, action: 'deleted' });
    } else {
      await db.saveCoreCourseName(courseId, cleanName);
      res.json({ success: true, action: 'saved', data: { courseId, customName: cleanName } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET User Growth Data (skills, courses, milestones)
app.get('/api/user-data', async (req, res) => {
  try {
    const list = await db.getUserData();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST User Growth Data Record (add or update)
app.post('/api/user-data', async (req, res) => {
  const { id, name, category, status, time, startTime, endTime, result, note } = req.body;

  if (!id || !name || !category || !status) {
    return res.status(400).json({ error: 'id, name, category, status are required' });
  }

  try {
    const savedRecord = await db.saveUserDataRecord({ id, name, category, status, time, startTime, endTime, result, note });
    res.json({ success: true, action: 'saved', data: savedRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. DELETE User Growth Data Record
app.delete('/api/user-data/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }

  try {
    await db.deleteUserDataRecord(id);
    res.json({ success: true, message: `Deleted record ${id}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. GET Competition Details
app.get('/api/competition-details/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const details = await db.getCompetitionDetails(id);
    if (details) {
      res.json(details);
    } else {
      // Return a clean default template for unseeded competition IDs
      res.json({
        id: Number(id),
        tracks: ["常规主赛道组"],
        timeline: "请参考当年官方发布的具体赛程时间",
        website: "",
        note: "暂无备赛攻略，欢迎您在此键入并保存个人心得！"
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST Competition Details (insert or update custom competition detail)
app.post('/api/competition-details/:id', async (req, res) => {
  const { id } = req.params;
  const { tracks, timeline, website, note } = req.body;

  try {
    const updated = await db.saveCompetitionDetails(id, { tracks, timeline, website, note });
    res.json({ success: true, action: 'saved', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST Sync API (bulk import from LocalStorage on first run)
app.post('/api/sync', async (req, res) => {
  const { planScores, coreCourseNames, userData, habits } = req.body;

  try {
    await db.syncAll({ planScores, coreCourseNames, userData, habits });
    console.log('Bulk sync completed successfully.');
    res.json({ success: true, message: 'Bulk migration sync completed successfully.' });
  } catch (err) {
    console.error('Bulk sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 11. GET Habits
app.get('/api/habits', async (req, res) => {
  try {
    const habits = await db.getHabits();
    res.json(habits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST Habits
app.post('/api/habits', async (req, res) => {
  try {
    const habits = req.body;
    if (!Array.isArray(habits)) {
      return res.status(400).json({ error: 'Body must be an array of habits' });
    }
    const saved = await db.saveHabits(habits);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend static assets from public/ directory
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve public/index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start backend server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` AI Evolution Stage Backend Server is running!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
