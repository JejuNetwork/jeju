/**
 * Hardware detection tests
 */

import { describe, expect, test } from 'bun:test'
import {
  detectCpu,
  detectDocker,
  detectGpus,
  detectHardware,
  detectMemory,
  detectTee,
  getComputeCapabilities,
  type HardwareInfo,
  meetsRequirements,
  NON_TEE_WARNING,
  type ServiceRequirements,
} from './hardware'

describe('Hardware Detection', () => {
  test('detectCpu returns valid CPU info', () => {
    const cpu = detectCpu()
    expect(cpu.name).toBeDefined()
    expect(cpu.coresPhysical).toBeGreaterThan(0)
    expect(cpu.coresLogical).toBeGreaterThanOrEqual(cpu.coresPhysical)
    expect(cpu.frequencyMhz).toBeGreaterThan(0)
    expect(cpu.architecture).toBeDefined()
    expect(typeof cpu.estimatedFlops).toBe('number')
    expect(typeof cpu.supportsAvx).toBe('boolean')
    expect(typeof cpu.supportsAvx2).toBe('boolean')
    expect(typeof cpu.supportsAvx512).toBe('boolean')
  })

  test('detectMemory returns valid memory info', () => {
    const memory = detectMemory()
    expect(memory.totalMb).toBeGreaterThan(0)
    expect(memory.availableMb).toBeLessThanOrEqual(memory.totalMb)
    expect(memory.usagePercent).toBeGreaterThanOrEqual(0)
    expect(memory.usagePercent).toBeLessThanOrEqual(100)
  })

  test('detectGpus returns array with detailed info', () => {
    const gpus = detectGpus()
    expect(Array.isArray(gpus)).toBe(true)

    // If we have GPUs, check the detailed fields
    if (gpus.length > 0) {
      const gpu = gpus[0]
      expect(gpu.index).toBeDefined()
      expect(gpu.name).toBeDefined()
      expect(gpu.vendor).toBe('NVIDIA')
      expect(gpu.memoryTotalMb).toBeGreaterThan(0)
      expect(gpu.memoryFreeMb).toBeGreaterThanOrEqual(0)
      expect(typeof gpu.suitableForInference).toBe('boolean')
      expect(typeof gpu.tensorCores).toBe('boolean')
      expect(typeof gpu.estimatedTflops).toBe('number')
      expect(gpu.estimatedTflops).toBeGreaterThan(0)

      console.log(
        `GPU detected: ${gpu.name}, ${gpu.memoryTotalMb}MB VRAM, ${gpu.estimatedTflops.toFixed(1)} TFLOPS`,
      )
    } else {
      console.log('No NVIDIA GPUs detected')
    }
  })

  test('detectTee returns valid TEE info', () => {
    const tee = detectTee()
    expect(typeof tee.hasIntelTdx).toBe('boolean')
    expect(typeof tee.hasIntelSgx).toBe('boolean')
    expect(typeof tee.hasAmdSev).toBe('boolean')
    expect(typeof tee.hasNvidiaCc).toBe('boolean')
    expect(typeof tee.attestationAvailable).toBe('boolean')
  })

  test('detectDocker returns valid Docker info', () => {
    const docker = detectDocker()
    expect(typeof docker.available).toBe('boolean')
    expect(typeof docker.runtimeAvailable).toBe('boolean')
    expect(typeof docker.gpuSupport).toBe('boolean')
    expect(Array.isArray(docker.images)).toBe(true)

    if (docker.available) {
      expect(docker.version).not.toBeNull()
      console.log(
        `Docker ${docker.version} detected, runtime: ${docker.runtimeAvailable ? 'running' : 'stopped'}, GPU: ${docker.gpuSupport}`,
      )
    } else {
      console.log('Docker not installed')
    }
  })

  test('detectHardware returns complete info', () => {
    const hardware = detectHardware()
    expect(hardware.os).toBeDefined()
    expect(hardware.osVersion).toBeDefined()
    expect(hardware.hostname).toBeDefined()
    expect(hardware.cpu).toBeDefined()
    expect(hardware.memory).toBeDefined()
    expect(hardware.gpus).toBeDefined()
    expect(hardware.tee).toBeDefined()
    expect(hardware.docker).toBeDefined()
  })
})

