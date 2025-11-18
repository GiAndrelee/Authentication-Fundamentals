require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { db, User, Project, Task } = require('./database/setup');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: false
  })
);

// Test database connection
async function testConnection() {
  try {
    await db.authenticate();
    console.log('Connection to database established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}

testConnection();

// =======================
// Authentication middleware
// =======================
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user; // attach user info to request
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

// =======================
// AUTH ROUTES
// =======================

// POST /api/register - user registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ error: 'Username, email, and password are required.' });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: 'A user with that email already exists.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword
    });

    return res.status(201).json({
      message: 'User registered successfully.',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    console.error('Error during registration:', error);
    return res.status(500).json({ error: 'Server error during registration.' });
  }
});

// POST /api/login - user login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Email and password are required.' });
    }

    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Save user info in session (do NOT store password)
    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email
    };

    return res.json({
      message: 'Login successful.',
      user: req.session.user
    });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /api/logout - user logout
app.post('/api/logout', (req, res) => {
  if (!req.session) {
    return res.json({ message: 'You are already logged out.' });
  }

  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({ error: 'Error logging out.' });
    }

    return res.json({ message: 'Logout successful.' });
  });
});

// =======================
// PROJECT ROUTES (Protected)
// =======================

// GET /api/projects - Get all projects for logged-in user
app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    const projects = await Project.findAll({
      where: { userId: req.user.id }
    });
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET /api/projects/:id - Get project by ID, only if it belongs to logged-in user
app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await Project.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// POST /api/projects - Create new project for logged-in user
app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const { name, description, status, dueDate } = req.body;

    const newProject = await Project.create({
      name,
      description,
      status,
      dueDate,
      userId: req.user.id // tie to logged-in user
    });

    res.status(201).json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// PUT /api/projects/:id - Update existing project if it belongs to logged-in user
app.put('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const { name, description, status, dueDate } = req.body;

    // Ensure project belongs to this user
    const project = await Project.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await project.update({ name, description, status, dueDate });

    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id - Delete project if it belongs to logged-in user
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await Project.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await project.destroy();

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// =======================
// TASK ROUTES (Protected, per user via project)
// =======================

// GET /api/tasks - Get all tasks that belong to user's projects
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await Task.findAll({
      include: {
        model: Project,
        where: { userId: req.user.id }
      }
    });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id - Get one task if it belongs to user's project
app.get('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({
      where: { id: req.params.id },
      include: {
        model: Project,
        where: { userId: req.user.id }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks - Create new task under a project that belongs to the user
app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { title, description, completed, priority, dueDate, projectId } = req.body;

    // Make sure the project belongs to this user
    const project = await Project.findOne({
      where: { id: projectId, userId: req.user.id }
    });

    if (!project) {
      return res.status(400).json({ error: 'Invalid projectId for this user.' });
    }

    const newTask = await Task.create({
      title,
      description,
      completed,
      priority,
      dueDate,
      projectId
    });

    res.status(201).json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update task if it belongs to user's project
app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const { title, description, completed, priority, dueDate, projectId } = req.body;

    const task = await Task.findOne({
      where: { id: req.params.id },
      include: {
        model: Project,
        where: { userId: req.user.id }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Optional: if projectId is changing, make sure new project belongs to user too
    let finalProjectId = task.projectId;
    if (projectId && projectId !== task.projectId) {
      const newProject = await Project.findOne({
        where: { id: projectId, userId: req.user.id }
      });
      if (!newProject) {
        return res.status(400).json({ error: 'Invalid projectId for this user.' });
      }
      finalProjectId = projectId;
    }

    await task.update({
      title,
      description,
      completed,
      priority,
      dueDate,
      projectId: finalProjectId
    });

    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id - Delete task if it belongs to user's project
app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({
      where: { id: req.params.id },
      include: {
        model: Project,
        where: { userId: req.user.id }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.destroy();

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
