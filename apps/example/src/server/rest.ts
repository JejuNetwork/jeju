import { getNetworkName } from '@jejunetwork/config'
import { Elysia } from 'elysia'
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

const networkName = getNetworkName()
const isLocalnet = networkName === 'localnet' || networkName === 'Jeju'

export function createRESTRoutes(): Elysia {
  const todoService = getTodoService()

  return new Elysia({ prefix: '/api/v1' })
    .onError(({ error, set }) => {
      if (error instanceof ValidationError) {
        set.status = 400
        return { error: error.message, code: 'VALIDATION_ERROR' }
      }

      console.error('[REST Error]', error)
      const safeMessage = sanitizeErrorMessage(error, isLocalnet)
      set.status = 500
      return { error: safeMessage, code: 'INTERNAL_ERROR' }
    })
    .derive(async ({ request, path }) => {
      // Allow unauthenticated for health/docs
      if (path === '/health' || path === '/docs') {
        return { address: undefined as Address | undefined }
      }

      // Validate headers with zod
      const headers = {
        'x-jeju-address': request.headers.get('x-jeju-address'),
        'x-jeju-timestamp': request.headers.get('x-jeju-timestamp'),
        'x-jeju-signature': request.headers.get('x-jeju-signature'),
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

      return { address: validatedHeaders['x-jeju-address'] as Address }
    })
    .get('/todos', async ({ address, query }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )

      const queryParams = {
        completed: query.completed,
        priority: query.priority,
        search: query.search,
      }

      const validatedQuery = expectValid(
        listTodosQuerySchema,
        queryParams,
        'Query parameters',
      )

      const todos = await todoService.listTodos(validAddress, validatedQuery)
      return { todos, count: todos.length }
    })
    .post('/todos', async ({ address, body }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )

      const validatedInput = expectValid(
        createTodoInputSchema,
        body,
        'Create todo input',
      )

      const todo = await todoService.createTodo(validAddress, validatedInput)
      return { todo }
    })
    .get('/todos/:id', async ({ address, params, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const todo = await todoService.getTodo(id, validAddress)
      if (!todo) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { todo }
    })
    .patch('/todos/:id', async ({ address, params, body, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const validatedInput = expectValid(
        updateTodoInputSchema,
        body,
        'Update todo input',
      )

      const todo = await todoService.updateTodo(
        id,
        validAddress,
        validatedInput,
      )
      if (!todo) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { todo }
    })
    .delete('/todos/:id', async ({ address, params, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const deleted = await todoService.deleteTodo(id, validAddress)
      if (!deleted) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { success: true }
    })
    .post('/todos/:id/encrypt', async ({ address, params, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const todo = await todoService.encryptTodo(id, validAddress)
      if (!todo) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { todo, encrypted: true }
    })
    .post('/todos/:id/decrypt', async ({ address, params, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const todo = await todoService.decryptTodo(id, validAddress)
      if (!todo) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { todo, decrypted: true }
    })
    .post('/todos/:id/attach', async ({ address, params, request, set }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const id = expectValid(todoIdSchema, params.id, 'Todo ID')

      const contentType = request.headers.get('content-type')
      const isMultipart = contentType?.includes('multipart/form-data')
      let data: Uint8Array

      if (isMultipart) {
        const formData = await request.formData()
        const file = formData.get('file')

        if (!file || !(file instanceof File)) {
          throw new ValidationError(
            'File is required in multipart/form-data request',
          )
        }

        data = new Uint8Array(await file.arrayBuffer())
      } else {
        const arrayBuffer = await request.arrayBuffer()
        if (arrayBuffer.byteLength === 0) {
          throw new ValidationError('File data cannot be empty')
        }
        data = new Uint8Array(arrayBuffer)
      }

      const todo = await todoService.attachFile(id, validAddress, data)
      if (!todo) {
        set.status = 404
        return { error: 'Todo not found' }
      }

      return { todo, attachmentCid: todo.attachmentCid }
    })
    .get('/stats', async ({ address }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )
      const stats = await todoService.getStats(validAddress)
      return { stats }
    })
    .post('/todos/bulk/complete', async ({ address, body }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )

      const validatedInput = expectValid(
        bulkCompleteSchema,
        body,
        'Bulk complete input',
      )

      const results = await todoService.bulkComplete(
        validatedInput.ids,
        validAddress,
      )
      return { completed: results.length, todos: results }
    })
    .post('/todos/bulk/delete', async ({ address, body }) => {
      const validAddress = expectDefined(
        address,
        'Address must be set by auth middleware',
      )

      const validatedInput = expectValid(
        bulkDeleteSchema,
        body,
        'Bulk delete input',
      )

      const count = await todoService.bulkDelete(
        validatedInput.ids,
        validAddress,
      )
      return { deleted: count }
    })
}
