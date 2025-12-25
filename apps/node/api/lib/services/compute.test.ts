import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

// Compute Types
type ComputeType = 'cpu' | 'gpu' | 'both'

// Compute Service Config Schema
const ComputeServiceConfigSchema = z.object({
  computeType: z.enum(['cpu', 'gpu', 'both']),
  pricePerHourWei: z.bigint(),
  stakeAmount: z.bigint(),
  maxConcurrentJobs: z.number().int().positive(),
  acceptNonTee: z.boolean(),
})

type ComputeServiceConfig = z.infer<typeof ComputeServiceConfigSchema>

// Compute Service State Schema
const ComputeServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  stake: z.bigint(),
  computeType: z.enum(['cpu', 'gpu', 'both']),
  pricePerHourWei: z.bigint(),
  jobsCompleted: z.number().int().nonnegative(),
  reputation: z.number().min(0).max(100),
  isOnline: z.boolean(),
})

type ComputeServiceState = z.infer<typeof ComputeServiceStateSchema>

// Hardware Info Schema
const HardwareInfoSchema = z.object({
  cpuCores: z.number().int().positive(),
  cpuModel: z.string().min(1),
  memoryMb: z.number().int().positive(),
  gpus: z.array(
    z.object({
      model: z.string().min(1),
      memoryMb: z.number().int().positive(),
    }),
  ),
  hasTee: z.boolean(),
  teeType: z.enum(['none', 'sgx', 'sev', 'tdx']).optional(),
})

type HardwareInfo = z.infer<typeof HardwareInfoSchema>

function validateComputeServiceConfig(data: unknown): ComputeServiceConfig {
  return ComputeServiceConfigSchema.parse(data)
}

function validateComputeServiceState(data: unknown): ComputeServiceState {
  return ComputeServiceStateSchema.parse(data)
}

function validateHardwareInfo(data: unknown): HardwareInfo {
  return HardwareInfoSchema.parse(data)
}

