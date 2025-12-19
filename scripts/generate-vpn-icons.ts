#!/usr/bin/env bun
/**
 * Generate VPN app icons using fal.ai
 */

import * as fal from "@fal-ai/serverless-client";

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) throw new Error("FAL_KEY not set");

fal.config({ credentials: FAL_KEY });

const ICON_DIR = "./apps/vpn/src-tauri/icons";

interface FalResponse {
  images: Array<{ url: string }>;
}

async function generateIcon(prompt: string, filename: string, size: number = 512) {
  console.log(`Generating ${filename}...`);
  
  const result = await fal.subscribe("fal-ai/flux/schnell", {
    input: {
      prompt: `${prompt}. Minimal flat icon design, centered, solid background, no text, clean vector style, app icon`,
      image_size: { width: size, height: size },
      num_images: 1,
    },
  }) as FalResponse;

  const imageUrl = result.images[0].url;
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  
  await Bun.write(`${ICON_DIR}/${filename}`, buffer);
  console.log(`  Saved ${filename}`);
  
  return buffer;
}

async function main() {
  // Ensure icons directory exists
  await Bun.write(`${ICON_DIR}/.gitkeep`, "");
  
  console.log("Generating VPN icons with fal.ai...\n");

  // Main icon - Shield with network/globe
  await generateIcon(
    "A modern shield icon with a glowing green network globe inside, cybersecurity VPN app icon, dark background #0a0a0f, neon green accent #00ff88, futuristic minimal design",
    "icon.png",
    512
  );

  // Connected state - Green shield
  await generateIcon(
    "A shield icon with checkmark, glowing bright green #00ff88, connected secure status, VPN protected icon, dark background, minimal",
    "icon-connected.png",
    512
  );

  // Disconnected state - Gray shield
  await generateIcon(
    "A shield icon, gray/muted colors, disconnected status, VPN unprotected icon, dark background #0a0a0f, minimal outline style",
    "icon-disconnected.png",
    512
  );

  // Generate different sizes from main icon
  const sizes = [32, 128, 256];
  for (const size of sizes) {
    await generateIcon(
      "A modern shield icon with a glowing green network globe inside, cybersecurity VPN app icon, dark background #0a0a0f, neon green accent #00ff88",
      size === 256 ? "128x128@2x.png" : `${size}x${size}.png`,
      size
    );
  }

  console.log("\nIcons generated successfully.");
  console.log("Note: For .icns (macOS) and .ico (Windows), use tauri icon command:");
  console.log("  cd apps/vpn && bunx tauri icon src-tauri/icons/icon.png");
}

main().catch(console.error);


