import {
  type Character,
  type IAgentRuntime,
  logger,
  stringToUuid,
  type UUID,
  type IDatabaseAdapter,
} from '@elizaos/core';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import * as fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path, { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { randomUUID } from 'crypto';
import { createApiRouter, createPluginRouteHandler } from './api/index';
import { apiKeyAuthMiddleware } from './authMiddleware';
import { ServerDatabaseAdapter } from './database/ServerDatabaseAdapter';
import { ServerMigrationService } from './database/ServerMigrationService';
import { jsonToCharacter, loadCharacterTryPath } from './loader';
import { agentCardMiddleware } from './erc8004';

// CRITICAL: Ensure http module is available globally before importing ws
// This fixes Bun bundling issues with the ws module
const setupHttpForWs = () => {
  const g = globalThis as typeof globalThis & { http?: typeof http };
  g.http = http;
  if (typeof global !== 'undefined') {
    (global as typeof global & { http?: typeof http }).http = http;
  }

  // Ensure STATUS_CODES is available - this is needed for WebSocket compatibility
  if (!g.http?.STATUS_CODES) {
    // Just ensure the http module has what it needs without full replacement
    if (!g.http) {
      g.http = http;
    }
  }

  // Override require to ensure http is always available
  
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id: string) {
      if (id === 'http' || id === 'node:http') {
        return http;
      }
      return originalRequire.apply(this, arguments);
    };
  } catch (_e) {
    // Ignore if Module is not available
  }
};

setupHttpForWs();

// Delay WebSocketServer import until after http polyfill
import { WebSocketServer } from 'ws';
import { messageBusConnectorPlugin } from './services/message';
import { getMediaBuffer } from './game-api-plugin';

import { ChannelType } from '@elizaos/core';
import {
  createDatabaseAdapter,
  DatabaseMigrationService,
  plugin as sqlPlugin,
} from '@elizaos/plugin-sql';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolveEnvFile } from './api/system/environment';
import internalMessageBus from './bus';
import type {
  CentralRootMessage,
  MessageChannel,
  MessageServer,
  MessageServiceStructure,
} from './types';
import { TodoPlugin } from '@elizaos/plugin-todo';
import { sql } from 'drizzle-orm';

/**
 * Expands a file path starting with `~` to the project directory.
 *
 * @param filepath - The path to expand.
 * @returns The expanded path.
 */
export function expandTildePath(filepath: string): string {
  if (!filepath) {
    return filepath;
  }

  if (filepath.startsWith('~')) {
    if (filepath === '~') {
      return process.cwd();
    } else if (filepath.startsWith('~/')) {
      return path.join(process.cwd(), filepath.slice(2));
    } else if (filepath.startsWith('~~')) {
      // Don't expand ~~
      return filepath;
    } else {
      // Handle ~user/path by expanding it to cwd/user/path
      return path.join(process.cwd(), filepath.slice(1));
    }
  }

  return filepath;
}

export function resolvePgliteDir(dir?: string, fallbackDir?: string): string {
  const envPath = resolveEnvFile();
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const base =
    dir ??
    process.env.PGLITE_DATA_DIR ??
    fallbackDir ??
    path.join(process.cwd(), '.eliza', '.elizadb');

  // Automatically migrate legacy path (<cwd>/.elizadb) to new location (<cwd>/.eliza/.elizadb)
  const resolved = expandTildePath(base);
  const legacyPath = path.join(process.cwd(), '.elizadb');
  if (resolved === legacyPath) {
    const newPath = path.join(process.cwd(), '.eliza', '.elizadb');
    process.env.PGLITE_DATA_DIR = newPath;
    return newPath;
  }

  return resolved;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID; // Single default server

/**
 * Represents a function that acts as a server middleware.
 * @param {express.Request} req - The request object.
 * @param {express.Response} res - The response object.
 * @param {express.NextFunction} next - The next function to be called in the middleware chain.
 * @returns {void}
 */
export type ServerMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => void;

// Define a type for Express errors
interface ExpressError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

// Define WebSocket message data interface
interface WebSocketMessageData {
  channelId: string;
  agentId: string;
  content: string;
  author: string;
  metadata: Record<string, unknown>;
}

// Define log entry interface
interface LogEn
  timestamp: string;
  level: string;
  message: string;
  agentName?: string;
  [key: string]: unknown;
}

/**
 * Class representing an agent server.
 */ /**
 * Represents an agent server which handles agents, database, and server functionalities.
 */
export class AgentServer {
  public app!: express.Application;
  public agents: Map<UUID, IAgentRuntime>;
  public server!: http.Server;
  public webSocketServer!: WebSocketServer; // Native WebSocket server
  private logStreamConnections: Map<string, { agentName?: string; level?: string }> = new Map();
  public isInitialized: boolean = false; // Flag to prevent double initialization

  public database!: IDatabaseAdapter; // This will be the agent database adapter (for compatibility)
  public serverDatabase!: ServerDatabaseAdapter; // Server-specific database adapter
  private db!: unknown; // Raw database connection

  public startAgent!: (character: Character) => Promise<IAgentRuntime>;
  public stopAgent!: (runtime: IAgentRuntime) => void;
  public loadCharacterTryPath!: (characterPath: string) => Promise<Character>;
  public jsonToCharacter!: (character: unknown) => Promise<Character>;

  /**
   * Constructor for AgentServer class.
   *
   * @constructor
   */
  constructor() {
    try {
      logger.debug('Initializing AgentServer (constructor)...');
      this.agents = new Map();

      // Initialize character loading functions
      this.loadCharacterTryPath = loadCharacterTryPath;
      this.jsonToCharacter = jsonToCharacter;

      // Register signal handlers once in constructor to prevent accumulation
      this.registerSignalHandlers();
    } catch (error) {
      logger.error('Failed to initialize AgentServer (constructor):', error);
      throw error;
    }
  }