describe('Compute Service Validation', () => {
  describe('validateComputeServiceConfig', () => {
    test('validates CPU-only config', () => {
      const config: ComputeServiceConfig = {
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n, // 0.01 ETH
        stakeAmount: 1000000000000000000n, // 1 ETH
        maxConcurrentJobs: 4,
        acceptNonTee: false,
      }

      const result = validateComputeServiceConfig(config)
      expect(result.computeType).toBe('cpu')
    })

    test('validates GPU-only config', () => {
      const config: ComputeServiceConfig = {
        computeType: 'gpu',
        pricePerHourWei: 100000000000000000n, // 0.1 ETH
        stakeAmount: 5000000000000000000n, // 5 ETH
        maxConcurrentJobs: 1,
        acceptNonTee: true,
      }

      const result = validateComputeServiceConfig(config)
      expect(result.computeType).toBe('gpu')
    })

    test('validates both CPU+GPU config', () => {
      const config: ComputeServiceConfig = {
        computeType: 'both',
        pricePerHourWei: 150000000000000000n,
        stakeAmount: 10000000000000000000n,
        maxConcurrentJobs: 8,
        acceptNonTee: false,
      }

      const result = validateComputeServiceConfig(config)
      expect(result.computeType).toBe('both')
    })

    test('rejects invalid compute type', () => {
      const config = {
        computeType: 'invalid',
        pricePerHourWei: 10000000000000000n,
        stakeAmount: 1000000000000000000n,
        maxConcurrentJobs: 4,
        acceptNonTee: false,
      }

      expect(() => validateComputeServiceConfig(config)).toThrow()
    })

    test('rejects zero max concurrent jobs', () => {
      const config = {
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        stakeAmount: 1000000000000000000n,
        maxConcurrentJobs: 0,
        acceptNonTee: false,
      }

      expect(() => validateComputeServiceConfig(config)).toThrow()
    })

    test('rejects negative max concurrent jobs', () => {
      const config = {
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        stakeAmount: 1000000000000000000n,
        maxConcurrentJobs: -1,
        acceptNonTee: false,
      }

      expect(() => validateComputeServiceConfig(config)).toThrow()
    })
  })

  describe('validateComputeServiceState', () => {
    test('validates registered state', () => {
      const state: ComputeServiceState = {
        isRegistered: true,
        stake: 1000000000000000000n,
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        jobsCompleted: 100,
        reputation: 95.5,
        isOnline: true,
      }

      const result = validateComputeServiceState(state)
      expect(result.isRegistered).toBe(true)
      expect(result.reputation).toBe(95.5)
    })

    test('validates unregistered state', () => {
      const state: ComputeServiceState = {
        isRegistered: false,
        stake: 0n,
        computeType: 'cpu',
        pricePerHourWei: 0n,
        jobsCompleted: 0,
        reputation: 0,
        isOnline: false,
      }

      const result = validateComputeServiceState(state)
      expect(result.isRegistered).toBe(false)
    })

    test('rejects reputation over 100', () => {
      const state = {
        isRegistered: true,
        stake: 1000000000000000000n,
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        jobsCompleted: 100,
        reputation: 150,
        isOnline: true,
      }

      expect(() => validateComputeServiceState(state)).toThrow()
    })

    test('rejects negative reputation', () => {
      const state = {
        isRegistered: true,
        stake: 1000000000000000000n,
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        jobsCompleted: 100,
        reputation: -10,
        isOnline: true,
      }

      expect(() => validateComputeServiceState(state)).toThrow()
    })

    test('rejects negative jobs completed', () => {
      const state = {
        isRegistered: true,
        stake: 1000000000000000000n,
        computeType: 'cpu',
        pricePerHourWei: 10000000000000000n,
        jobsCompleted: -1,
        reputation: 50,
        isOnline: true,
      }

      expect(() => validateComputeServiceState(state)).toThrow()
    })
  })

  describe('validateHardwareInfo', () => {
    test('validates CPU-only hardware', () => {
      const hardware: HardwareInfo = {
        cpuCores: 8,
        cpuModel: 'AMD Ryzen 7 5800X',
        memoryMb: 32768,
        gpus: [],
        hasTee: false,
      }

      const result = validateHardwareInfo(hardware)
      expect(result.cpuCores).toBe(8)
      expect(result.gpus.length).toBe(0)
    })

    test('validates hardware with GPUs', () => {
      const hardware: HardwareInfo = {
        cpuCores: 16,
        cpuModel: 'Intel Xeon E5-2690',
        memoryMb: 65536,
        gpus: [
          { model: 'NVIDIA RTX 4090', memoryMb: 24576 },
          { model: 'NVIDIA RTX 4090', memoryMb: 24576 },
        ],
        hasTee: true,
        teeType: 'sgx',
      }

      const result = validateHardwareInfo(hardware)
      expect(result.gpus.length).toBe(2)
      expect(result.hasTee).toBe(true)
      expect(result.teeType).toBe('sgx')
    })

    test('validates all TEE types', () => {
      const teeTypes = ['none', 'sgx', 'sev', 'tdx'] as const

      for (const teeType of teeTypes) {
        const hardware = {
          cpuCores: 8,
          cpuModel: 'Test CPU',
          memoryMb: 16384,
          gpus: [],
          hasTee: teeType !== 'none',
          teeType,
        }

        const result = validateHardwareInfo(hardware)
        expect(result.teeType).toBe(teeType)
      }
    })

    test('rejects zero CPU cores', () => {
      const hardware = {
        cpuCores: 0,
        cpuModel: 'Test CPU',
        memoryMb: 16384,
        gpus: [],
        hasTee: false,
      }

      expect(() => validateHardwareInfo(hardware)).toThrow()
    })

    test('rejects empty CPU model', () => {
      const hardware = {
        cpuCores: 8,
        cpuModel: '',
        memoryMb: 16384,
        gpus: [],
        hasTee: false,
      }

      expect(() => validateHardwareInfo(hardware)).toThrow()
    })

    test('rejects zero memory', () => {
      const hardware = {
        cpuCores: 8,
        cpuModel: 'Test CPU',
        memoryMb: 0,
        gpus: [],
        hasTee: false,
      }

      expect(() => validateHardwareInfo(hardware)).toThrow()
    })
  })
})

