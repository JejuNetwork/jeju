/**
 * Hardware detection for browser/Node.js environment
 * Profiles CPU, GPU, and Docker capabilities for compute marketplace
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'

export interface CpuInfo {
  name: string
  vendor: string
  coresPhysical: number
  coresLogical: number
  frequencyMhz: number
  architecture: string
  // Compute marketplace fields
  estimatedFlops: number // Estimated GFLOPS
  supportsAvx: boolean
  supportsAvx2: boolean
  supportsAvx512: boolean
}

export interface MemoryInfo {
  totalMb: number
  usedMb: number
  availableMb: number
  usagePercent: number
}

export interface GpuInfo {
  index: number
  name: string
  vendor: string
  memoryTotalMb: number
  memoryFreeMb: number
  suitableForInference: boolean
  // Detailed GPU profiling
  cudaVersion: string | null
  driverVersion: string | null
  computeCapability: string | null
  tensorCores: boolean
  estimatedTflops: number
  powerWatts: number | null
  temperatureCelsius: number | null
}

export interface TeeCapabilities {
  hasIntelTdx: boolean
  hasIntelSgx: boolean
  hasAmdSev: boolean
  hasNvidiaCc: boolean
  attestationAvailable: boolean
}

export interface DockerInfo {
  available: boolean
  version: string | null
  runtimeAvailable: boolean
  gpuSupport: boolean
  images: string[]
}

export interface HardwareInfo {
  os: string
  osVersion: string
  hostname: string
  cpu: CpuInfo
  memory: MemoryInfo
  gpus: GpuInfo[]
  tee: TeeCapabilities
  docker: DockerInfo
}

export type ComputeMode = 'tee' | 'non-tee'
export type ComputeType = 'cpu' | 'gpu' | 'both'

import type { HardwareInfo as HardwareInfoSnake } from '../types'

export interface ComputeCapabilities {
  cpuCompute: {
    available: boolean
    teeAvailable: boolean
    estimatedGflops: number
    maxConcurrentJobs: number
  }
  gpuCompute: {
    available: boolean
    teeAvailable: boolean // NVIDIA CC
    gpus: GpuInfo[]
    totalVram: number
    estimatedTflops: number
  }
  docker: DockerInfo
  warnings: string[]
}

/**
 * Convert snake_case format to camelCase format
 */
export function convertHardwareToCamelCase(
  hw: HardwareInfoSnake,
): HardwareInfo {
  return {
    os: hw.os,
    osVersion: hw.os_version,
    hostname: hw.hostname,
    cpu: {
      name: hw.cpu.name,
      vendor: hw.cpu.vendor,
      coresPhysical: hw.cpu.cores_physical,
      coresLogical: hw.cpu.cores_logical,
      frequencyMhz: hw.cpu.frequency_mhz,
      architecture: hw.cpu.architecture,
      estimatedFlops: 0,
      supportsAvx: false,
      supportsAvx2: false,
      supportsAvx512: false,
    },
    memory: {
      totalMb: hw.memory.total_mb,
      usedMb: hw.memory.used_mb,
      availableMb: hw.memory.available_mb,
      usagePercent: hw.memory.usage_percent,
    },
    gpus: hw.gpus.map((g) => ({
      index: g.index,
      name: g.name,
      vendor: g.vendor,
      memoryTotalMb: g.memory_total_mb,
      memoryFreeMb: g.memory_total_mb - g.memory_used_mb,
      suitableForInference: g.suitable_for_inference,
      cudaVersion: g.cuda_version,
      driverVersion: g.driver_version,
      computeCapability: g.compute_capability,
      tensorCores: false,
      estimatedTflops: 0,
      powerWatts: null,
      temperatureCelsius: g.temperature_celsius,
    })),
    tee: {
      hasIntelTdx: hw.tee.has_intel_tdx,
      hasIntelSgx: hw.tee.has_intel_sgx,
      hasAmdSev: hw.tee.has_amd_sev,
      hasNvidiaCc: hw.tee.has_nvidia_cc,
      attestationAvailable: hw.tee.attestation_available,
    },
    docker: {
      available: hw.docker.available,
      version: hw.docker.version,
      runtimeAvailable: hw.docker.runtime_available,
      gpuSupport: hw.docker.gpu_support,
      images: hw.docker.images,
    },
  }
}

