#!/usr/bin/env bun
/**
 * Convert JPEG images to proper PNG format using sharp
 */
import sharp from "sharp";
import { readdir } from "fs/promises";
import { join } from "path";

const ICON_DIR = "./apps/vpn/src-tauri/icons";

async function main() {
  const files = await readdir(ICON_DIR);
  const pngFiles = files.filter(f => f.endsWith(".png") && !f.startsWith("tmp_"));

  for (const file of pngFiles) {
    const path = join(ICON_DIR, file);
    console.log(`Converting ${file}...`);
    
    const buffer = await sharp(path)
      .png()
      .toBuffer();
    
    await Bun.write(path, buffer);
  }

  console.log("\nAll icons converted to PNG format.");
}

main().catch(console.error);