describe('Compute Offer Creation', () => {
  function createComputeOffer(
    hardware: HardwareInfo,
    pricePerHourWei: bigint,
    computeType: ComputeType,
  ) {
    const hasGpu = hardware.gpus.length > 0
    const hasCpu = hardware.cpuCores > 0

    if (computeType === 'gpu' && !hasGpu) {
      throw new Error('GPU compute requested but no GPU available')
    }

    if (computeType === 'cpu' && !hasCpu) {
      throw new Error('CPU compute requested but no CPU available')
    }

    if (computeType === 'both' && (!hasGpu || !hasCpu)) {
      throw new Error('Both compute types requested but hardware insufficient')
    }

    return {
      cpuCores: computeType !== 'gpu' ? hardware.cpuCores : 0,
      memoryMb: hardware.memoryMb,
      gpus: computeType !== 'cpu' ? hardware.gpus : [],
      pricePerHourWei,
      hasTee: hardware.hasTee,
    }
  }

  test('creates CPU-only offer', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'AMD Ryzen 7',
      memoryMb: 32768,
      gpus: [],
      hasTee: false,
    }

    const offer = createComputeOffer(hardware, 10000000000000000n, 'cpu')
    expect(offer.cpuCores).toBe(8)
    expect(offer.gpus.length).toBe(0)
  })

  test('creates GPU-only offer', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'AMD Ryzen 7',
      memoryMb: 32768,
      gpus: [{ model: 'RTX 4090', memoryMb: 24576 }],
      hasTee: false,
    }

    const offer = createComputeOffer(hardware, 100000000000000000n, 'gpu')
    expect(offer.cpuCores).toBe(0)
    expect(offer.gpus.length).toBe(1)
  })

  test('creates combined offer', () => {
    const hardware: HardwareInfo = {
      cpuCores: 16,
      cpuModel: 'Intel Xeon',
      memoryMb: 65536,
      gpus: [{ model: 'A100', memoryMb: 81920 }],
      hasTee: true,
      teeType: 'sev',
    }

    const offer = createComputeOffer(hardware, 200000000000000000n, 'both')
    expect(offer.cpuCores).toBe(16)
    expect(offer.gpus.length).toBe(1)
    expect(offer.hasTee).toBe(true)
  })

  test('throws when GPU requested without GPU hardware', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'AMD Ryzen 7',
      memoryMb: 32768,
      gpus: [],
      hasTee: false,
    }

    expect(() =>
      createComputeOffer(hardware, 100000000000000000n, 'gpu'),
    ).toThrow('GPU compute requested but no GPU available')
  })
})

describe('TEE Warning', () => {
  function shouldShowNonTeeWarning(
    hardware: HardwareInfo,
    computeType: ComputeType,
  ): boolean {
    // CPU compute without TEE needs warning
    if ((computeType === 'cpu' || computeType === 'both') && !hardware.hasTee) {
      return true
    }
    // GPU compute is inherently non-confidential (no GPU TEE yet)
    if (computeType === 'gpu' || computeType === 'both') {
      return true
    }
    return false
  }

  test('shows warning for CPU without TEE', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'Test',
      memoryMb: 16384,
      gpus: [],
      hasTee: false,
    }

    expect(shouldShowNonTeeWarning(hardware, 'cpu')).toBe(true)
  })

  test('shows warning for GPU compute', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'Test',
      memoryMb: 16384,
      gpus: [{ model: 'RTX 4090', memoryMb: 24576 }],
      hasTee: true,
      teeType: 'sgx',
    }

    expect(shouldShowNonTeeWarning(hardware, 'gpu')).toBe(true)
  })

  test('shows warning for both compute type', () => {
    const hardware: HardwareInfo = {
      cpuCores: 8,
      cpuModel: 'Test',
      memoryMb: 16384,
      gpus: [{ model: 'RTX 4090', memoryMb: 24576 }],
      hasTee: true,
      teeType: 'sgx',
    }

    expect(shouldShowNonTeeWarning(hardware, 'both')).toBe(true)
  })
})
