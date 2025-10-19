import { logger } from '@elizaos/core';
import Tesseract from 'tesseract.js';
import type { OCRResult, ScreenTile, BoundingBox } from './types';
import sharp from 'sharp';

export class OCRService {
  private worker: Tesseract.Worker | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Prevent multiple initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    logger.info('[OCR] Initializing Tesseract.js...');

    // Create worker
    this.worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          logger.debug(`[OCR] Progress: ${(m.progress * 100).toFixed(1)}%`);
        }
      },
    });

    this.initialized = true;
    logger.info('[OCR] Tesseract.js initialized successfully');
  }

  async extractText(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    // Preprocess image for better OCR
    const processedBuffer = await this.preprocessImage(imageBuffer);

    // Perform OCR
    const result = await this.worker.recognize(processedBuffer);

    // Convert Tesseract result to our format
    return this.convertTesseractResult(result);
  }

  async extractFromTile(tile: ScreenTile): Promise<OCRResult> {
    if (!tile.data) {
      throw new Error('Tile data is missing');
    }

    return this.extractText(tile.data);
  }

  async extractFromImage(imageBuffer: Buffer): Promise<OCRResult> {
    return this.extractText(imageBuffer);
  }

  private async preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
    // Basic preprocessing to improve OCR accuracy
    const processed = await sharp(imageBuffer).grayscale().normalize().sharpen().toBuffer();

    return processed;
  }

  private convertTesseractResult(result: Tesseract.RecognizeResult): OCRResult {
    const blocks: OCRResult['blocks'] = [];

    // Convert Tesseract blocks to our format
    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        if (block.text.trim()) {
          const blockResult: OCRResult['blocks'][0] = {
            text: block.text.trim(),
            bbox: {
              x: block.bbox.x0,
              y: block.bbox.y0,
              width: block.bbox.x1 - block.bbox.x0,
              height: block.bbox.y1 - block.bbox.y0,
            },
            confidence: block.confidence,
          };

          // Add words if available
          if ('words' in block && Array.isArray(block.words)) {
            blockResult.words = block.words.map((word: any) => ({
              text: word.text,
              bbox: {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0,
              },
              confidence: word.confidence,
            }));
          }

          blocks.push(blockResult);
        }
      }
    }

    return {
      text: result.data.text,
      fullText: result.data.text,
      blocks,
    };
  }

  async extractStructuredData(imageBuffer: Buffer): Promise<{
    tables?: Array<{ rows: string[][]; bbox: BoundingBox }>;
    forms?: Array<{ label: string; value: string; bbox: BoundingBox }>;
    lists?: Array<{ items: string[]; bbox: BoundingBox }>;
  }> {
    const ocrResult = await this.extractText(imageBuffer);

    return {
      tables: this.detectTables(ocrResult),
      forms: this.detectForms(ocrResult),
      lists: this.detectLists(ocrResult),
    };
  }

  private detectTables(ocrResult: OCRResult): Array<{ rows: string[][]; bbox: BoundingBox }> {
    const tables: Array<{ rows: string[][]; bbox: BoundingBox }> = [];

    // Group blocks by vertical position
    const rowGroups = new Map<number, typeof ocrResult.blocks>();
    const tolerance = 10; // pixels

    for (const block of ocrResult.blocks) {
      let foundGroup = false;
      for (const [y, group] of rowGroups) {
        if (Math.abs(block.bbox.y - y) < tolerance) {
          group.push(block);
          foundGroup = true;
          break;
        }
      }
      if (!foundGroup) {
        rowGroups.set(block.bbox.y, [block]);
      }
    }

    // Check if rows form a table structure
    const sortedRows = Array.from(rowGroups.entries()).sort(([a], [b]) => a - b);

    if (sortedRows.length >= 2) {
      // Simple heuristic: if we have multiple aligned rows, it might be a table
      const rows: string[][] = [];
      let minX = Infinity,
        minY = Infinity,
        maxX = 0,
        maxY = 0;

      for (const [_y, blocks] of sortedRows) {
        const sortedBlocks = blocks.sort((a, b) => a.bbox.x - b.bbox.x);
        const row = sortedBlocks.map((b) => b.text);
        rows.push(row);

        // Update bounding box
        for (const block of sortedBlocks) {
          minX = Math.min(minX, block.bbox.x);
          minY = Math.min(minY, block.bbox.y);
          maxX = Math.max(maxX, block.bbox.x + block.bbox.width);
          maxY = Math.max(maxY, block.bbox.y + block.bbox.height);
        }
      }

      if (rows.length > 0) {
        tables.push({
          rows,
          bbox: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          },
        });
      }
    }

    return tables;
  }

  private detectForms(
    ocrResult: OCRResult
  ): Array<{ label: string; value: string; bbox: BoundingBox }> {
    const forms: Array<{ label: string; value: string; bbox: BoundingBox }> = [];

    // Look for label-value pairs
    for (let i = 0; i < ocrResult.blocks.length - 1; i++) {
      const current = ocrResult.blocks[i];
      const next = ocrResult.blocks[i + 1];

      // Check if blocks are on same line and close together
      const sameLine = Math.abs(current.bbox.y - next.bbox.y) < 10;
      const closeX = next.bbox.x - (current.bbox.x + current.bbox.width) < 50;

      if (sameLine && closeX && current.text.endsWith(':')) {
        forms.push({
          label: current.text.replace(':', '').trim(),
          value: next.text.trim(),
          bbox: {
            x: current.bbox.x,
            y: current.bbox.y,
            width: next.bbox.x + next.bbox.width - current.bbox.x,
            height: Math.max(current.bbox.height, next.bbox.height),
          },
        });
      }
    }

    return forms;
  }

  private detectLists(ocrResult: OCRResult): Array<{ items: string[]; bbox: BoundingBox }> {
    const lists: Array<{ items: string[]; bbox: BoundingBox }> = [];
    const listItems: Array<{ text: string; bbox: BoundingBox }> = [];

    // Look for bullet points or numbered lists
    const listPattern = /^[\d•·\-*]+[\s.)\]]/;

    for (const block of ocrResult.blocks) {
      if (listPattern.test(block.text)) {
        listItems.push({
          text: block.text.replace(listPattern, '').trim(),
          bbox: block.bbox,
        });
      }
    }

    if (listItems.length > 0) {
      // Calculate bounding box for entire list
      let minX = Infinity,
        minY = Infinity,
        maxX = 0,
        maxY = 0;
      for (const item of listItems) {
        minX = Math.min(minX, item.bbox.x);
        minY = Math.min(minY, item.bbox.y);
        maxX = Math.max(maxX, item.bbox.x + item.bbox.width);
        maxY = Math.max(maxY, item.bbox.y + item.bbox.height);
      }

      lists.push({
        items: listItems.map((item) => item.text),
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        },
      });
    }

    return lists;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
    this.initPromise = null;
  }
}
