/**
 * REST API Routes for Todo CRUD operations
 *
 * All routes use zod validation with expect/throw patterns.
 * Invalid data causes immediate errors - no silent failures.
 */

import { getNetworkName } from '@jejunetwork/config'
import { Hono } from 'hono'
import type { Address } from 'viem'
import { recoverMessageAddress } from 'viem'
import {
  bulkCompleteSchema,
  bulkDeleteSchema,
  createTodoInputSchema,
  listTodosQuerySchema,
  todoIdSchema,
  updateTodoInputSchema,
  walletAuthHeadersSchema,
} from '../schemas'
import { getTodoService } from '../services/todo'
import { constructAuthMessage, TIMESTAMP_WINDOW_MS } from '../utils'
import {
  expectDefined,
  expectValid,
  sanitizeErrorMessage,
  ValidationError,
} from '../utils/validation'

interface AuthContext {
  Variables: {
    address: Address
  }
}

export function createRESTRoutes(): Hono<AuthContext> {
  const app = new Hono<AuthContext>()
  const todoService = getTodoService()

  // Authentication middleware with strict validation
  app.use('/*', async (c, next) => {
    // Allow unauthenticated for health/docs
    if (c.req.path === '/health' || c.req.path === '/docs') {
      return next()
    }

    // Validate headers with zod
    const headers = {
      'x-jeju-address': c.req.header('x-jeju-address'),
      'x-jeju-timestamp': c.req.header('x-jeju-timestamp'),
      'x-jeju-signature': c.req.header('x-jeju-signature'),
    }

    const validatedHeaders = expectValid(
      walletAuthHeadersSchema,
      headers,
      'Authentication headers',
    )

    // Verify timestamp is recent (within 5 minutes)
    const now = Date.now()
    const timestamp = validatedHeaders['x-jeju-timestamp']
    const timeDiff = Math.abs(now - timestamp)

    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      throw new ValidationError(
        `Timestamp expired: ${timestamp} is ${timeDiff}ms old (max ${TIMESTAMP_WINDOW_MS}ms)`,
      )
    }

    // Verify signature using shared auth message construction
    const message = constructAuthMessage(timestamp)
    const recoveredAddress = await recoverMessageAddress({
      message,
      signature: validatedHeaders['x-jeju-signature'],
    })

    if (
      recoveredAddress.toLowerCase() !==
      validatedHeaders['x-jeju-address'].toLowerCase()
    ) {
      throw new ValidationError(
        `Signature mismatch: recovered ${recoveredAddress}, expected ${validatedHeaders['x-jeju-address']}`,
      )
    }

    c.set('address', validatedHeaders['x-jeju-address'] as Address)
    return next()
  })

  // Error handler for validation errors with sanitized messages
  const networkName = getNetworkName()
  const isLocalnet = networkName === 'localnet' || networkName === 'Jeju'

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.message, code: 'VALIDATION_ERROR' }, 400)
    }

    // Log full error for debugging (server-side only)
    console.error('[REST Error]', err)

    // Return sanitized message to client
    const safeMessage = sanitizeErrorMessage(err, isLocalnet)
    return c.json({ error: safeMessage, code: 'INTERNAL_ERROR' }, 500)
  })

  // List todos with validated query parameters
  app.get('/todos', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )

    const queryParams = {
      completed: c.req.query('completed'),
      priority: c.req.query('priority'),
      search: c.req.query('search'),
    }

    const validatedQuery = expectValid(
      listTodosQuerySchema,
      queryParams,
      'Query parameters',
    )

    const todos = await todoService.listTodos(address, validatedQuery)

    return c.json({ todos, count: todos.length })
  })

  // Create todo with validated input
  app.post('/todos', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const body = await c.req.json()

    const validatedInput = expectValid(
      createTodoInputSchema,
      body,
      'Create todo input',
    )

    const todo = await todoService.createTodo(address, validatedInput)
    return c.json({ todo }, 201)
  })

  // Get todo by ID with validated ID
  app.get('/todos/:id', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const todo = await todoService.getTodo(id, address)
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ todo })
  })

  // Update todo with validated input
  app.patch('/todos/:id', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const body = await c.req.json()
    const validatedInput = expectValid(
      updateTodoInputSchema,
      body,
      'Update todo input',
    )

    const todo = await todoService.updateTodo(id, address, validatedInput)
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ todo })
  })

  // Delete todo with validated ID
  app.delete('/todos/:id', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const deleted = await todoService.deleteTodo(id, address)
    if (!deleted) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ success: true })
  })

  // Encrypt todo with validated ID
  app.post('/todos/:id/encrypt', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const todo = await todoService.encryptTodo(id, address)
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ todo, encrypted: true })
  })

  // Decrypt todo with validated ID
  app.post('/todos/:id/decrypt', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const todo = await todoService.decryptTodo(id, address)
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ todo, decrypted: true })
  })

  // Upload attachment with validated ID and file
  app.post('/todos/:id/attach', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const id = expectValid(todoIdSchema, c.req.param('id'), 'Todo ID')

    const contentType = c.req.header('content-type')
    const isMultipart = contentType?.includes('multipart/form-data')
    let data: Uint8Array

    if (isMultipart) {
      const formData = await c.req.formData()
      const file = formData.get('file')

      if (!file || !(file instanceof File)) {
        throw new ValidationError(
          'File is required in multipart/form-data request',
        )
      }

      data = new Uint8Array(await file.arrayBuffer())
    } else {
      const arrayBuffer = await c.req.arrayBuffer()
      if (arrayBuffer.byteLength === 0) {
        throw new ValidationError('File data cannot be empty')
      }
      data = new Uint8Array(arrayBuffer)
    }

    const todo = await todoService.attachFile(id, address, data)
    if (!todo) {
      return c.json({ error: 'Todo not found' }, 404)
    }

    return c.json({ todo, attachmentCid: todo.attachmentCid })
  })

  // Get statistics with validated address
  app.get('/stats', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const stats = await todoService.getStats(address)
    return c.json({ stats })
  })

  // Bulk complete with validated input
  app.post('/todos/bulk/complete', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const body = await c.req.json()

    const validatedInput = expectValid(
      bulkCompleteSchema,
      body,
      'Bulk complete input',
    )

    const results = await todoService.bulkComplete(validatedInput.ids, address)
    return c.json({ completed: results.length, todos: results })
  })

  // Bulk delete with validated input
  app.post('/todos/bulk/delete', async (c) => {
    const address = expectDefined(
      c.get('address'),
      'Address must be set by auth middleware',
    )
    const body = await c.req.json()

    const validatedInput = expectValid(
      bulkDeleteSchema,
      body,
      'Bulk delete input',
    )

    const count = await todoService.bulkDelete(validatedInput.ids, address)
    return c.json({ deleted: count })
  })

  return app
}
