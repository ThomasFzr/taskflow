import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
dotenv.config({ path: envFile });

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const app = express();

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const isValidHexColor = (value) => typeof value === 'string' && HEX_COLOR_REGEX.test(value);

const parseDueDateInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'dueDate must be an ISO 8601 string or null' };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: 'dueDate must be a valid ISO 8601 date' };
  }
  return { ok: true, value: Timestamp.fromDate(parsed) };
};

const formatTimestampField = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
};

// Security Middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parser with size limits
app.use(express.json({ limit: '10kb' }));

// Input validation middleware
const validateTaskInput = (req, res, next) => {
  const { title, dueDate, color } = req.body;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required and must be a string' });
  }

  if (title.trim().length === 0 || title.length > 500) {
    return res.status(400).json({ error: 'Title must be between 1 and 500 characters' });
  }

  const parsedDue = parseDueDateInput(dueDate);
  if (!parsedDue.ok) {
    return res.status(400).json({ error: parsedDue.error });
  }

  if (color !== undefined && color !== null) {
    if (typeof color !== 'string' || !isValidHexColor(color)) {
      return res.status(400).json({ error: 'color must be a valid hex string like #RGB or #RRGGBB, or null' });
    }
  }

  req.body.title = title.trim();
  req.body._parsedDueDate = parsedDue.value;
  next();
};

// Sanitize update data
const sanitizeUpdateData = (updates) => {
  const sanitized = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
    if (typeof updates.title !== 'string') {
      return { error: 'title must be a string' };
    }
    const t = updates.title.trim();
    if (t.length === 0 || t.length > 500) {
      return { error: 'Title must be between 1 and 500 characters' };
    }
    sanitized.title = t;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'completed')) {
    if (typeof updates.completed !== 'boolean') {
      return { error: 'completed must be a boolean' };
    }
    sanitized.completed = updates.completed;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'dueDate')) {
    const parsed = parseDueDateInput(updates.dueDate);
    if (!parsed.ok) {
      return { error: parsed.error };
    }
    sanitized.dueDate = parsed.value;
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'color')) {
    const c = updates.color;
    if (c !== null && (typeof c !== 'string' || !isValidHexColor(c))) {
      return { error: 'color must be a valid hex string like #RGB or #RRGGBB, or null' };
    }
    sanitized.color = c;
  }

  return { data: sanitized };
};

const formatTaskData = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    title: data.title,
    completed: data.completed,
    dueDate: formatTimestampField(data.dueDate),
    color: data.color ?? null,
    createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
  };
};

app.get('/tasks', async (req, res) => {
  try {
    // Pagination
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    let query = db.collection('tasks').orderBy('createdAt', 'desc');

    if (offset > 0) {
      const offsetSnapshot = await query.limit(offset).get();
      const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
    }

    const tasksSnapshot = await query.limit(limit).get();
    const tasks = [];

    tasksSnapshot.forEach(doc => {
      tasks.push(formatTaskData(doc));
    });

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/tasks/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array of task IDs' });
    }

    if (ids.length === 0) {
      return res.status(400).json({ error: 'ids must contain at least one task ID' });
    }

    const MAX_BULK = 100;
    if (ids.length > MAX_BULK) {
      return res.status(400).json({ error: `Cannot delete more than ${MAX_BULK} tasks at once` });
    }

    const invalidId = ids.find(
      (id) => typeof id !== 'string' || id.length === 0 || id.length > 100
    );
    if (invalidId !== undefined) {
      return res.status(400).json({ error: 'Each id must be a non-empty string of at most 100 characters' });
    }

    const batch = db.batch();
    for (const id of ids) {
      batch.delete(db.collection('tasks').doc(id));
    }
    await batch.commit();

    res.json({ deleted: ids.length, ids });
  } catch (error) {
    console.error('Error bulk-deleting tasks:', error);
    res.status(500).json({ error: 'Failed to delete tasks' });
  }
});

app.post('/tasks', validateTaskInput, async (req, res) => {
  try {
    const { title, color } = req.body;
    const dueTs = req.body._parsedDueDate;

    const taskRef = db.collection('tasks').doc();
    const task = {
      title,
      completed: false,
      createdAt: FieldValue.serverTimestamp()
    };

    if (dueTs !== null) {
      task.dueDate = dueTs;
    }
    if (color !== undefined && color !== null) {
      task.color = color;
    }

    await taskRef.set(task);

    const createdTask = await taskRef.get();
    res.status(201).json(formatTaskData(createdTask));
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || typeof id !== 'string' || id.length > 100) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const sanitizedResult = sanitizeUpdateData(req.body);

    if (sanitizedResult.error) {
      return res.status(400).json({ error: sanitizedResult.error });
    }

    const sanitizedUpdates = sanitizedResult.data;

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();

    if (!task.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await taskRef.update(sanitizedUpdates);

    const updatedTask = await taskRef.get();
    res.json(formatTaskData(updatedTask));
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || typeof id !== 'string' || id.length > 100) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();

    if (!task.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await taskRef.delete();
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
}

export { app, server };