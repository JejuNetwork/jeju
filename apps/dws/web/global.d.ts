/**
 * DWS Web Global Type Declarations
 *
 * Extends browser APIs with proper types for hardware detection
 * and other experimental Web APIs used in the DWS frontend.
 */

// Network Information API
interface NetworkInformation {
  effectiveType: '2g' | '3g' | '4g' | 'slow-2g'
  downlink: number
  rtt: number
  saveData: boolean
  onchange: (() => void) | null
}

// WebGPU types (basic)
interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>
}

interface GPUAdapter {
  name: string
  features: GPUSupportedFeatures
  limits: GPUSupportedLimits
  requestDevice(): Promise<GPUDevice>
}

interface GPUSupportedFeatures extends Set<string> {}

interface GPUSupportedLimits {
  maxTextureDimension1D: number
  maxTextureDimension2D: number
  maxTextureDimension3D: number
  maxTextureArrayLayers: number
  maxBindGroups: number
  maxBindingsPerBindGroup: number
  maxDynamicUniformBuffersPerPipelineLayout: number
  maxDynamicStorageBuffersPerPipelineLayout: number
  maxSampledTexturesPerShaderStage: number
  maxSamplersPerShaderStage: number
  maxStorageBuffersPerShaderStage: number
  maxStorageTexturesPerShaderStage: number
  maxUniformBuffersPerShaderStage: number
  maxUniformBufferBindingSize: number
  maxStorageBufferBindingSize: number
  minUniformBufferOffsetAlignment: number
  minStorageBufferOffsetAlignment: number
  maxVertexBuffers: number
  maxBufferSize: number
  maxVertexAttributes: number
  maxVertexBufferArrayStride: number
  maxInterStageShaderComponents: number
  maxColorAttachments: number
  maxColorAttachmentBytesPerSample: number
  maxComputeWorkgroupStorageSize: number
  maxComputeInvocationsPerWorkgroup: number
  maxComputeWorkgroupSizeX: number
  maxComputeWorkgroupSizeY: number
  maxComputeWorkgroupSizeZ: number
  maxComputeWorkgroupsPerDimension: number
}

interface GPUDevice extends EventTarget {
  label: string | null
  features: GPUSupportedFeatures
  limits: GPUSupportedLimits
  queue: GPUQueue
  destroy(): void
}

interface GPUQueue {
  label: string | null
  submit(commandBuffers: Iterable<GPUCommandBuffer>): void
}

interface GPUCommandBuffer {
  label: string | null
}

declare global {
  interface Navigator {
    /** Device memory in gigabytes (Device Memory API) */
    deviceMemory?: number
    /** Network connection info (Network Information API) */
    connection?: NetworkInformation
    /** WebGPU API */
    gpu?: GPU
  }
}

export {}
