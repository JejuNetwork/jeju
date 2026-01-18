#!/usr/bin/env bun
/**
 * Check and install Tauri dependencies on Linux
 * Run automatically during postinstall on Linux machines
 */

import { $ } from 'bun'

const REQUIRED_PACKAGES = {
  'apt-get': [
    'libgtk-3-dev',
    'libwebkit2gtk-4.1-dev',
    'libayatana-appindicator3-dev',
    'librsvg2-dev',
    'patchelf',
  ],
  dnf: [
    'gtk3-devel',
    'webkit2gtk4.1-devel',
    'libappindicator-gtk3-devel',
    'librsvg2-devel',
    'patchelf',
  ],
  pacman: [
    'gtk3',
    'webkit2gtk-4.1',
    'libayatana-appindicator',
    'librsvg',
    'patchelf',
  ],
}

async function getPackageManager(): Promise<keyof typeof REQUIRED_PACKAGES | null> {
  for (const pm of ['apt-get', 'dnf', 'pacman'] as const) {
    const result = await $`which ${pm} 2>/dev/null`.quiet().nothrow()
    if (result.exitCode === 0) return pm
  }
  return null
}

async function checkPkgConfig(lib: string): Promise<boolean> {
  const result = await $`pkg-config --exists ${lib} 2>/dev/null`.quiet().nothrow()
  return result.exitCode === 0
}

async function main() {
  if (process.platform !== 'linux') {
    console.log('Tauri dependency check: Skipping (not Linux)')
    return
  }

  console.log('Checking Tauri dependencies...')

  const libs = ['gtk+-3.0', 'webkit2gtk-4.1', 'ayatana-appindicator3-0.1']
  const missing: string[] = []

  for (const lib of libs) {
    if (!(await checkPkgConfig(lib))) {
      missing.push(lib)
    }
  }

  if (missing.length === 0) {
    console.log('All Tauri dependencies are installed.')
    return
  }

  console.log(`Missing libraries: ${missing.join(', ')}`)

  const pm = await getPackageManager()
  if (!pm) {
    console.log('Could not detect package manager. Install manually if building Tauri:')
    console.log('  Ubuntu/Debian: sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf')
    console.log('  Fedora: sudo dnf install gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel patchelf')
    console.log('  Arch: sudo pacman -S gtk3 webkit2gtk-4.1 libayatana-appindicator librsvg patchelf')
    return
  }

  const packages = REQUIRED_PACKAGES[pm]
  const installCmd = {
    'apt-get': `sudo apt-get update && sudo apt-get install -y ${packages.join(' ')}`,
    dnf: `sudo dnf install -y ${packages.join(' ')}`,
    pacman: `sudo pacman -S --noconfirm ${packages.join(' ')}`,
  }[pm]

  console.log(`\nTo install Tauri dependencies, run:\n`)
  console.log(`  ${installCmd}\n`)

  if (process.env.INSTALL_TAURI_DEPS === '1') {
    console.log('Installing dependencies (INSTALL_TAURI_DEPS=1)...')
    const result = await $`sh -c ${installCmd}`.nothrow()
    if (result.exitCode !== 0) {
      console.log('Failed to install dependencies. You may need to run the command manually with sudo.')
    } else {
      console.log('Dependencies installed successfully.')
    }
  } else {
    console.log('Set INSTALL_TAURI_DEPS=1 to install automatically.')
    console.log('(This is optional - only needed for building the Tauri desktop app)')
  }
}

main().catch(console.error)

