const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DETAILS_FILE = path.join(DATA_DIR, 'competition_details.json');

// Helper to write file atomically (creates temp file first, then renames to prevent corruption)
async function safeWriteJson(filePath, data) {
  const tempPath = filePath + '.tmp';
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

// Helper to read file safely, returns defaultValue if file doesn't exist
async function safeReadJson(filePath, defaultValue = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }
}

// Ensure database directory exists
if (!require('fs').existsSync(DATA_DIR)) {
  require('fs').mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DETAILS_FILE = path.join(__dirname, 'default_competition_details.json');

// Seed database on startup if file doesn't exist
async function seedCompetitionDetails() {
  try {
    const exists = await fs.access(DETAILS_FILE).then(() => true).catch(() => false);
    if (!exists) {
      console.log('Competition details database file not found. Seeding all 105 major competitions...');
      let seedData = {};
      try {
        const content = await fs.readFile(DEFAULT_DETAILS_FILE, 'utf8');
        seedData = JSON.parse(content);
      } catch (err) {
        console.error('Failed to read default seed file:', err.message);
      }
      await safeWriteJson(DETAILS_FILE, seedData);
      console.log('Competition details seeded successfully.');
    }
  } catch (err) {
    console.error('Error seeding competition details:', err.message);
  }
}

// Call seeder immediately
seedCompetitionDetails();

const db = {
  // 1. Plan Scores Database Operations
  getPlanScores: () => safeReadJson(path.join(DATA_DIR, 'plan_scores.json'), {}),
  
  savePlanScore: async (courseId, score) => {
    const scores = await db.getPlanScores();
    const idKey = String(courseId);
    
    if (score === null || score === '' || score === undefined) {
      delete scores[idKey];
    } else {
      scores[idKey] = Number(score);
    }
    
    await safeWriteJson(path.join(DATA_DIR, 'plan_scores.json'), scores);
    return scores;
  },

  // 2. Core Course Names Database Operations
  getCoreCourseNames: () => safeReadJson(path.join(DATA_DIR, 'core_course_names.json'), {}),
  
  saveCoreCourseName: async (courseId, customName) => {
    const names = await db.getCoreCourseNames();
    const idKey = String(courseId);
    const cleanName = String(customName || '').trim();
    
    if (!cleanName) {
      delete names[idKey];
    } else {
      names[idKey] = cleanName;
    }
    
    await safeWriteJson(path.join(DATA_DIR, 'core_course_names.json'), names);
    return names;
  },

  // 3. User Growth Records Database Operations
  getUserData: () => safeReadJson(path.join(DATA_DIR, 'user_data.json'), []),
  
  saveUserDataRecord: async (record) => {
    const list = await db.getUserData();
    const idKey = String(record.id);
    const existingIndex = list.findIndex(r => String(r.id) === idKey);
    
    const newRecord = {
      id: idKey,
      name: String(record.name),
      category: String(record.category),
      status: String(record.status),
      time: record.time || '',
      startTime: record.startTime || '',
      endTime: record.endTime || '',
      result: record.result || '',
      note: record.note || '',
      created_at: record.created_at || Date.now()
    };

    if (existingIndex > -1) {
      // Update: preserve original created_at timestamp
      newRecord.created_at = list[existingIndex].created_at || newRecord.created_at;
      list[existingIndex] = newRecord;
    } else {
      // Create new: unshift at the beginning (index 0 is newest)
      list.unshift(newRecord);
    }
    
    await safeWriteJson(path.join(DATA_DIR, 'user_data.json'), list);
    return newRecord;
  },

  deleteUserDataRecord: async (id) => {
    const list = await db.getUserData();
    const idKey = String(id);
    const filtered = list.filter(r => String(r.id) !== idKey);
    await safeWriteJson(path.join(DATA_DIR, 'user_data.json'), filtered);
    return filtered;
  },

  // 4. Competition Details Database Operations
  getCompetitionDetails: async (id) => {
    const details = await safeReadJson(DETAILS_FILE, {});
    const idKey = String(id);
    if (details[idKey]) return details[idKey];
    
    // Try to fallback to reading default details
    try {
      const defaultContent = await fs.readFile(DEFAULT_DETAILS_FILE, 'utf8');
      const defaults = JSON.parse(defaultContent);
      return defaults[idKey] || null;
    } catch (err) {
      return null;
    }
  },

  saveCompetitionDetails: async (id, data) => {
    const details = await safeReadJson(DETAILS_FILE, {});
    const idKey = String(id);
    
    details[idKey] = {
      id: Number(id),
      tracks: Array.isArray(data.tracks) ? data.tracks.map(String) : [],
      timeline: String(data.timeline || '').trim(),
      website: String(data.website || '').trim(),
      note: String(data.note || '').trim()
    };

    await safeWriteJson(DETAILS_FILE, details);
    return details[idKey];
  },

  // 5. Bulk Sync Data Operations (LocalStorage -> JSON files migration)
  syncAll: async ({ planScores, coreCourseNames, userData }) => {
    // Sync plan scores
    if (planScores) {
      const currentScores = await db.getPlanScores();
      Object.entries(planScores).forEach(([courseId, score]) => {
        const numScore = Number(score);
        if (score !== null && score !== '' && !isNaN(numScore)) {
          currentScores[String(courseId)] = numScore;
        }
      });
      await safeWriteJson(path.join(DATA_DIR, 'plan_scores.json'), currentScores);
    }

    // Sync elective custom course names
    if (coreCourseNames) {
      const currentNames = await db.getCoreCourseNames();
      Object.entries(coreCourseNames).forEach(([courseId, name]) => {
        const cleanName = String(name || '').trim();
        if (cleanName) {
          currentNames[String(courseId)] = cleanName;
        }
      });
      await safeWriteJson(path.join(DATA_DIR, 'core_course_names.json'), currentNames);
    }

    // Sync user data growth records
    if (userData && Array.isArray(userData)) {
      const currentList = await db.getUserData();
      const now = Date.now();
      
      userData.forEach((item, index) => {
        if (item && item.id && item.name) {
          const idKey = String(item.id);
          const exists = currentList.some(r => String(r.id) === idKey);
          
          if (!exists) {
            // Set sequential timestamps in descending order to preserve front-end list ordering
            const itemCreatedAt = now - index * 1000;
            currentList.push({
              id: idKey,
              name: String(item.name),
              category: String(item.category),
              status: String(item.status),
              time: item.time || '',
              startTime: item.startTime || '',
              endTime: item.endTime || '',
              result: item.result || '',
              note: item.note || '',
              created_at: item.created_at || itemCreatedAt
            });
          }
        }
      });

      // Sort by created_at DESC to preserve newer items at index 0
      currentList.sort((a, b) => b.created_at - a.created_at);
      await safeWriteJson(path.join(DATA_DIR, 'user_data.json'), currentList);
    }

    // Sync Habits
    if (habits && Array.isArray(habits)) {
      await db.saveHabits(habits);
    }
  },

  // 6. Habit Loops Database Operations
  getHabits: async () => {
    const filePath = path.join(DATA_DIR, 'habits.json');
    // If the habits.json doesn't exist, seed it with the default "30天听力与口语闭环计划"
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      const now = new Date();
      const sDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const defaultHabits = [
        {
          id: "habit_default_listening",
          title: "30天听力与口语闭环计划",
          subtitle: "10min 听力对齐 + 5min 原生回响",
          daysCount: 30,
          startDate: sDate,
          completedDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
          created_at: Date.now()
        }
      ];
      await safeWriteJson(filePath, defaultHabits);
      return defaultHabits;
    }
    return safeReadJson(filePath, []);
  },

  saveHabits: async (habits) => {
    const filePath = path.join(DATA_DIR, 'habits.json');
    await safeWriteJson(filePath, habits);
    return habits;
  }
};

module.exports = db;
