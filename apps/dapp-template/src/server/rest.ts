/**
 * REST API Routes for Todo CRUD operations
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import { verifyMessage } from 'ethers';
import { getTodoService } from '../services/todo';
import type { CreateTodoInput, UpdateTodoInput, Todo } from '../types';

interface AuthContext {
  Variables: {
    address: Address;
  };
}

export function createRESTRoutes(): Hono<AuthContext> {
  const app = new Hono<AuthContext>();
  const todoService = getTodoService();

  // Authentication middleware
  app.use('/*', async (c, next) => {
    const address = c.req.header('x-jeju-address');
    const timestamp = c.req.header('x-jeju-timestamp');
    const signature = c.req.header('x-jeju-signature');

    // Allow unauthenticated for health/docs
    if (c.req.path === '/health' || c.req.path === '/docs') {
      return next();
    }

    if (!address || !timestamp || !signature) {
      return c.json({ error: 'Authentication required', details: 'Missing x-jeju-address, x-jeju-timestamp, or x-jeju-signature headers' }, 401);
    }

    // Verify timestamp is recent (within 5 minutes)
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return c.json({ error: 'Invalid timestamp', details: 'Timestamp must be within 5 minutes' }, 401);
    }

    // Verify signature
    const message = `jeju-todo:${timestamp}`;
    const recoveredAddress = verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    c.set('address', address as Address);
    return next();
  });

  // List todos
  app.get('/todos', async (c) => {
    const address = c.get('address');
    const completed = c.req.query('completed');
    const priority = c.req.query('priority') as 'low' | 'medium' | 'high' | undefined;
    const search = c.req.query('search');

    const todos = await todoService.listTodos(address, {
      completed: completed ? completed === 'true' : undefined,
      priority,
      search,
    });

    return c.json({ todos, count: todos.length });
  });

  // Create todo
  app.post('/todos', async (c) => {
    const address = c.get('address');
    const body = await c.req.json() as CreateTodoInput;

    if (!body.title || body.title.trim().length === 0) {
      return c.json({ error: 'Title is required' }, 400);
    }

    const todo = await todoService.createTodo(address, body);
    return c.json({ todo }, 201);
  });

  // Get todo by ID
  app.get('/todos/:id', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');

    const todo = await todoService.getTodo(id, address);
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ todo });
  });

  // Update todo
  app.patch('/todos/:id', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');
    const body = await c.req.json() as UpdateTodoInput;

    const todo = await todoService.updateTodo(id, address, body);
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ todo });
  });

  // Delete todo
  app.delete('/todos/:id', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');

    const deleted = await todoService.deleteTodo(id, address);
    if (!deleted) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ success: true });
  });

  // Encrypt todo
  app.post('/todos/:id/encrypt', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');

    const todo = await todoService.encryptTodo(id, address);
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ todo, encrypted: true });
  });

  // Decrypt todo
  app.post('/todos/:id/decrypt', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');

    const todo = await todoService.decryptTodo(id, address);
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ todo, decrypted: true });
  });

  // Upload attachment
  app.post('/todos/:id/attach', async (c) => {
    const address = c.get('address');
    const id = c.req.param('id');
    
    const contentType = c.req.header('content-type') || '';
    let data: Uint8Array;

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file') as File;
      if (!file) {
        return c.json({ error: 'No file provided' }, 400);
      }
      data = new Uint8Array(await file.arrayBuffer());
    } else {
      data = new Uint8Array(await c.req.arrayBuffer());
    }

    const todo = await todoService.attachFile(id, address, data);
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404);
    }

    return c.json({ todo, attachmentCid: todo.attachmentCid });
  });

  // Get statistics
  app.get('/stats', async (c) => {
    const address = c.get('address');
    const stats = await todoService.getStats(address);
    return c.json({ stats });
  });

  // Bulk operations
  app.post('/todos/bulk/complete', async (c) => {
    const address = c.get('address');
    const { ids } = await c.req.json() as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array required' }, 400);
    }

    const results = await todoService.bulkComplete(ids, address);
    return c.json({ completed: results.length, todos: results });
  });

  app.post('/todos/bulk/delete', async (c) => {
    const address = c.get('address');
    const { ids } = await c.req.json() as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array required' }, 400);
    }

    const count = await todoService.bulkDelete(ids, address);
    return c.json({ deleted: count });
  });

  return app;
}
