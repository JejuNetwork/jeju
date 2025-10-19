import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { isCodeGenerationService } from '../types';

interface FileInfo {
  path: string;
  lines: number;
  size: number;
}

interface ProjectInfo {
  name: string;
  path: string;
  files: FileInfo[];
  totalLines: number;
  totalSize: number;
  structure: string;
}

/**
 * Provider that exposes current project context including file listings and line counts
 */
export const currentProjectProvider: Provider = {
  name: 'CURRENT_PROJECT_CONTEXT',
  description:
    'Provides context about the current project being worked on, including file structure and line counts',
  dynamic: true,

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<ProviderResult> => {
    // Get the code generation service to access current project
    const codeGenService = runtime.getService('code-generation');
    if (!isCodeGenerationService(codeGenService)) {
      return {
        text: 'No active project. Code generation service is not available.',
        values: {},
        data: {},
      };
    }

    // Get current project path from service or state
    const currentProjectPath = runtime.getSetting('CURRENT_PROJECT_PATH');
    if (!currentProjectPath) {
      return {
        text: 'No active project.',
        values: {},
        data: {},
      };
    }

    
      const projectInfo = await getProjectInfo(currentProjectPath);

      let contextText = `[CURRENT PROJECT]\n`;
      contextText += `Name: ${projectInfo.name}\n`;
      contextText += `Path: ${projectInfo.path}\n`;
      contextText += `Total Files: ${projectInfo.files.length}\n`;
      contextText += `Total Lines: ${projectInfo.totalLines.toLocaleString()}\n`;
      contextText += `Total Size: ${formatBytes(projectInfo.totalSize)}\n\n`;

      contextText += `[FILE STRUCTURE]\n${projectInfo.structure}\n\n`;

      contextText += `[FILE DETAILS]\n`;
      projectInfo.files
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 20) // Show top 20 files by line count
        .forEach((file) => {
          contextText += `${file.path}: ${file.lines} lines (${formatBytes(file.size)})\n`;
        });

      return {
        text: contextText,
        values: {
          projectName: projectInfo.name,
          projectPath: projectInfo.path,
          totalFiles: projectInfo.files.length,
          totalLines: projectInfo.totalLines,
          totalSize: projectInfo.totalSize,
        },
        data: projectInfo,
      };
    } catch (error) {
      return {
        text: `Error analyzing project: ${error}`,
        values: {},
        data: {},
      };
    }
  },
};

async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
  const projectName = path.basename(projectPath);
  const files: FileInfo[] = [];

  // Get all files recursively
  async function scanDirectory(dir: string, baseDir: string = dir): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip common directories to ignore
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) {
          continue;
        }
        await scanDirectory(fullPath, baseDir);
      } else if (entry.isFile()) {
        // Skip common files to ignore
        if (entry.name.startsWith('.') && !entry.name.match(/\.(ts|js|json|md)$/)) {
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n').length;

          files.push({
            path: relativePath,
            lines,
            size: stats.size,
          });
        
      }
    }
  }

  await scanDirectory(projectPath);

  // Generate tree structure using the tree command if available
  let structure = '';
  try {
    structure = execSync(`tree -I 'node_modules|.git|dist|build|coverage' -L 3 "${projectPath}"`, {
      encoding: 'utf-8',
    });
  } catch {
    // Fallback to simple listing if tree is not available
    structure = files
      .map((f) => f.path)
      .sort()
      .join('\n');
  }

  const totalLines = files.reduce((sum, file) => sum + file.lines, 0);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return {
    name: projectName,
    path: projectPath,
    files,
    totalLines,
    totalSize,
    structure,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