/**
 * Convert hardware.ts camelCase format to types.ts snake_case format
 */
export function convertHardwareToSnakeCase(
  hw: HardwareInfo,
): HardwareInfoSnake {
  return {
    os: hw.os,
    os_version: hw.osVersion,
    hostname: hw.hostname,
    cpu: {
      name: hw.cpu.name,
      vendor: hw.cpu.vendor,
      cores_physical: hw.cpu.coresPhysical,
      cores_logical: hw.cpu.coresLogical,
      frequency_mhz: hw.cpu.frequencyMhz,
      usage_percent: hw.cpu.estimatedFlops > 0 ? 0 : 0,
      architecture: hw.cpu.architecture,
    },
    memory: {
      total_mb: hw.memory.totalMb,
      used_mb: hw.memory.usedMb,
      available_mb: hw.memory.availableMb,
      usage_percent: hw.memory.usagePercent,
    },
    gpus: hw.gpus.map((gpu) => ({
      index: gpu.index,
      name: gpu.name,
      vendor: gpu.vendor,
      memory_total_mb: gpu.memoryTotalMb,
      memory_used_mb: gpu.memoryTotalMb - gpu.memoryFreeMb,
      utilization_percent: 0,
      temperature_celsius: gpu.temperatureCelsius,
      driver_version: gpu.driverVersion,
      cuda_version: gpu.cudaVersion,
      compute_capability: gpu.computeCapability,
      suitable_for_inference: gpu.suitableForInference,
    })),
    storage: [],
    network: [],
    tee: {
      has_intel_tdx: hw.tee.hasIntelTdx,
      has_intel_sgx: hw.tee.hasIntelSgx,
      has_amd_sev: hw.tee.hasAmdSev,
      has_nvidia_cc: hw.tee.hasNvidiaCc,
      attestation_available: hw.tee.attestationAvailable,
      tdx_version: null,
      sgx_version: null,
    },
    docker: {
      available: hw.docker.available,
      version: hw.docker.version,
      runtime_available: hw.docker.runtimeAvailable,
      gpu_support: hw.docker.gpuSupport,
      images: hw.docker.images,
    },
  }
}

function execCommand(cmd: string, timeout = 5000): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

