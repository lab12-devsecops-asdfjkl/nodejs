const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const redis = require('redis');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Node.js Backend API',
      version: '1.0.0',
      description: 'API documentation for Node.js Express Backend with MySQL and Redis',
      contact: {
        name: 'API Support'
      }
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 8000}`,
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'User ID'
            },
            name: {
              type: 'string',
              description: 'User name'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            }
          }
        },
        HealthResponse: {
          type: 'object',
          properties: {
            service: {
              type: 'string'
            },
            version: {
              type: 'string'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            },
            database: {
              type: 'object',
              properties: {
                mysql: {
                  type: 'string'
                },
                redis: {
                  type: 'string'
                }
              }
            },
            uptime: {
              type: 'number'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string'
            }
          }
        }
      }
    }
  },
  apis: ['./server.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Database connections
let mysqlConnection = null;
let mysqlConnectionStatus = false;
let redisConnection = false;

// MySQL connection
// Support both connection string (MYSQL_URI) and individual variables
let mysqlConfig = null;

if (process.env.MYSQL_URI || process.env.MYSQL_CONNECTION_STRING) {
  // Parse MySQL connection string: mysql://user:password@host:port/database
  const connectionString = process.env.MYSQL_URI || process.env.MYSQL_CONNECTION_STRING;
  try {
    const url = new URL(connectionString);
    mysqlConfig = {
      host: url.hostname,
      port: url.port || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1), // Remove leading '/'
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };
  } catch (err) {
    console.error('❌ Invalid MySQL connection string format:', err.message);
  }
} else if (process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD && process.env.MYSQL_DATABASE) {
  // Use individual environment variables
  mysqlConfig = {
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

if (mysqlConfig) {
  mysqlConnection = mysql.createPool(mysqlConfig);

  // Test connection and create users table if it doesn't exist
  mysqlConnection.getConnection()
    .then((connection) => {
      console.log('✅ MySQL connected successfully');
      mysqlConnectionStatus = true;
      connection.release(); // Release the connection back to the pool

      // Create users table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      return mysqlConnection.query(createTableQuery);
    })
    .then(() => {
      console.log('✅ Users table ready');
    })
    .catch((err) => {
      console.error('❌ MySQL connection error:', err.message);
      mysqlConnectionStatus = false;
    });
}

// Redis connection
let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = redis.createClient({ url: process.env.REDIS_URL });

  redisClient.connect()
    .then(() => {
      console.log('✅ Redis connected successfully');
      redisConnection = true;
    })
    .catch((err) => {
      console.error('❌ Redis connection error:', err.message);
    });
}

// Routes
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the service and database connections
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service health information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', (req, res) => {
  res.json({
    service: 'Node.js Express Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: {
      mysql: mysqlConnectionStatus ? 'Connected' : 'Disconnected',
      redis: redisConnection ? 'Connected' : 'Disconnected'
    },
    uptime: process.uptime()
  });
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve a list of users from MySQL (limited to 10)
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       503:
 *         description: MySQL not connected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/users', async (req, res) => {
  try {
    if (!mysqlConnectionStatus || !mysqlConnection) {
      return res.status(503).json({ error: 'MySQL not connected' });
    }

    const [rows] = await mysqlConnection.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 10');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     description: Create a new user in MySQL
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john.doe@example.com
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: MySQL not connected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/users', async (req, res) => {
  try {
    if (!mysqlConnectionStatus || !mysqlConnection) {
      return res.status(503).json({ error: 'MySQL not connected' });
    }

    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const [result] = await mysqlConnection.query(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    );

    const [rows] = await mysqlConnection.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

// MySQL test route
/**
 * @swagger
 * /api/mysql/test:
 *   get:
 *     summary: Test MySQL connection
 *     description: Test the MySQL database connection and retrieve version
 *     tags: [Database]
 *     responses:
 *       200:
 *         description: MySQL connection successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: MySQL connection successful
 *                 version:
 *                   type: string
 *                   example: 8.0.33
 *       503:
 *         description: MySQL not connected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/mysql/test', async (req, res) => {
  try {
    if (!mysqlConnectionStatus || !mysqlConnection) {
      return res.status(503).json({ error: 'MySQL not connected' });
    }

    const [rows] = await mysqlConnection.query('SELECT VERSION() as version');
    res.json({
      message: 'MySQL connection successful',
      version: rows[0].version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Redis example route
/**
 * @swagger
 * /api/redis/test:
 *   get:
 *     summary: Test Redis connection
 *     description: Test the Redis connection by setting and getting a test value
 *     tags: [Database]
 *     responses:
 *       200:
 *         description: Redis connection successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Redis connection successful
 *                 testValue:
 *                   type: string
 *                   example: Hello Redis!
 *       503:
 *         description: Redis not connected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/redis/test', async (req, res) => {
  try {
    if (!redisConnection || !redisClient) {
      return res.status(503).json({ error: 'Redis not connected' });
    }

    await redisClient.set('test-key', 'Hello Redis!');
    const value = await redisClient.get('test-key');

    res.json({
      message: 'Redis connection successful',
      testValue: value
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Node.js server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/api-docs`);
});