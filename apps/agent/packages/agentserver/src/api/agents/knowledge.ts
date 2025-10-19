import type { IAgentRuntime, UUID, KnowledgeItem, IKnowledgeService } from '@elizaos/core';
import { logger, validateUuid } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { sendError, sendSuccess } from '../shared/response-utils';

/**
 * Agent knowledge files management
 */
export function createAgentKnowledgeRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get knowledge files for a specific agent
  router.get('/:agentId/knowledge', async (req, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);
      const runtime = agents.get(agentId);

      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }

      const knowledgeService = runtime.getService('knowledge') as IKnowledgeService | null;
      if (!knowledgeService) {
        return sendSuccess(res, { knowledgeFiles: [] });
      }

      // Get documents from the knowledge service
      const documents = await knowledgeService.getMemories({
        tableName: 'documents',
        count: 100,
        agentId: runtime.agentId,
      });

      // Format documents as knowledge files for consistent API response
      const knowledgeFiles = documents.map((doc: KnowledgeItem) => ({
        id: doc.id,
        name: doc.metadata?.originalFilename || doc.metadata?.title || 'Untitled',
        title: doc.metadata?.title || doc.metadata?.originalFilename || 'Untitled',
        originalFilename: doc.metadata?.originalFilename || 'unknown',
        path: doc.metadata?.path || '',
        size: doc.metadata?.size || doc.metadata?.fileSize || 0,
        type: doc.metadata?.contentType || doc.metadata?.fileType || 'unknown',
        contentType: doc.metadata?.contentType || doc.metadata?.fileType || 'unknown',
        createdAt: new Date(doc.createdAt || doc.metadata?.timestamp || Date.now()).toISOString(),
        updatedAt: new Date(doc.createdAt || doc.metadata?.timestamp || Date.now()).toISOString(),
        fragmentCount: doc.metadata?.fragmentCount || 0,
      }));

      sendSuccess(res, { knowledgeFiles });
    } catch (error) {
      logger.error('[KNOWLEDGE API] Error getting knowledge files:', error);
      sendError(
        res,
        500,
        'KNOWLEDGE_ERROR',
        'Error retrieving knowledge files',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete a knowledge file
  router.delete('/:agentId/knowledge/:fileId', async (req, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);
      const fileId = req.params.fileId;

      const runtime = agents.get(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }

      const knowledgeService = runtime.getService('knowledge') as IKnowledgeService | null;
      if (!knowledgeService) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Knowledge service not available');
      }

      if (!knowledgeService.deleteMemory) {
        return sendError(res, 501, 'NOT_IMPLEMENTED', 'Delete operation not supported');
      }

      // Delete the knowledge document using the service
      await knowledgeService.deleteMemory(fileId);

      logger.info(
        `[KNOWLEDGE API] Deleted knowledge file ${fileId} for agent ${runtime.character.name}`
      );
      sendSuccess(res, { message: `Knowledge file ${fileId} deleted successfully` });
    } catch (error) {
      logger.error('[KNOWLEDGE API] Error deleting knowledge file:', error);
      sendError(
        res,
        500,
        'KNOWLEDGE_DELETE_ERROR',
        'Error deleting knowledge file',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