export function detectCpu(): CpuInfo {
  const cpus = os.cpus()
  if (cpus.length === 0) {
    throw new Error('detectCpu: no CPUs detected')
  }
  const firstCpu = cpus[0]
  const coresLogical = cpus.length

  // Detect physical cores more accurately on Linux
  let coresPhysical = Math.ceil(coresLogical / 2)
  const lscpuOutput = execCommand(
    'lscpu 2>/dev/null | grep "Core(s) per socket" | awk \'{print $4}\'',
  )
  const socketsOutput = execCommand(
    'lscpu 2>/dev/null | grep "Socket(s)" | awk \'{print $2}\'',
  )
  if (lscpuOutput !== null && socketsOutput !== null) {
    const cores = parseInt(lscpuOutput, 10)
    const sockets = parseInt(socketsOutput, 10)
    if (!Number.isNaN(cores) && !Number.isNaN(sockets)) {
      coresPhysical = cores * sockets
    }
  }

  // Detect AVX support
  let supportsAvx = false
  let supportsAvx2 = false
  let supportsAvx512 = false

  const cpuFlags = execCommand(
    'cat /proc/cpuinfo 2>/dev/null | grep flags | head -1',
  )
  if (cpuFlags !== null) {
    supportsAvx = cpuFlags.includes(' avx ')
    supportsAvx2 = cpuFlags.includes(' avx2 ')
    supportsAvx512 = cpuFlags.includes('avx512')
  }

  // Get CPU frequency - firstCpu is guaranteed to exist
  const freq = firstCpu.speed > 0 ? firstCpu.speed : 3000
  const opsPerCycle = supportsAvx512
    ? 32
    : supportsAvx2
      ? 16
      : supportsAvx
        ? 8
        : 4
  const estimatedFlops = (coresPhysical * freq * opsPerCycle) / 1000 // GFLOPS

  // Get CPU name - firstCpu is guaranteed to exist
  const cpuModel = firstCpu.model
  const cpuName = cpuModel.length > 0 ? cpuModel : 'Unknown CPU'
  const cpuVendor = cpuModel.includes('Intel')
    ? 'Intel'
    : cpuModel.includes('AMD')
      ? 'AMD'
      : 'Unknown'

  return {
    name: cpuName,
    vendor: cpuVendor,
    coresPhysical,
    coresLogical,
    frequencyMhz: freq,
    architecture: os.arch(),
    estimatedFlops,
    supportsAvx,
    supportsAvx2,
    supportsAvx512,
  }
}

export function detectMemory(): MemoryInfo {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024)
  const freeMb = Math.round(os.freemem() / 1024 / 1024)
  const usedMb = totalMb - freeMb

  return {
    totalMb,
    usedMb,
    availableMb: freeMb,
    usagePercent: (usedMb / totalMb) * 100,
  }
}

export function detectGpus(): GpuInfo[] {
  const gpus: GpuInfo[] = []

  // Detailed NVIDIA GPU detection
  const nvidiaSmiQuery = execCommand(
    'nvidia-smi --query-gpu=index,name,memory.total,memory.free,driver_version,compute_cap,power.draw,temperature.gpu --format=csv,noheader,nounits',
  )

  if (nvidiaSmiQuery) {
    const lines = nvidiaSmiQuery.split('\n').filter((l) => l.trim())

    // Get CUDA version separately
    const cudaVersion = execCommand(
      'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
    )
      ? execCommand(
          "nvcc --version 2>/dev/null | grep release | awk '{print $5}' | tr -d ','",
        )
      : null

    for (const line of lines) {
      const parts = line.split(', ').map((s: string) => s.trim())
      const [index, name, memTotal, memFree, driver, computeCap, power, temp] =
        parts

      if (name) {
        const memoryTotalMb = parseInt(memTotal, 10) || 0
        const computeCapability = computeCap || null

        // Estimate TFLOPS based on GPU model and compute capability
        let estimatedTflops = 0
        let tensorCores = false

        if (name.includes('4090')) {
          estimatedTflops = 82.6
          tensorCores = true
        } else if (name.includes('4080')) {
          estimatedTflops = 48.7
          tensorCores = true
        } else if (name.includes('3090')) {
          estimatedTflops = 35.6
          tensorCores = true
        } else if (name.includes('3080')) {
          estimatedTflops = 29.8
          tensorCores = true
        } else if (name.includes('A100')) {
          estimatedTflops = 312 // Tensor TFLOPS
          tensorCores = true
        } else if (name.includes('H100')) {
          estimatedTflops = 756 // Tensor TFLOPS
          tensorCores = true
        } else if (computeCapability && parseFloat(computeCapability) >= 7.0) {
          // Volta and newer have tensor cores
          tensorCores = true
          estimatedTflops = memoryTotalMb / 500 // Very rough estimate
        } else {
          estimatedTflops = memoryTotalMb / 1000 // Very rough estimate
        }

        gpus.push({
          index: parseInt(index, 10),
          name,
          vendor: 'NVIDIA',
          memoryTotalMb,
          memoryFreeMb: parseInt(memFree, 10) || 0,
          suitableForInference: memoryTotalMb >= 4000, // 4GB minimum for basic inference
          cudaVersion,
          driverVersion: driver || null,
          computeCapability,
          tensorCores,
          estimatedTflops,
          powerWatts: power && power !== '[N/A]' ? parseFloat(power) : null,
          temperatureCelsius:
            temp && temp !== '[N/A]' ? parseInt(temp, 10) : null,
        })
      }
    }
  }

  return gpus
}