describe('Compute Capabilities', () => {
  test('getComputeCapabilities analyzes hardware correctly', () => {
    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    expect(typeof capabilities.cpuCompute.available).toBe('boolean')
    expect(typeof capabilities.cpuCompute.teeAvailable).toBe('boolean')
    expect(typeof capabilities.cpuCompute.estimatedGflops).toBe('number')
    expect(typeof capabilities.cpuCompute.maxConcurrentJobs).toBe('number')

    expect(typeof capabilities.gpuCompute.available).toBe('boolean')
    expect(typeof capabilities.gpuCompute.teeAvailable).toBe('boolean')
    expect(typeof capabilities.gpuCompute.totalVram).toBe('number')
    expect(typeof capabilities.gpuCompute.estimatedTflops).toBe('number')

    expect(Array.isArray(capabilities.warnings)).toBe(true)

    console.log('Compute capabilities:')
    console.log(
      `  CPU: ${capabilities.cpuCompute.available ? 'Available' : 'Not available'}, TEE: ${capabilities.cpuCompute.teeAvailable}`,
    )
    console.log(
      `  GPU: ${capabilities.gpuCompute.available ? 'Available' : 'Not available'}, TEE: ${capabilities.gpuCompute.teeAvailable}`,
    )
    console.log(
      `  Warnings: ${capabilities.warnings.length > 0 ? capabilities.warnings.join(', ') : 'None'}`,
    )
  })

  test('capabilities include non-TEE warnings when no TEE available', () => {
    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    // If no TEE, we should have warnings
    if (!hardware.tee.attestationAvailable) {
      expect(capabilities.warnings.length).toBeGreaterThan(0)
      const hasNonTeeWarning = capabilities.warnings.some(
        (w) => w.includes('non-confidential') || w.includes('TEE'),
      )
      expect(hasNonTeeWarning).toBe(true)
    }
  })

  test('capabilities include Docker warnings when Docker unavailable', () => {
    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    if (!hardware.docker.available) {
      const hasDockerWarning = capabilities.warnings.some((w) =>
        w.toLowerCase().includes('docker'),
      )
      expect(hasDockerWarning).toBe(true)
    } else if (!hardware.docker.runtimeAvailable) {
      const hasDaemonWarning = capabilities.warnings.some(
        (w) =>
          w.toLowerCase().includes('docker') &&
          w.toLowerCase().includes('running'),
      )
      expect(hasDaemonWarning).toBe(true)
    }
  })
})