  /**
   * Initializes the database and server.
   *
   * @param {ServerOptions} [options] - Optional server options.
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  public async initialize(postgresUrl: string): Promise<void> {
    if (this.isInitialized) {
      logger.warn('AgentServer is already initialized, skipping initialization');
      return;
    }

    try {
      logger.debug('Initializing AgentServer (async operations)...');

      // Create a temporary database adapter just to get the raw database connection
      const tempAdapter = createDatabaseAdapter(
        {
          postgresUrl,
        },
        '00000000-0000-0000-0000-000000000002'
      );
      await tempAdapter.init();

      // Get the raw database connection (BaseDrizzleAdapter has getDatabase method)
      interface BaseDrizzleAdapter {
        getDatabase(): any;
      }
      this.db = (tempAdapter as unknown as BaseDrizzleAdapter).getDatabase();

      // Create the server-specific database adapter
      this.serverDatabase = new ServerDatabaseAdapter(this.db as any);

      // Keep the agent database adapter for backward compatibility
      this.database = tempAdapter;

      logger.success('Database connections initialized successfully');

      // Run server-specific migrations first
      logger.info('[INIT] Running server-specific database migrations...');
      try {
        const serverMigrationService = new ServerMigrationService(this.db as any);
        await serverMigrationService.runMigrations();
        logger.success('[INIT] Server migrations completed successfully');
      } catch (migrationError) {
        logger.error('[INIT] Failed to run server migrations:', migrationError);
        throw new Error(
          `Server migration failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`
        );
      }

      // Then run plugin migrations for core ElizaOS tables
      logger.info('[INIT] Running plugin migrations for core tables...');
      const migrationService = new DatabaseMigrationService();
      await migrationService.initializeWithDatabase(this.db as any);

      // Register all plugin schemas: SQL (core tables), Todo, and Goals
      const pluginsToMigrate = [sqlPlugin, TodoPlugin /*, GoalsPlugin*/];
      logger.info(`[INIT] Registering schemas for ${pluginsToMigrate.length} plugins...`);
      migrationService.discoverAndRegisterPluginSchemas(pluginsToMigrate);

      // Run the migrations
      logger.info('[INIT] Running all plugin migrations...');
      await migrationService.runAllPluginMigrations();

      logger.success('[INIT] Plugin migrations completed successfully');

      // Verify critical tables exist after migrations
      logger.info('[INIT] Verifying database tables...');
      try {
        const criticalTables = ['agents', 'entities', 'rooms', 'participants', 'memories', 'cache'];
        for (const tableName of criticalTables) {
          const result = await (this.db as any).execute(
            sql`SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public'
                AND table_name = ${tableName}
              ) as exists`
          );
          // Handle different result structures - Drizzle may return rows differently
          const exists = result.rows?.[0]?.exists ?? result[0]?.exists ?? false;
          if (!exists) {
            throw new Error(`Critical table '${tableName}' does not exist after migrations`);
          }
        }
        logger.success('[INIT] All critical tables verified');
      } catch (verifyError) {
        logger.error('[INIT] Table verification failed:', verifyError);
        const errorMessage =
          verifyError instanceof Error ? verifyError.message : String(verifyError);
        throw new Error(`Database table verification failed: ${errorMessage}`);
      }

      // Add a small delay to ensure database is fully ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Ensure default server exists
      logger.info('[INIT] Ensuring default server exists...');
      await this.ensureDefaultServer();
      logger.success('[INIT] Default server setup complete');

      await this.initializeServer();
      await new Promise((resolve) => setTimeout(resolve, 250));
      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize AgentServer (async operations):', error);
      console.trace(error);
      throw error;
    }
  }

  private async ensureDefaultServer(): Promise<void> {
    // Check if the default server exists using server database
    logger.info('[AgentServer] Checking for default server...');
    const servers = await this.serverDatabase.getMessageServers();
    logger.debug(`[AgentServer] Found ${servers.length} existing servers`);

    // Log all existing servers for debugging
    servers.forEach((s: MessageServer) => {
      logger.debug(`[AgentServer] Existing server: ID=${s.id}, Name=${s.name}`);
    });

    const defaultServer = servers.find(
      (s: MessageServer) => s.id === '00000000-0000-0000-0000-000000000000'
    );

    if (!defaultServer) {
      logger.info(
        '[AgentServer] Creating default server with UUID 00000000-0000-0000-0000-000000000000...'
      );

      const server = await this.serverDatabase.createMessageServer({
        id: '00000000-0000-0000-0000-000000000000' as UUID,
        name: 'Default Server',
        sourceType: 'eliza_default',
      });
      logger.success('[AgentServer] Default server created with ID:', server.id);
    }

    // Verify it was created
    const verifyServers = await this.serverDatabase.getMessageServers();
    logger.debug(`[AgentServer] After creation attempt, found ${verifyServers.length} servers`);
    verifyServers.forEach((s: any) => {
      logger.debug(`[AgentServer] Server after creation: ID=${s.id}, Name=${s.name}`);
    });

    const verifyDefault = verifyServers.find(
      (s: any) => s.id === '00000000-0000-0000-0000-000000000000'
    );
    if (!verifyDefault) {
      throw new Error(
        'Failed to create or verify default server with ID 00000000-0000-0000-0000-000000000000'
      );
    } else {
      logger.success('[AgentServer] Default server creation verified successfully');
    }
  }

  /**
   * Initializes the server with the provided options.
   *
   * @param {ServerOptions} [options] - Optional server options.
   * @returns {Promise<void>} - A promise that resolves once the server is initialized.
   */
  private async initializeServer() {
    // Initialize middleware and database
    this.app = express();

    // Security headers first - before any other middleware
    const isProd = process.env.NODE_ENV === 'production';
    logger.debug('Setting up security headers...');
    if (!isProd) {
      logger.debug(`NODE_ENV: ${process.env.NODE_ENV}`);
      logger.debug(`CSP will be: ${isProd ? 'ENABLED' : 'MINIMAL_DEV'}`);
    }
    this.app.use(
      helmet({
        // Content Security Policy - environment-aware configuration
        contentSecurityPolicy: isProd
          ? {
              // Production CSP - includes upgrade-insecure-requests
              directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
                fontSrc: ["'self'", 'https:', 'data:'],
                connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
                mediaSrc: ["'self'", 'blob:', 'data:'],
                objectSrc: ["'none'"],
                frameSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                // upgrade-insecure-requests is added by helmet automatically
              },
              useDefaults: true,
            }
          : {
              // Development CSP - minimal policy without upgrade-insecure-requests
              directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", 'https:', 'http:'],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
                fontSrc: ["'self'", 'https:', 'http:', 'data:'],
                connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
                mediaSrc: ["'self'", 'blob:', 'data:'],
                objectSrc: ["'none'"],
                frameSrc: ["'self'", 'data:'],
                baseUri: ["'self'"],
                formAction: ["'self'"],
                // Note: upgrade-insecure-requests is intentionally omitted for Safari compatibility
              },
              useDefaults: false,
            },
        // Cross-Origin Embedder Policy - disabled for compatibility
        crossOriginEmbedderPolicy: false,
        // Cross-Origin Resource Policy
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        // Frame Options - allow same-origin iframes to align with frameSrc CSP
        frameguard: { action: 'sameorigin' },
        // Hide Powered-By header
        hidePoweredBy: true,
        // HTTP Strict Transport Security - only in production
        hsts: isProd
          ? {
              maxAge: 31536000, // 1 year
              includeSubDomains: true,
              preload: true,
            }
          : false,
        // No Sniff
        noSniff: true,
        // Referrer Policy
        referrerPolicy: { policy: 'no-referrer-when-downgrade' },
        // X-XSS-Protection
        xssFilter: true,
      })
    );

    // Setup middleware for all requests
    logger.debug('Setting up standard middlewares...');
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGIN || true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'],
      })
    ); // Enable CORS
    this.app.use(
      express.json({
        limit: process.env.EXPRESS_MAX_PAYLOAD || '100mb',
      })
    ); // Parse JSON bodies with increased limit to support large imports

    // File uploads are now handled by individual routes using multer
    // No global file upload middleware needed

    // Optional Authentication Middleware
    const serverAuthToken = process.env.ELIZA_SERVER_AUTH_TOKEN;
    if (serverAuthToken) {
      logger.info('Server authentication enabled. Requires X-API-KEY header for /api routes.');
      // Apply middleware only to /api paths
      this.app.use('/api', (req, res, next) => {
        apiKeyAuthMiddleware(req, res, next);
      });
    } else {
      logger.warn(
        'Server authentication is disabled. Set ELIZA_SERVER_AUTH_TOKEN environment variable to enable.'
      );
    }

    const uploadsBasePath = path.join(process.cwd(), '.eliza', 'data', 'uploads', 'agents');
    const generatedBasePath = path.join(process.cwd(), '.eliza', 'data', 'generated');
    fs.mkdirSync(uploadsBasePath, { recursive: true });
    fs.mkdirSync(generatedBasePath, { recursive: true });

    // Agent-specific media serving - only serve files from agent-specific directories
    this.app.get(
      '/media/uploads/agents/:agentId/:filename',
      (req: express.Request, res: express.Response): void => {
        const agentId = req.params.agentId as string;
        const filename = req.params.filename as string;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(agentId)) {
          res.status(400).json({ error: 'Invalid agent ID format' });
          return;
        }
        const sanitizedFilename = basename(filename);
        const agentUploadsPath = join(uploadsBasePath, agentId);
        const filePath = join(agentUploadsPath, sanitizedFilename);
        if (!filePath.startsWith(agentUploadsPath)) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: 'File does not exist!!!!!!!' });
          return;
        }

        res.sendFile(sanitizedFilename, { root: agentUploadsPath }, (err) => {
          if (err) {
            if (err.message === 'Request aborted') {
              logger.warn(`[MEDIA] Download aborted: ${req.originalUrl}`);
            } else if (!res.headersSent) {
              logger.warn(`[MEDIA] File not found: ${agentUploadsPath}/${sanitizedFilename}`);
              res.status(404).json({ error: 'File not found' });
            }
          } else {
            logger.debug(`[MEDIA] Successfully served: ${sanitizedFilename}`);
          }
        });
      }
    );

    this.app.get(
      '/media/generated/:agentId/:filename',
      (
        req: express.Request<{ agentId: string; filename: string }>,
        res: express.Response
      ): void => {
        const agentId = req.params.agentId;
        const filename = req.params.filename;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(agentId)) {
          res.status(400).json({ error: 'Invalid agent ID format' });
          return;
        }
        const sanitizedFilename = basename(filename);
        const agentGeneratedPath = join(generatedBasePath, agentId);
        const filePath = join(agentGeneratedPath, sanitizedFilename);
        if (!filePath.startsWith(agentGeneratedPath)) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
        res.sendFile(filePath, (err) => {
          if (err) {
            res.status(404).json({ error: 'File not found' });
          }
        });
      }
    );

    // Channel-specific media serving
    this.app.get(
      '/media/uploads/channels/:channelId/:filename',
      (req: express.Request<{ channelId: string; filename: string }>, res: express.Response) => {
        const channelId = req.params.channelId as string;
        const filename = req.params.filename as string;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (!uuidRegex.test(channelId)) {
          res.status(400).json({ error: 'Invalid channel ID format' });
          return;
        }

        const sanitizedFilename = basename(filename);
        const channelUploadsPath = join(uploadsBasePath, 'channels', channelId);
        const filePath = join(channelUploadsPath, sanitizedFilename);

        if (!filePath.startsWith(channelUploadsPath)) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }

        res.sendFile(filePath, (err) => {
          if (err) {
            logger.warn(`[STATIC] Channel media file not found: ${filePath}`, err);
            if (!res.headersSent) {
              res.status(404).json({ error: 'File not found' });
            }
          } else {
            logger.debug(`[STATIC] Served channel media file: ${filePath}`);
          }
        });
      }
    );

    // Add specific middleware to handle portal assets
    this.app.use((req, res, next) => {
      // Automatically detect and handle static assets based on file extension
      const ext = extname(req.path).toLowerCase();

      // Set correct content type based on file extension
      if (ext === '.js' || ext === '.mjs') {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (ext === '.css') {
        res.setHeader('Content-Type', 'text/css');
      } else if (ext === '.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
      } else if (ext === '.png') {
        res.setHeader('Content-Type', 'image/png');
      } else if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Content-Type', 'image/jpeg');
      }

      // Continue processing
      next();
    });

    // Setup static file serving with proper MIME types
    const _staticOptions = {
      etag: true,
      lastModified: true,
      fallthrough: true, // Allow non-existent files to pass through to the catch-all route
      setHeaders: (res: express.Response, filePath: string) => {
        // Set the correct content type for different file extensions
        const ext = extname(filePath).toLowerCase();
        if (ext === '.css') {
          res.setHeader('Content-Type', 'text/css');
        } else if (ext === '.js') {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (ext === '.html') {
          res.setHeader('Content-Type', 'text/html');
        } else if (ext === '.png') {
          res.setHeader('Content-Type', 'image/png');
        } else if (ext === '.jpg' || ext === '.jpeg') {
          res.setHeader('Content-Type', 'image/jpeg');
        } else if (ext === '.svg') {
          res.setHeader('Content-Type', 'image/svg+xml');
        }
      },
    };

    // *** NEW: Mount the plugin route handler BEFORE static serving ***
    const pluginRouteHandler = createPluginRouteHandler(this.agents);
    this.app.use(pluginRouteHandler);

    // Serve agent card at /.well-known/agent-card.json
    const serverUrl = process.env.AGENT_URL || `http://localhost:${this.port}`;
    const agentName = process.env.AGENT_NAME || 'Elizagotchi';
    this.app.use(agentCardMiddleware(agentName, serverUrl));

    // Mount the core API router under /api
    // This router handles all API endpoints including:
    // - /api/agents/* - Agent management and interactions
    // - /api/messaging/* - Message handling and channels
    // - /api/media/* - File uploads and media serving
    // - /api/memory/* - Memory management and retrieval
    // - /api/audio/* - Audio processing and transcription
    // - /api/server/* - Runtime and server management
    // - /api/tee/* - TEE (Trusted Execution Environment) operations
    // - /api/system/* - System configuration and health checks
    const apiRouter = createApiRouter(this.agents, this);
    this.app.use(
      '/api',
      (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        if (req.path !== '/ping') {
          logger.debug(`API request: ${req.method} ${req.path}`);
        }
        next();
      },
      apiRouter,
      (err: ExpressError, req: Request, res: Response, _next: NextFunction) => {
        logger.error(`API error: ${req.method} ${req.path}`, err);
        res.status(500).json({
          success: false,
          error: {
            message: err.message || 'Internal Server Error',
            code: err.code || 500,
          },
        });
      }
    );

    // Store server instance for plugins to access
    this.app.locals.agentServer = this;

    // Also store as global for plugins that need WebSocket broadcasting
    (global as typeof global & { elizaAgentServer?: any }).elizaAgentServer = this;

    // Serve the simple messaging UI
    this.app.get('/messaging', (req, res) => {
      // Try multiple paths including Docker container path
      const paths = [
        path.join(__dirname, '..', 'public', 'messaging.html'), // Development: src/../public
        path.join(__dirname, 'public', 'messaging.html'), // Production: dist/public
        path.join(process.cwd(), 'public', 'messaging.html'), // Working directory
        '/app/public/messaging.html', // Docker container absolute path
      ];

      logger.debug(`Looking for messaging.html in paths:`, paths);

      for (const htmlPath of paths) {
        if (fs.existsSync(htmlPath)) {
          logger.debug(`Found messaging.html at: ${htmlPath}`);
          res.sendFile(htmlPath);
          return;
        }
      }

      logger.warn(`Messaging UI not found. Checked paths:`, paths);
      res.status(404).send('Messaging UI not found');
    });

    // Add a catch-all route for API 404s
    this.app.use((req, res, next) => {
      // Check if this is an API route that wasn't handled
      if (req.path.startsWith('/api/')) {
        // worms are going to hitting it all the time, use a reverse proxy if you need this type of logging
        //logger.warn(`API 404: ${req.method} ${req.path}`);
        res.status(404).json({
          success: false,
          error: {
            message: 'API endpoint not found',
            code: 404,
          },
        });
      } else {
        // Not an API route, continue to next middleware
        next();
      }
    });

    // Return 403 Forbidden for non-API routes when UI is disabled
    this.app.use((_req: express.Request, res: express.Response) => {
      res.sendStatus(403); // Standard HTTP 403 Forbidden
    });

    // Create HTTP server for Socket.io and WebSocket
    this.server = http.createServer(this.app);

    // Initialize native WebSocket server for Tauri client compatibility
    this.setupWebSocketServer(this.server);

    // Setup log streaming integration
    this.setupLogStreaming();

    // Setup message bus listener for agent responses
    this.setupMessageBusListener();

    logger.success('AgentServer HTTP server, Socket.IO, and WebSocket initialized');
  }

  /**
   * Sets up listener for agent responses from internal message bus
   */
  private setupMessageBusListener(): void {
    internalMessageBus.on('agent_response', (response: unknown) => {
      logger.info('[AgentServer] Received agent response from message bus:', response);

      // Cast to access properties (response structure is dynamic)
      const agentResponse = response as Record<string, unknown>;

      // Broadcast to WebSocket clients in the channel
      if (agentResponse.channel_id) {
        this.broadcastToWebSocketClients(
          {
            type: 'agent_message',
            id: agentResponse.id || randomUUID(),
            content: agentResponse.content,
            author: agentResponse.agentName || 'ELIZA',
            channel_id: agentResponse.channel_id,
            timestamp: agentResponse.timestamp || Date.now(),
            metadata: agentResponse.metadata,
          },
          agentResponse.channel_id as string
        );
      }
    });
  }

  /**
   * Sets up the native WebSocket server for real-time communication
   * This provides the /ws endpoint that Tauri clients expect
   */
  private setupWebSocketServer(server: http.Server | https.Server) {
    logger.info('[WebSocket] Setting up native WebSocket server...');

    this.webSocketServer = new WebSocketServer({
      server,
      path: '/ws',
    });

    this.webSocketServer.on('connection', (ws, request) => {
      const clientId = Math.random().toString(36).substring(7);
      logger.info(`[WebSocket] New connection: ${clientId} from ${request.socket.remoteAddress}`);

      // Handle initial connection message
      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());
        logger.info(`[WebSocket ${clientId}] Received message:`, message);

        switch (message.type) {
          case 'connect':
            // Handle connection setup
            const { agent_id, channel_id, client_type } = message;
            logger.info(
              `[WebSocket ${clientId}] Client connecting - Agent: ${agent_id}, Channel: ${channel_id}, Type: ${client_type}`
            );

            // Send connection acknowledgment
            ws.send(
              JSON.stringify({
                type: 'connection_ack',
                client_id: clientId,
                agent_id,
                channel_id,
                status: 'connected',
                timestamp: Date.now(),
              })
            );
            break;

          case 'message':
          case 'user_message': // Support both message types
            // Handle incoming messages from client
            const { content, author, channel_id: msgChannelId, agent_id: msgAgentId } = message;
            logger.info(
              `[WebSocket ${clientId}] Processing message from ${author}: ${content?.substring(0, 50)}...`
            );

            ws.send(
              JSON.stringify({
                type: 'message',
                content: 'Hello from WebSocket test!',
                channel_id: 'ce5f41b4-fe24-4c01-9971-aecfed20a6bd',
                agent_id: '2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f',
                author: 'Test User',
                timestamp: Date.now()
              })
            );

            // Process message through agent
            await this.processWebSocketMessage(
              {
                channelId: msgChannelId,
                agentId: msgAgentId,
                content,
                author,
                metadata: {
                  source: 'websocket',
                  client_id: clientId,
                  timestamp: Date.now(),
                },
              },
              ws
            );
            break;

          case 'media_stream':
            // Handle media stream data
            const { media_type, stream_type, data, encoding, agent_id: streamAgentId } = message;
            logger.info(
              `[WebSocket ${clientId}] Received ${media_type} stream (${stream_type}): ${data?.length || 0} bytes`
            );

            // Decode base64 data if provided as string
            let mediaData: Uint8Array;
            if (typeof data === 'string') {
              // Assume base64 encoded
              const buffer = Buffer.from(data, 'base64');
              mediaData = new Uint8Array(buffer);
            } else if (Array.isArray(data)) {
              // Array of bytes
              mediaData = new Uint8Array(data);
            } else {
              mediaData = data as Uint8Array;
            }

            // Get agent runtime
            const streamRuntime =
              this.agents.get(streamAgentId as UUID) || Array.from(this.agents.values())[0];
            if (streamRuntime) {
              // Store in media buffer
              const mediaBuffer = getMediaBuffer(streamRuntime.agentId);
              if (mediaBuffer) {
                if (media_type === 'video') {
                  mediaBuffer.videoFrames.push(mediaData);
                  if (mediaBuffer.videoFrames.length > mediaBuffer.maxBufferSize) {
                    mediaBuffer.videoFrames.shift();
                  }
                } else if (media_type === 'audio') {
                  mediaBuffer.audioChunks.push(mediaData);
                  if (mediaBuffer.audioChunks.length > mediaBuffer.maxBufferSize) {
                    mediaBuffer.audioChunks.shift();
                  }
                }
              }

              // Notify vision service
              const visionService =
                streamRuntime.getService('vision') || streamRuntime.getService('VISION');
              interface VisionServiceMethods {
                processMediaStream?: (data: any) => Promise<void>;
              }
              if (
                visionService &&
                typeof (visionService as VisionServiceMethods).processMediaStream === 'function'
              ) {
                const processMediaStream = (visionService as VisionServiceMethods)
                  .processMediaStream;
                if (processMediaStream) {
                  await processMediaStream({
                    type: media_type,
                    streamType: stream_type,
                    data: mediaData,
                    encoding,
                    timestamp: Date.now(),
                  });
                }
              }

              // Send acknowledgment
              ws.send(
                JSON.stringify({
                  type: 'media_stream_ack',
                  media_type,
                  stream_type,
                  size: mediaData.length,
                  timestamp: Date.now(),
                })
              );
            } else {
              logger.warn(`[WebSocket ${clientId}] No agent runtime available for media stream`);
            }
            break;

          case 'subscribe_logs':
            // Handle log streaming subscription
            this.logStreamConnections.set(clientId, message.filters || {});
            logger.info(`[WebSocket ${clientId}] Client subscribed to log stream`);
            ws.send(
              JSON.stringify({
                type: 'log_subscription_confirmed',
                subscribed: true,
                message: 'Successfully subscribed to log stream',
                timestamp: Date.now(),
              })
            );
            break;

          case 'unsubscribe_logs':
            // Handle log streaming unsubscription
            this.logStreamConnections.delete(clientId);
            logger.info(`[WebSocket ${clientId}] Client unsubscribed from log stream`);
            ws.send(
              JSON.stringify({
                type: 'log_subscription_confirmed',
                subscribed: false,
                message: 'Successfully unsubscribed from log stream',
                timestamp: Date.now(),
              })
            );
            break;

          case 'update_log_filters':
            // Handle log filter updates
            const existingFilters = this.logStreamConnections.get(clientId);
            if (existingFilters !== undefined) {
              this.logStreamConnections.set(clientId, { ...existingFilters, ...message.filters });
              logger.info(`[WebSocket ${clientId}] Updated log filters:`, message.filters);
              ws.send(
                JSON.stringify({
                  type: 'log_filters_updated',
                  success: true,
                  filters: this.logStreamConnections.get(clientId),
                  timestamp: Date.now(),
                })
              );
            } else {
              logger.warn(
                `[WebSocket ${clientId}] Cannot update filters: not subscribed to log stream`
              );
              ws.send(
                JSON.stringify({
                  type: 'log_filters_updated',
                  success: false,
                  error: 'Not subscribed to log stream',
                  timestamp: Date.now(),
                })
              );
            }
            break;

          default:
            logger.warn(`[WebSocket ${clientId}] Unknown message type: ${message.type}`);
            ws.send(
              JSON.stringify({
                type: 'error',
                message: `Unknown message type: ${message.type}`,
                timestamp: Date.now(),
              })
            );
        }
      });

      ws.on('close', (code, reason) => {
        logger.info(`[WebSocket] Connection ${clientId} closed: ${code} ${reason}`);
        // Clean up log stream connections
        this.logStreamConnections.delete(clientId);
      });

      ws.on('error', (error) => {
        logger.error(`[WebSocket] Error on connection ${clientId}:`, error);
      });

      // Send initial connection message with delay to ensure handshake completion
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'welcome',
              message: 'Connected to ElizaOS WebSocket server',
              client_id: clientId,
              timestamp: Date.now(),
            })
          );
          logger.info(`[WebSocket] Welcome message sent to ${clientId}`);
        }
      }, 100); // 100ms delay to ensure handshake completion
    });

    this.webSocketServer.on('error', (error) => {
      logger.error('[WebSocket] WebSocket server error:', error);
    });

    logger.success('[WebSocket] Native WebSocket server initialized on /ws endpoint');
  }

  /**
   * Process WebSocket messages and route them to agents
   */
  private async processWebSocketMessage(
    messageData: WebSocketMessageData,
    ws: WebSocket
  ): Promise<void> {
    try {
      const { channelId, agentId, content, author, metadata } = messageData;

      // Validate required fields
      if (!channelId || !content || !author) {
        throw new Error('Missing required fields: channelId, content, author');
      }

      // Convert channelId string to UUID
      const channelUuid = stringToUuid(channelId);

      // Find the agent runtime
      const runtime = this.agents.get(agentId as UUID) || Array.from(this.agents.values())[0];
      if (!runtime) {
        throw new Error('No agent runtime available');
      }

      // Check if channel exists, if not create it
      let channel = await this.getChannelDetails(channelUuid);
      if (!channel) {
        logger.info(`[WebSocket] Channel ${channelId} does not exist, creating it...`);

        // Get or create a default server
        const servers = await this.getServers();
        let serverId: UUID;

        if (servers.length === 0) {
          // Create a default server if none exists
          const defaultServer = await this.createServer({
            name: 'Default Server',
            sourceType: 'default',
            metadata: {
              created_by: 'websocket_auto_creation',
              created_at: new Date().toISOString(),
            },
          });
          serverId = defaultServer.id as UUID;
        } else {
          serverId = servers[0].id as UUID;
        }

        // Create the channel
        channel = await this.createChannel({
          id: channelUuid,
          serverId,
          name:
            typeof metadata?.channel_name === 'string'
              ? metadata.channel_name
              : `Game Channel ${channelId.substring(0, 8)}`,
          type: ChannelType.GROUP,
          sourceType: 'websocket_client',
          metadata: {
            created_by: 'websocket_auto_creation',
            created_for: author,
            created_at: new Date().toISOString(),
            ...metadata,
          },
        });

        logger.info(`[WebSocket] Created channel ${channelId} successfully`);
      }

      // Create message for internal processing
      const internalMessage = {
        channelId: channelUuid,
        authorId: stringToUuid(String(author || 'websocket_user')),
        content,
        rawMessage: {
          text: content,
          type: 'websocket_message',
          client_id: metadata.client_id,
        },
        metadata: {
          ...metadata,
          user_display_name: author,
          websocket_client: true,
        },
        source_type: 'websocket_client',
      };

      // Store message in central database
      const createdMessage = await this.createMessage(internalMessage);
      logger.info(`[WebSocket] Message stored with ID: ${createdMessage.id}`);

      // Send acknowledgment back to WebSocket client
      ws.send(
        JSON.stringify({
          type: 'message_ack',
          message_id: createdMessage.id,
          status: 'received',
          timestamp: Date.now(),
        })
      );

      // The createMessage method already emits to the internal bus, so we don't need to emit again
      logger.info(
        `[WebSocket] Message ${createdMessage.id} will be processed by agents via internal bus`
      );

      this.broadcastToWebSocketClients({
        type: 'agent_message', 
        id: createdMessage.id,
        content: "Message received",
        author: author,
        channel_id: channelId,
        timestamp: createdMessage.createdAt.getTime(),
        source: 'websocket_user',
      },
      channelId,
    );
    } catch (error) {
      logger.error('[WebSocket] Error processing message:', error);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Failed to process message',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        })
      );
    }
  }

  /**
   * Broadcast messages to WebSocket clients
   */
  public broadcastToWebSocketClients(
    message: Record<string, unknown>,
    _channelId?: string,
    _excludeClientId?: string
  ): void {
    if (!this.webSocketServer) {
      return;
    }

    const broadcastMessage = JSON.stringify(message);

    this.webSocketServer.clients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        // TODO: Add channel-based filtering once we track client channel subscriptions
        // For now, broadcast to all connected clients
        client.send(broadcastMessage);
      }
    });

    logger.debug(`[WebSocket] Broadcasted message to ${this.webSocketServer.clients.size} clients`);
  }

  /**
   * Setup log streaming integration with the logger
   */
  private setupLogStreaming(): void {
    logger.info('[WebSocket] Setting up log streaming integration...');

    // Access the logger's destination to hook into log events
    const loggerInstance = logger as any;
    const destination = loggerInstance[Symbol.for('pino-destination')];

    if (destination && typeof destination.write === 'function') {
      // Store original write method
      const originalWrite = destination.write.bind(destination);

      // Override write method to broadcast logs via WebSocket
      destination.write = (data: string | any) => {
        // Call original write first
        originalWrite(data);

        // Parse and broadcast log entry
        try {
          let logEntry;
          if (typeof data === 'string') {
            logEntry = JSON.parse(data);
          } else {
            logEntry = data;
          }

          // Add timestamp if not present
          if (!logEntry.time) {
            logEntry.time = Date.now();
          }

          // Broadcast to WebSocket clients with log subscriptions
          this.broadcastLogToSubscribers(logEntry);
        
      };

      logger.success('[WebSocket] Log streaming integration setup complete');
    } else {
      logger.warn('[WebSocket] Could not setup log streaming - logger destination not accessible');
    }
  }

  /**
   * Broadcast log entries to subscribed WebSocket clients
   */
  private broadcastLogToSubscribers(logEntry: LogEntry): void {
    if (this.logStreamConnections.size === 0) {
      return;
    }

    const logData = {
      type: 'log_entry',
      payload: logEntry,
      timestamp: Date.now(),
    };

    this.logStreamConnections.forEach((filters, _clientId) => {
      // Find the WebSocket client by clientId
      // Note: We need to track clientId to WebSocket mapping
      this.webSocketServer.clients.forEach((client) => {
        if (client.readyState === 1) {
          // WebSocket.OPEN
          let shouldBroadcast = true;

          // Apply agent name filter
          if (filters.agentName && filters.agentName !== 'all') {
            shouldBroadcast = shouldBroadcast && logEntry.agentName === filters.agentName;
          }

          // Apply log level filter
          if (filters.level && filters.level !== 'all') {
            const numericLevel =
              typeof filters.level === 'string'
                ? (logger as any).levels.values[filters.level.toLowerCase()] || 70
                : filters.level;
            shouldBroadcast = shouldBroadcast && logEntry.level >= numericLevel;
          }

          if (shouldBroadcast) {
            client.send(JSON.stringify(logData));
          }
        }
      });
    });
  }

  /**
   * Registers an agent with the provided runtime.
   *
   * @param {IAgentRuntime} runtime - The runtime object containing agent information.
   * @throws {Error} if the runtime is null/undefined, if agentId is missing, if character configuration is missing,
   * or if there are any errors during registration.
   */
  public async registerAgent(runtime: IAgentRuntime) {
    try {
      if (!runtime) {
        throw new Error('Attempted to register null/undefined runtime');
      }
      if (!runtime.agentId) {
        throw new Error('Runtime missing agentId');
      }
      if (!runtime.character) {
        throw new Error('Runtime missing character configuration');
      }

      this.agents.set(runtime.agentId, runtime);
      logger.debug(`Agent ${runtime.character.name} (${runtime.agentId}) added to agents map`);

      // Auto-register the MessageBusConnector plugin
      try {
        if (messageBusConnectorPlugin) {
          await runtime.registerPlugin(messageBusConnectorPlugin);
          logger.info(
            `[AgentServer] Automatically registered MessageBusConnector for agent ${runtime.character.name}`
          );
        } else {
          logger.error('[AgentServer] CRITICAL: MessageBusConnector plugin definition not found.');
        }
      } catch (e) {
        logger.error(
          `[AgentServer] CRITICAL: Failed to register MessageBusConnector for agent ${runtime.character.name}`,
          e
        );
        // Decide if this is a fatal error for the agent.
      }

      // Register TEE plugin if present
      const teePlugin = runtime.plugins.find((p) => p.name === 'phala-tee-plugin');
      if (teePlugin) {
        logger.debug(`Found TEE plugin for agent ${runtime.agentId}`);
        if (teePlugin.providers) {
          for (const provider of teePlugin.providers) {
            runtime.registerProvider(provider);
            logger.debug(`Registered TEE provider: ${provider.name}`);
          }
        }
        if (teePlugin.actions) {
          for (const action of teePlugin.actions) {
            runtime.registerAction(action);
            logger.debug(`Registered TEE action: ${action.name}`);
          }
        }
      }

      logger.success(
        `Successfully registered agent ${runtime.character.name} (${runtime.agentId}) with core services.`
      );

      await this.addAgentToServer(DEFAULT_SERVER_ID, runtime.agentId);
      logger.info(
        `[AgentServer] Auto-associated agent ${runtime.character.name} with server ID: ${DEFAULT_SERVER_ID}`
      );
    
  }

  /**
   * Unregisters an agent from the system.
   *
   * @param {UUID} agentId - The unique identifier of the agent to unregister.
   * @returns {void}
   */
  public unregisterAgent(agentId: UUID) {
    if (!agentId) {
      logger.warn('[AGENT UNREGISTER] Attempted to unregister undefined or invalid agent runtime');
      return;
    }

    try {
      // Retrieve the agent before deleting it from the map
      const agent = this.agents.get(agentId);

      if (agent) {
        // Stop all services of the agent before unregistering it
        try {
          agent.stop().catch((stopError) => {
            logger.error(
              `[AGENT UNREGISTER] Error stopping agent services for ${agentId}:`,
              stopError
            );
          });
          logger.debug(`[AGENT UNREGISTER] Stopping services for agent ${agentId}`);
        } catch (stopError) {
          logger.error(`[AGENT UNREGISTER] Error initiating stop for agent ${agentId}:`, stopError);
        }
      }

      // Delete the agent from the map
      this.agents.delete(agentId);
      logger.debug(`Agent ${agentId} removed from agents map`);
    } catch (error) {
      logger.error(`Error removing agent ${agentId}:`, error);
    }
  }

  /**
   * Add middleware to the server's request handling pipeline
   * @param {ServerMiddleware} middleware - The middleware function to be registered
   */
  public registerMiddleware(middleware: ServerMiddleware) {
    this.app.use(middleware);
  }

  /**
   * Starts the server on the specified port.
   *
   * @param {number} port - The port number on which the server should listen.
   * @returns {Promise<void>} A promise that resolves when the server is listening.
   * @throws {Error} If the port is invalid or if there is an error while starting the server.
   */
  public start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!port || typeof port !== 'number') {
          throw new Error(`Invalid port number: ${port}`);
        }

        logger.debug(`Starting server on port ${port}...`);
        logger.debug(`Current agents count: ${this.agents.size}`);
        logger.debug(`Environment: ${process.env.NODE_ENV}`);

        // Use http server instead of app.listen with explicit host binding and error handling
        // For tests and macOS compatibility, prefer 127.0.0.1 when specified
        const host = process.env.SERVER_HOST || '0.0.0.0';

        this.server
          .listen(port, host, () => {
            // Use actual host or localhost
            const actualHost = host === '0.0.0.0' ? 'localhost' : host;
            const baseUrl = `http://${actualHost}:${port}`;

            console.log(
              '\x1b[32mStartup successful!\x1b[0m\n' +
                '\x1b[33mWeb UI disabled.\x1b[0m \x1b[32mAPI endpoints available at:\x1b[0m\n' +
                `  \x1b[1m${baseUrl}/api/server/ping\x1b[22m\x1b[0m\n` +
                `  \x1b[1m${baseUrl}/api/agents\x1b[22m\x1b[0m\n` +
                `  \x1b[1m${baseUrl}/messaging\x1b[22m\x1b[0m`
            );

            // Add log for test readiness
            console.log(`AgentServer is listening on port ${port}`);

            logger.success(
              `REST API bound to ${host}:${port}. If running locally, access it at http://localhost:${port}.`
            );
            logger.debug(`Active agents: ${this.agents.size}`);
            this.agents.forEach((agent, id) => {
              logger.debug(`- Agent ${id}: ${agent.character.name}`);
            });

            // Resolve the promise now that the server is actually listening
            resolve();
          })
          .on('error', (error: Error) => {
            logger.error(`Failed to bind server to ${host}:${port}:`, error);

            // Provide helpful error messages for common issues
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'EADDRINUSE') {
              logger.error(
                `Port ${port} is already in use. Please try a different port or stop the process using that port.`
              );
            } else if (nodeError.code === 'EACCES') {
              logger.error(
                `Permission denied to bind to port ${port}. Try using a port above 1024 or running with appropriate permissions.`
              );
            } else if (nodeError.code === 'EADDRNOTAVAIL') {
              logger.error(
                `Cannot bind to ${host}:${port} - address not available. Check if the host address is correct.`
              );
            }

            // Reject the promise on error
            reject(error);
          });

        // Server is now listening successfully
      } catch (error) {
        logger.error('Failed to start server:', error);
        reject(error);
      }
    });
  }

  /**
   * Stops the server if it is running. Closes the server connection,
   * stops the database connection, and logs a success message.
   */
  public async stop(): Promise<void> {
    if (this.server) {
      this.server.close(() => {
        logger.success('Server stopped');
      });
    }
  }

  // Central DB Data Access Methods
  async createServer(
    data: Omit<MessageServer, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MessageServer> {
    return this.serverDatabase.createMessageServer(data);
  }

  async getServers(): Promise<MessageServer[]> {
    return this.serverDatabase.getMessageServers();
  }

  async getServerById(serverId: UUID): Promise<MessageServer | null> {
    return this.serverDatabase.getMessageServerById(serverId);
  }

  async getServerBySourceType(sourceType: string): Promise<MessageServer | null> {
    const servers = await this.serverDatabase.getMessageServers();
    const filtered = servers.filter((s: MessageServer) => s.sourceType === sourceType);
    return filtered.length > 0 ? filtered[0] : null;
  }

  async createChannel(
    data: Omit<MessageChannel, 'id' | 'createdAt' | 'updatedAt'> & { id?: UUID },
    participantIds?: UUID[]
  ): Promise<MessageChannel> {
    const channel = await this.serverDatabase.createChannel(data);
    // Convert Channel to MessageChannel
    const messageChannel: MessageChannel = {
      ...channel,
      id: channel.id as UUID,
      type: channel.type as ChannelType,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };

    // Add participants if provided
    if (participantIds && participantIds.length > 0) {
      for (const participantId of participantIds) {
        await this.serverDatabase.addParticipantToChannel(channel.id, participantId);
      }
    }

    return messageChannel;
  }

  async addParticipantsToChannel(channelId: UUID, userIds: UUID[]): Promise<void> {
    for (const userId of userIds) {
      await this.serverDatabase.addParticipantToChannel(channelId, userId);
    }
  }

  async getChannelsForServer(serverId: UUID): Promise<MessageChannel[]> {
    const channels = await this.serverDatabase.getChannelsForServer(serverId);
    return channels.map((channel) => ({
      ...channel,
      id: channel.id as UUID,
      type: channel.type as ChannelType,
    }));
  }

  async getChannelDetails(channelId: UUID): Promise<MessageChannel | null> {
    const channel = await this.serverDatabase.getChannelDetails(channelId);
    if (!channel) {
      return null;
    }
    return {
      ...channel,
      id: channel.id as UUID,
      type: channel.type as ChannelType,
    };
  }

  async getChannelParticipants(channelId: UUID): Promise<UUID[]> {
    return this.serverDatabase.getParticipantsForChannel(channelId);
  }

  async deleteMessage(messageId: UUID): Promise<void> {
    return this.serverDatabase.deleteMessage(messageId);
  }

  async updateChannel(
    channelId: UUID,
    updates: {
      name?: string;
      participantCentralUserIds?: UUID[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<MessageChannel> {
    const channel = await this.serverDatabase.updateChannel(channelId, updates);
    return {
      ...channel,
      id: channel.id as UUID,
      type: channel.type as ChannelType,
    };
  }

  async deleteChannel(channelId: UUID): Promise<void> {
    return this.serverDatabase.deleteChannel(channelId);
  }

  async clearChannelMessages(channelId: UUID): Promise<void> {
    // Get all messages for the channel and delete them one by one
    const messages = await this.serverDatabase.getMessagesForChannel(channelId, 1000);
    for (const message of messages) {
      await this.serverDatabase.deleteMessage(message.id as UUID);
    }
    logger.info(`[AgentServer] Cleared all messages for central channel: ${channelId}`);
  }

  async findOrCreateCentralDmChannel(
    user1Id: UUID,
    user2Id: UUID,
    serverId: UUID
  ): Promise<MessageChannel> {
    const channel = await this.serverDatabase.findOrCreateDmChannel(user1Id, user2Id, serverId);
    return {
      ...channel,
      id: channel.id as UUID,
      type: channel.type as ChannelType,
    };
  }

  async createMessage(
    data: Omit<CentralRootMessage, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CentralRootMessage> {
    const createdMessage = await this.serverDatabase.createMessage(data);

    // Convert Message to CentralRootMessage
    const centralMessage: CentralRootMessage = {
      ...createdMessage,
      id: createdMessage.id as UUID,
      channelId: createdMessage.channelId as UUID,
      authorId: createdMessage.authorId as UUID,
      inReplyToRootMessageId: createdMessage.inReplyToRootMessageId as UUID | undefined,
    };

    // Get the channel details to find the server ID
    const channel = await this.getChannelDetails(centralMessage.channelId);
    if (channel) {
      // Emit to internal message bus for agent consumption
      const messageForBus: MessageServiceStructure = {
        id: centralMessage.id,
        channel_id: centralMessage.channelId,
        server_id: channel.serverId,
        author_id: centralMessage.authorId,
        author_display_name: String(
          centralMessage.metadata?.user_display_name ||
            centralMessage.metadata?.authorName ||
            'User'
        ),
        content: centralMessage.content,
        raw_message: centralMessage.rawMessage,
        source_id: centralMessage.sourceId,
        source_type: centralMessage.sourceType,
        in_reply_to_message_id: centralMessage.inReplyToRootMessageId,
        created_at: centralMessage.createdAt.getTime(),
        metadata: centralMessage.metadata,
      };

      internalMessageBus.emit('new_message', messageForBus);
      logger.info(`[AgentServer] Published message ${centralMessage.id} to internal message bus`);

      // Also broadcast to WebSocket clients if this is from an agent response
      if (
        centralMessage.metadata?.source === 'agent_response' ||
        centralMessage.sourceType?.includes('agent')
      ) {
        this.broadcastToWebSocketClients(
          {
            type: 'agent_message',
            id: centralMessage.id,
            content: centralMessage.content,
            author: centralMessage.metadata?.agentName || 'Agent',
            channel_id: centralMessage.channelId,
            timestamp: centralMessage.createdAt.getTime(),
            source: 'agent_response',
            metadata: centralMessage.metadata,
          },
          centralMessage.channelId
        );
      }
    }

    return centralMessage;
  }

  async getMessagesForChannel(
    channelId: UUID,
    limit: number = 50,
    beforeTimestamp?: Date
  ): Promise<CentralRootMessage[]> {
    const messages = await this.serverDatabase.getMessagesForChannel(
      channelId,
      limit,
      beforeTimestamp ? beforeTimestamp.getTime() : undefined
    );
    return messages.map((message) => ({
      ...message,
      id: message.id as UUID,
      channelId: message.channelId as UUID,
      authorId: message.authorId as UUID,
      inReplyToRootMessageId: message.inReplyToRootMessageId as UUID | undefined,
    }));
  }

  // Optional: Method to remove a participant
  async removeParticipantFromChannel(): Promise<void> {
    // Since we don't have a direct method for this, we'll need to handle it at the channel level
    logger.warn(
      '[AgentServer] Remove participant operation not directly supported in database adapter'
    );
  }

  // ===============================
  // Server-Agent Association Methods
  // ===============================

  /**
   * Add an agent to a server
   * @param {UUID} serverId - The server ID
   * @param {UUID} agentId - The agent ID to add
   */
  async addAgentToServer(serverId: UUID, agentId: UUID): Promise<void> {
    // First, verify the server exists
    const server = await this.getServerById(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    return this.serverDatabase.addAgentToServer(serverId, agentId);
  }

  /**
   * Remove an agent from a server
   * @param {UUID} serverId - The server ID
   * @param {UUID} agentId - The agent ID to remove
   */
  async removeAgentFromServer(serverId: UUID, agentId: UUID): Promise<void> {
    return this.serverDatabase.removeAgentFromServer(serverId, agentId);
  }

  /**
   * Get all agents associated with a server
   * @param {UUID} serverId - The server ID
   * @returns {Promise<UUID[]>} Array of agent IDs
   */
  async getAgentsForServer(serverId: UUID): Promise<UUID[]> {
    return this.serverDatabase.getAgentsForServer(serverId);
  }

  /**
   * Get all servers an agent belongs to
   * @param {UUID} agentId - The agent ID
   * @returns {Promise<UUID[]>} Array of server IDs
   */
  async getServersForAgent(agentId: UUID): Promise<UUID[]> {
    // This method isn't directly supported in the adapter, so we need to implement it differently
    const servers = await this.serverDatabase.getMessageServers();
    const serverIds: UUID[] = [];
    for (const server of servers) {
      const agents = await this.serverDatabase.getAgentsForServer(server.id);
      if (agents.includes(agentId)) {
        serverIds.push(server.id);
      }
    }
    return serverIds;
  }

  /**
   * Registers signal handlers for graceful shutdown.
   * This is called once in the constructor to prevent handler accumulation.
   */
  private registerSignalHandlers(): void {
    const gracefulShutdown = async () => {
      logger.info('Received shutdown signal, initiating graceful shutdown...');

      // Stop all agents first
      logger.debug('Stopping all agents...');
      for (const [id, agent] of this.agents.entries()) {
        try {
          await agent.stop();
          logger.debug(`Stopped agent ${id}`);
        } catch (error) {
          logger.error(`Error stopping agent ${id}:`, error);
        }
      }

      // Close database
      if (this.database) {
        try {
          await this.database.close();
          logger.info('Database closed.');
        } catch (error) {
          logger.error('Error closing database:', error);
        }
      }

      // Close server
      if (this.server) {
        this.server.close(() => {
          logger.success('Server closed successfully');
          process.exit(0);
        });

        // Force close after timeout
        setTimeout(() => {
          logger.error('Could not close connections in time, forcing shutdown');
          process.exit(1);
        }, 5000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    logger.debug('Shutdown handlers registered');
  }
}

// Export loader utilities
export {
  hasValidRemoteUrls,
  jsonToCharacter,
  loadCharacter,
  loadCharacters,
  loadCharactersFromUrl,
  loadCharacterTryPath,
  tryLoadFile,
} from './loader';

// Export types
export * from './types';