export function detectTee(): TeeCapabilities {
  const caps: TeeCapabilities = {
    hasIntelTdx: false,
    hasIntelSgx: false,
    hasAmdSev: false,
    hasNvidiaCc: false,
    attestationAvailable: false,
  }

  if (os.platform() !== 'linux') {
    return caps
  }

  // Check for Intel TDX
  if (existsSync('/dev/tdx_guest') || existsSync('/dev/tdx-guest')) {
    caps.hasIntelTdx = true
    caps.attestationAvailable = true
  }

  // Check for Intel SGX
  if (existsSync('/dev/sgx_enclave') || existsSync('/dev/isgx')) {
    caps.hasIntelSgx = true
    caps.attestationAvailable = true
  }

  // Check for AMD SEV
  if (existsSync('/dev/sev') || existsSync('/dev/sev-guest')) {
    caps.hasAmdSev = true
    caps.attestationAvailable = true
  }

  // Check for NVIDIA Confidential Computing
  const nvCcCheck = execCommand(
    'nvidia-smi --query-gpu=cc_mode --format=csv,noheader 2>/dev/null',
  )
  if (nvCcCheck?.includes('on')) {
    caps.hasNvidiaCc = true
    caps.attestationAvailable = true
  }

  return caps
}

export function detectDocker(): DockerInfo {
  const info: DockerInfo = {
    available: false,
    version: null,
    runtimeAvailable: false,
    gpuSupport: false,
    images: [],
  }

  // Check Docker version
  const dockerVersion = execCommand('docker --version 2>/dev/null')
  if (dockerVersion) {
    info.available = true
    const match = dockerVersion.match(/Docker version (\d+\.\d+\.\d+)/)
    if (match) {
      info.version = match[1]
    }

    // Check if Docker daemon is running
    const dockerInfo = execCommand('docker info 2>/dev/null')
    if (dockerInfo) {
      info.runtimeAvailable = true

      // Check for NVIDIA runtime
      if (dockerInfo.includes('nvidia')) {
        info.gpuSupport = true
      }
    }

    // Check for nvidia-docker/nvidia-container-toolkit
    const nvidiaDocker = execCommand(
      'docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi 2>/dev/null',
    )
    if (nvidiaDocker) {
      info.gpuSupport = true
    }

    // List relevant images
    const imageList = execCommand(
      'docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -E "(ollama|vllm|llama|jeju)" | head -10',
    )
    if (imageList) {
      info.images = imageList.split('\n').filter((i) => i.trim())
    }
  }

  return info
}

export function detectHardware(): HardwareInfo {
  return {
    os: os.platform(),
    osVersion: os.release(),
    hostname: os.hostname(),
    cpu: detectCpu(),
    memory: detectMemory(),
    gpus: detectGpus(),
    tee: detectTee(),
    docker: detectDocker(),
  }
}

