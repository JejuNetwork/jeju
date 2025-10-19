import { logger, validateUuid, type IAgentRuntime, type UUID } from '@elizaos/core';
import express from 'express';
import multer from 'multer';
import type { AgentServer } from '../../server';
import { AgentExportService } from '../../services/AgentExportService';
import { AgentImportService } from '../../services/AgentImportService';
import { sendError, sendSuccess } from '../shared/response-utils';

// Configure multer for ZIP file uploads
const storage = multer.memoryStorage();
const uploadZip = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.endsWith('.zip')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

/**
 * Creates router for agent export/import functionality
 */
export function createAgentPortabilityRouter(
  agents: Map<UUID, IAgentRuntime>,
  serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  /**
   * Export agent data to ZIP file
   * @route POST /agents/:agentId/export
   */
  router.post('/:agentId/export', async (req, res) => {
    const { agentId } = req.params;

    try {
      // Validate agent ID
      if (!validateUuid(agentId)) {
        return sendError(res, 400, 'INVALID_AGENT_ID', 'Invalid agent ID format');
      }

      // Check if agent exists
      const runtime = agents.get(agentId as UUID);
      if (!runtime) {
        return sendError(res, 404, 'AGENT_NOT_FOUND', 'Agent not found');
      }

      // Create export service
      const exportService = new AgentExportService(agentId as UUID, runtime, serverInstance);

      try {
        // Export to ZIP stream
        const zipStream = await exportService.exportToZip({
          includeFiles: true,
          compress: true,
        });

        // Set response headers
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `agent-export-${agentId}-${timestamp}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Agent-Id', agentId);

        // Stream the ZIP file to the client
        zipStream.pipe(res);

        // Clean up after stream ends
        zipStream.on('end', async () => {
          await exportService.cleanup();
        });
      } catch (error) {
        await exportService.cleanup();
        throw error;
      }
    } catch (error) {
      logger.error('[AgentPortability] Export failed:', error);
      return sendError(res, 500, 'EXPORT_FAILED', 'Failed to export agent data');
    }
  });

  /**
   * Import agent data from ZIP file
   * @route POST /agents/:agentId/import
   */
  router.post('/:agentId/import', uploadZip.single('archive') as any, async (req, res) => {
    const { agentId } = req.params;

    try {
      // Validate agent ID
      if (!validateUuid(agentId)) {
        return sendError(res, 400, 'INVALID_AGENT_ID', 'Invalid agent ID format');
      }

      // Check if file was uploaded
      if (!req.file) {
        return sendError(res, 400, 'NO_FILE', 'No ZIP file provided');
      }

      // Parse options from request
      const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
      const skipValidation = req.body.skipValidation === 'true' || req.body.skipValidation === true;

      // Show warning if not overwriting and agent exists
      if (!overwrite) {
        const existingAgent = agents.get(agentId as UUID);
        if (existingAgent) {
          return sendError(
            res,
            409,
            'AGENT_EXISTS',
            'Agent already exists. Set overwrite=true to replace existing agent data.'
          );
        }
      }

      // Create import service
      const importService = new AgentImportService(agentId as UUID, serverInstance);

      try {
        // Import from ZIP buffer
        const result = await importService.importFromZip(req.file.buffer, {
          overwrite,
          validateManifest: !skipValidation,
        });

        // If import was successful and agent was running, restart it
        if (result.success && overwrite) {
          const runtime = agents.get(agentId as UUID);
          if (runtime) {
            logger.info(`[AgentPortability] Reloading agent ${agentId} after import`);
            // TODO: Implement agent reload functionality
            // This would involve stopping the current runtime and starting a new one
            // with the imported data
          }
        }

        await importService.cleanup();

        return sendSuccess(res, {
          message: 'Agent imported successfully',
          result,
        });
      } catch (error) {
        await importService.cleanup();
        throw error;
      }
    } catch (error) {
      logger.error('[AgentPortability] Import failed:', error);

      // Provide more specific error messages
      if (error instanceof Error) {
        if (error.message.includes('ZIP file too large')) {
          return sendError(res, 413, 'FILE_TOO_LARGE', error.message);
        }
        if (error.message.includes('Invalid export') || error.message.includes('manifest')) {
          return sendError(res, 400, 'INVALID_ARCHIVE', error.message);
        }
        if (error.message.includes('Unsupported export version')) {
          return sendError(res, 400, 'VERSION_MISMATCH', error.message);
        }
      }

      return sendError(res, 500, 'IMPORT_FAILED', 'Failed to import agent data');
    }
  });

  /**
   * Validate a ZIP file without importing
   * @route POST /agents/:agentId/import/validate
   */
  router.post('/:agentId/import/validate', uploadZip.single('archive') as any, async (req, res) => {
    const { agentId } = req.params;

    try {
      // Validate agent ID
      if (!validateUuid(agentId)) {
        return sendError(res, 400, 'INVALID_AGENT_ID', 'Invalid agent ID format');
      }

      // Check if file was uploaded
      if (!req.file) {
        return sendError(res, 400, 'NO_FILE', 'No ZIP file provided');
      }

      // Create import service for validation only
      const importService = new AgentImportService(agentId as UUID, serverInstance);

      try {
        // Use a custom validation-only method
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(req.file.buffer);

        // Check manifest
        const manifestEntry = zip.getEntry('manifest.json');
        if (!manifestEntry) {
          throw new Error('Invalid export: manifest.json not found');
        }

        const manifest = JSON.parse(zip.readAsText(manifestEntry));

        // Validate structure
        const validationResult = {
          valid: true,
          manifest,
          errors: [] as string[],
          warnings: [] as string[],
        };

        // Check version compatibility
        if (manifest.version !== '1.0.0') {
          validationResult.warnings.push(
            `Export version ${manifest.version} may not be fully compatible`
          );
        }

        // Check for all expected files
        const expectedFiles = [
          'database/agent.json',
          'database/entities.json',
          'database/worlds.json',
          'database/rooms.json',
          'database/participants.json',
          'database/memories.json',
          'database/relationships.json',
          'database/tasks.json',
          'database/server_agents.json',
        ];

        for (const file of expectedFiles) {
          if (!zip.getEntry(file)) {
            validationResult.warnings.push(`Missing file: ${file}`);
          }
        }

        await importService.cleanup();

        return sendSuccess(res, {
          message: 'ZIP file validation complete',
          result: validationResult,
        });
      } catch (error) {
        await importService.cleanup();
        throw error;
      }
    } catch (error) {
      logger.error('[AgentPortability] Validation failed:', error);
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        error instanceof Error ? error.message : 'Validation failed'
      );
    }
  });

  return router;
}