describe('Requirements Checking', () => {
  test('meetsRequirements passes when hardware is sufficient', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 8,
        coresLogical: 16,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 100,
        supportsAvx: true,
        supportsAvx2: true,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 32768,
        usedMb: 8192,
        availableMb: 24576,
        usagePercent: 25,
      },
      gpus: [],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: true,
        version: '24.0.0',
        runtimeAvailable: true,
        gpuSupport: false,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: false,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test('meetsRequirements fails when CPU is insufficient', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 2,
        coresLogical: 4,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 50,
        supportsAvx: true,
        supportsAvx2: false,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 32768,
        usedMb: 8192,
        availableMb: 24576,
        usagePercent: 25,
      },
      gpus: [],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: true,
        version: '24.0.0',
        runtimeAvailable: true,
        gpuSupport: false,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: false,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(false)
    expect(result.issues.some((i) => i.includes('CPU cores'))).toBe(true)
  })

  test('meetsRequirements fails when memory is insufficient', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 8,
        coresLogical: 16,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 100,
        supportsAvx: true,
        supportsAvx2: true,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 4096,
        usedMb: 2048,
        availableMb: 2048,
        usagePercent: 50,
      },
      gpus: [],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: true,
        version: '24.0.0',
        runtimeAvailable: true,
        gpuSupport: false,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: false,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(false)
    expect(result.issues.some((i) => i.includes('RAM'))).toBe(true)
  })

  test('meetsRequirements fails when GPU is required but insufficient', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 8,
        coresLogical: 16,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 100,
        supportsAvx: true,
        supportsAvx2: true,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 32768,
        usedMb: 8192,
        availableMb: 24576,
        usagePercent: 25,
      },
      gpus: [
        {
          index: 0,
          name: 'GTX 1060',
          vendor: 'NVIDIA',
          memoryTotalMb: 6000,
          memoryFreeMb: 5000,
          suitableForInference: false,
          cudaVersion: '11.0',
          driverVersion: '450.0',
          computeCapability: '6.1',
          tensorCores: false,
          estimatedTflops: 4,
          powerWatts: 120,
          temperatureCelsius: 45,
        },
      ],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: true,
        version: '24.0.0',
        runtimeAvailable: true,
        gpuSupport: true,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: true,
      minGpuMemoryMb: 8000,
      requiresTee: false,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(false)
    expect(result.issues.some((i) => i.includes('GPU memory'))).toBe(true)
  })

  test('meetsRequirements fails when TEE is required but not available', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 8,
        coresLogical: 16,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 100,
        supportsAvx: true,
        supportsAvx2: true,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 32768,
        usedMb: 8192,
        availableMb: 24576,
        usagePercent: 25,
      },
      gpus: [],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: true,
        version: '24.0.0',
        runtimeAvailable: true,
        gpuSupport: false,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: false,
      requiresTee: true,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(false)
    expect(result.issues.some((i) => i.includes('TEE'))).toBe(true)
  })

  test('meetsRequirements fails when Docker is required but not available', () => {
    const hardware: HardwareInfo = {
      os: 'linux',
      osVersion: '5.15.0',
      hostname: 'test',
      cpu: {
        name: 'Test CPU',
        vendor: 'Intel',
        coresPhysical: 8,
        coresLogical: 16,
        frequencyMhz: 3000,
        architecture: 'x64',
        estimatedFlops: 100,
        supportsAvx: true,
        supportsAvx2: true,
        supportsAvx512: false,
      },
      memory: {
        totalMb: 32768,
        usedMb: 8192,
        availableMb: 24576,
        usagePercent: 25,
      },
      gpus: [],
      tee: {
        hasIntelTdx: false,
        hasIntelSgx: false,
        hasAmdSev: false,
        hasNvidiaCc: false,
        attestationAvailable: false,
      },
      docker: {
        available: false,
        version: null,
        runtimeAvailable: false,
        gpuSupport: false,
        images: [],
      },
    }

    const requirements: ServiceRequirements = {
      minCpuCores: 4,
      minMemoryMb: 16384,
      minStorageGb: 100,
      requiresGpu: false,
      requiresTee: false,
      requiresDocker: true,
    }

    const result = meetsRequirements(hardware, requirements)
    expect(result.meets).toBe(false)
    expect(result.issues.some((i) => i.toLowerCase().includes('docker'))).toBe(
      true,
    )
  })
})

describe('Non-TEE Warning', () => {
  test('NON_TEE_WARNING contains required information', () => {
    expect(NON_TEE_WARNING).toContain('NON-CONFIDENTIAL')
    expect(NON_TEE_WARNING.toUpperCase()).toContain('UNENCRYPTED MEMORY')
    expect(NON_TEE_WARNING).toContain('Intel TDX')
    expect(NON_TEE_WARNING).toContain('AMD SEV')
    expect(NON_TEE_WARNING).toContain('NVIDIA Confidential Computing')
  })
})