export function getComputeCapabilities(
  hardware: HardwareInfo,
): ComputeCapabilities {
  const warnings: string[] = []

  // CPU Compute
  const cpuCompute = {
    available:
      hardware.cpu.coresPhysical >= 2 && hardware.memory.totalMb >= 4096,
    teeAvailable:
      hardware.tee.hasIntelTdx ||
      hardware.tee.hasIntelSgx ||
      hardware.tee.hasAmdSev,
    estimatedGflops: hardware.cpu.estimatedFlops,
    maxConcurrentJobs: Math.floor(hardware.cpu.coresPhysical / 2),
  }

  if (!cpuCompute.teeAvailable) {
    warnings.push(
      'CPU TEE not available - compute will run in non-confidential mode',
    )
  }

  // GPU Compute
  const totalVram = hardware.gpus.reduce((sum, g) => sum + g.memoryTotalMb, 0)
  const totalTflops = hardware.gpus.reduce(
    (sum, g) => sum + g.estimatedTflops,
    0,
  )

  const gpuCompute = {
    available: hardware.gpus.length > 0 && totalVram >= 4000,
    teeAvailable: hardware.tee.hasNvidiaCc,
    gpus: hardware.gpus,
    totalVram,
    estimatedTflops: totalTflops,
  }

  if (gpuCompute.available && !gpuCompute.teeAvailable) {
    warnings.push(
      'GPU TEE (NVIDIA CC) not available - GPU compute will run in non-confidential mode',
    )
  }

  if (!hardware.docker.available) {
    warnings.push('Docker not installed - some compute jobs require Docker')
  } else if (!hardware.docker.runtimeAvailable) {
    warnings.push(
      'Docker daemon not running - start Docker to enable container compute',
    )
  } else if (gpuCompute.available && !hardware.docker.gpuSupport) {
    warnings.push(
      'NVIDIA Container Toolkit not installed - GPU containers will not work',
    )
  }

  return {
    cpuCompute,
    gpuCompute,
    docker: hardware.docker,
    warnings,
  }
}

export interface ServiceRequirements {
  minCpuCores: number
  minMemoryMb: number
  minStorageGb: number
  requiresGpu: boolean
  minGpuMemoryMb?: number
  requiresTee: boolean
  requiresDocker?: boolean
}

export function meetsRequirements(
  hardware: HardwareInfo,
  requirements: ServiceRequirements,
): {
  meets: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (hardware.cpu.coresPhysical < requirements.minCpuCores) {
    issues.push(
      `Need ${requirements.minCpuCores} CPU cores, have ${hardware.cpu.coresPhysical}`,
    )
  }

  if (hardware.memory.totalMb < requirements.minMemoryMb) {
    issues.push(
      `Need ${requirements.minMemoryMb} MB RAM, have ${hardware.memory.totalMb}`,
    )
  }

  if (requirements.requiresGpu) {
    if (hardware.gpus.length === 0) {
      issues.push('GPU required but none detected')
    } else if (requirements.minGpuMemoryMb) {
      const maxGpuMem = Math.max(...hardware.gpus.map((g) => g.memoryTotalMb))
      if (maxGpuMem < requirements.minGpuMemoryMb) {
        issues.push(
          `Need ${requirements.minGpuMemoryMb} MB GPU memory, have ${maxGpuMem} MB`,
        )
      }
    }
  }

  if (requirements.requiresTee && !hardware.tee.attestationAvailable) {
    issues.push('TEE (TDX/SGX/SEV) required but not available')
  }

  if (requirements.requiresDocker && !hardware.docker.runtimeAvailable) {
    issues.push('Docker required but not available')
  }

  return {
    meets: issues.length === 0,
    issues,
  }
}

// Privacy warning for non-TEE compute
export const NON_TEE_WARNING = `
⚠️ NON-CONFIDENTIAL COMPUTE WARNING ⚠️

Your hardware does not support Trusted Execution Environment (TEE) for this compute type.
This means:

• Your compute jobs will run in UNENCRYPTED memory
• A sophisticated attacker with physical access could potentially view job data
• Cloud providers or hosting companies could theoretically inspect workloads
• This is suitable for non-sensitive workloads only

For confidential compute, you need:
• Intel TDX or SGX (CPU)
• AMD SEV (CPU)
• NVIDIA Confidential Computing (GPU)

Most users will never have their data inspected, but you should be aware of this limitation.
Only run sensitive workloads on TEE-enabled hardware.
`.trim()
