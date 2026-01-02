import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Network,
  Rocket,
  Settings,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button } from '../../components/shared/Button'
import { PageHeader } from '../../components/shared/PageHeader'
import { api, extractDataSafe } from '../../lib/client'

type AgentType = 'ai_agent' | 'trading_bot' | 'org_tool'

interface AgentFormData {
  name: string
  type: AgentType
  description: string
  modelId: string
  capabilities: string[]
  a2aEndpoint: string
  mcpEndpoint: string
  config: Record<string, string>
}

const AGENT_TYPES: Array<{
  value: AgentType
  label: string
  description: string
  icon: typeof Bot
}> = [
  {
    value: 'ai_agent',
    label: 'AI Agent',
    description: 'Autonomous AI agent for tasks and conversations',
    icon: Brain,
  },
  {
    value: 'trading_bot',
    label: 'Trading Bot',
    description: 'Automated trading and DeFi strategies',
    icon: Settings,
  },
  {
    value: 'org_tool',
    label: 'Organization Tool',
    description: 'DAO operations and governance automation',
    icon: Network,
  },
]

const CAPABILITIES = [
  'code-review',
  'code-generation',
  'testing',
  'documentation',
  'security-audit',
  'bug-bounty-hunting',
  'data-analysis',
  'content-creation',
  'market-analysis',
  'trade-execution',
  'governance-voting',
  'proposal-drafting',
]

const STEPS = [
  { id: 1, title: 'Type', description: 'Choose agent type' },
  { id: 2, title: 'Details', description: 'Name and description' },
  { id: 3, title: 'Capabilities', description: 'Select capabilities' },
  { id: 4, title: 'Integration', description: 'Configure endpoints' },
  { id: 5, title: 'Review', description: 'Confirm and deploy' },
]

export function AgentDeployPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isConnected } = useAccount()

  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<AgentFormData>({
    name: '',
    type: 'ai_agent',
    description: '',
    modelId: '',
    capabilities: [],
    a2aEndpoint: '',
    mcpEndpoint: '',
    config: {},
  })

  const [configKey, setConfigKey] = useState('')
  const [configValue, setConfigValue] = useState('')

  const deployMutation = useMutation({
    mutationFn: async (data: AgentFormData) => {
      const response = await api.api.agents.post({
        name: data.name,
        type: data.type,
        description: data.description,
        modelId: data.modelId || undefined,
        capabilities: data.capabilities,
        a2aEndpoint: data.a2aEndpoint || undefined,
        mcpEndpoint: data.mcpEndpoint || undefined,
        config: Object.keys(data.config).length > 0 ? data.config : undefined,
      })
      const result = extractDataSafe(response)
      if (!result || (typeof result === 'object' && 'error' in result)) {
        throw new Error(
          typeof result === 'object' && result && 'error' in result
            ? String(
                (result.error as { message?: string })?.message ??
                  'Failed to deploy agent',
              )
            : 'Failed to deploy agent',
        )
      }
      return result
    },
    onSuccess: (result) => {
      toast.success(`Agent "${formData.name}" deployed`)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      const agentId =
        typeof result === 'object' && result && 'agentId' in result
          ? result.agentId
          : formData.name
      navigate(`/agents/${agentId}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!isConnected) {
      toast.error('Please connect your wallet to deploy agents')
      return
    }
    deployMutation.mutate(formData)
  }

  const toggleCapability = (capability: string) => {
    setFormData((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }))
  }

  const addConfig = () => {
    const key = configKey.trim()
    const value = configValue.trim()
    if (key && value) {
      setFormData((prev) => ({
        ...prev,
        config: { ...prev.config, [key]: value },
      }))
      setConfigKey('')
      setConfigValue('')
    }
  }

  const removeConfig = (key: string) => {
    setFormData((prev) => {
      const newConfig = { ...prev.config }
      delete newConfig[key]
      return { ...prev, config: newConfig }
    })
  }

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return !!formData.type
      case 2:
        return formData.name.length >= 1 && formData.description.length >= 10
      case 3:
        return formData.capabilities.length > 0
      case 4:
        return true // Endpoints are optional
      case 5:
        return true
      default:
        return false
    }
  }

  const nextStep = () => {
    if (canProceed() && currentStep < 5) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Deploy Agent"
        description="Deploy an AI agent to the Crucible network"
        icon={Bot}
      />

      {!isConnected && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h4 className="font-medium text-amber-300">Wallet Not Connected</h4>
            <p className="text-sm text-amber-300/70">
              Connect your wallet to deploy agents. Your wallet address will be
              the agent owner.
            </p>
          </div>
        </div>
      )}

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex flex-col items-center ${
                  step.id === currentStep
                    ? 'text-white'
                    : step.id < currentStep
                      ? 'text-green-400'
                      : 'text-white/40'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                    step.id === currentStep
                      ? 'border-orange-500 bg-orange-500/20'
                      : step.id < currentStep
                        ? 'border-green-500 bg-green-500/20'
                        : 'border-white/20 bg-white/5'
                  }`}
                >
                  {step.id < currentStep ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span>{step.id}</span>
                  )}
                </div>
                <span className="text-xs mt-2 hidden sm:block">
                  {step.title}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`w-full h-0.5 mx-2 ${
                    step.id < currentStep ? 'bg-green-500' : 'bg-white/10'
                  }`}
                  style={{ minWidth: '40px' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Agent Type */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">
              Choose Agent Type
            </h2>
            <div className="grid gap-4">
              {AGENT_TYPES.map((type) => {
                const TypeIcon = type.icon
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, type: type.value }))
                    }
                    className={`p-6 rounded-lg border transition-all text-left flex items-start gap-4 ${
                      formData.type === type.value
                        ? 'border-orange-500 bg-orange-500/10 ring-1 ring-orange-500'
                        : 'border-white/10 hover:border-white/30 bg-white/5'
                    }`}
                  >
                    <TypeIcon
                      className={`w-8 h-8 ${
                        formData.type === type.value
                          ? 'text-orange-400'
                          : 'text-white/40'
                      }`}
                    />
                    <div>
                      <div
                        className={`font-semibold text-lg ${
                          formData.type === type.value
                            ? 'text-white'
                            : 'text-white/80'
                        }`}
                      >
                        {type.label}
                      </div>
                      <div className="text-sm text-white/60 mt-1">
                        {type.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2: Details */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">Agent Details</h2>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Agent Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="My Awesome Agent"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Describe what your agent does..."
                rows={4}
                minLength={10}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500 resize-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Base Model (optional)
              </label>
              <input
                type="text"
                value={formData.modelId}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, modelId: e.target.value }))
                }
                placeholder="jeju-network/llama-8b or custom model ID"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
        )}

        {/* Step 3: Capabilities */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">
              Select Capabilities
            </h2>
            <p className="text-white/60">
              Choose what your agent can do. This helps users find agents that
              match their needs.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {CAPABILITIES.map((capability) => (
                <button
                  key={capability}
                  type="button"
                  onClick={() => toggleCapability(capability)}
                  className={`p-3 rounded-lg border transition-all text-left ${
                    formData.capabilities.includes(capability)
                      ? 'border-orange-500 bg-orange-500/10'
                      : 'border-white/10 hover:border-white/30 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center ${
                        formData.capabilities.includes(capability)
                          ? 'border-orange-500 bg-orange-500'
                          : 'border-white/30'
                      }`}
                    >
                      {formData.capabilities.includes(capability) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className="text-sm text-white/80">{capability}</span>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-sm text-white/40">
              Selected: {formData.capabilities.length} capability(ies)
            </p>
          </div>
        )}

        {/* Step 4: Integration */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">
              Integration Settings
            </h2>
            <p className="text-white/60">
              Configure how other agents and systems can interact with your
              agent.
            </p>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                A2A Endpoint (Agent-to-Agent)
              </label>
              <input
                type="url"
                value={formData.a2aEndpoint}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    a2aEndpoint: e.target.value,
                  }))
                }
                placeholder="https://my-agent.dws.jejunetwork.org/a2a"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
              />
              <p className="mt-1 text-xs text-white/40">
                Endpoint for agent-to-agent communication
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                MCP Endpoint
              </label>
              <input
                type="url"
                value={formData.mcpEndpoint}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    mcpEndpoint: e.target.value,
                  }))
                }
                placeholder="https://my-agent.dws.jejunetwork.org/mcp"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
              />
              <p className="mt-1 text-xs text-white/40">
                Multi-agent Coordination Protocol endpoint
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">
                Additional Configuration
              </label>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={configKey}
                  onChange={(e) => setConfigKey(e.target.value)}
                  placeholder="Key"
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
                />
                <input
                  type="text"
                  value={configValue}
                  onChange={(e) => setConfigValue(e.target.value)}
                  placeholder="Value"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addConfig()
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-orange-500"
                />
                <Button type="button" variant="secondary" onClick={addConfig}>
                  Add
                </Button>
              </div>
              {Object.keys(formData.config).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(formData.config).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                    >
                      <div className="font-mono text-sm">
                        <span className="text-orange-400">{key}</span>
                        <span className="text-white/40"> = </span>
                        <span className="text-white/80">{value}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeConfig(key)}
                        className="text-white/40 hover:text-red-400 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white">
              Review & Deploy
            </h2>
            <div className="space-y-4 p-6 bg-white/5 rounded-lg">
              <div className="flex justify-between">
                <span className="text-white/60">Type</span>
                <span className="text-white font-medium">
                  {AGENT_TYPES.find((t) => t.value === formData.type)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Name</span>
                <span className="text-white font-medium">{formData.name}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-white/60">Description</span>
                <span className="text-white text-right max-w-[60%]">
                  {formData.description}
                </span>
              </div>
              {formData.modelId && (
                <div className="flex justify-between">
                  <span className="text-white/60">Base Model</span>
                  <span className="text-white font-mono text-sm">
                    {formData.modelId}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-start">
                <span className="text-white/60">Capabilities</span>
                <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                  {formData.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 bg-orange-500/20 text-orange-300 rounded text-xs"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
              {formData.a2aEndpoint && (
                <div className="flex justify-between">
                  <span className="text-white/60">A2A Endpoint</span>
                  <span className="text-white font-mono text-sm">
                    {formData.a2aEndpoint}
                  </span>
                </div>
              )}
              {formData.mcpEndpoint && (
                <div className="flex justify-between">
                  <span className="text-white/60">MCP Endpoint</span>
                  <span className="text-white font-mono text-sm">
                    {formData.mcpEndpoint}
                  </span>
                </div>
              )}
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <h4 className="font-medium text-blue-300 mb-2">
                What happens next?
              </h4>
              <ul className="text-sm text-blue-200/70 space-y-1">
                <li>• Your agent will be registered on the Crucible network</li>
                <li>
                  • Other agents can discover and interact with your agent
                </li>
                <li>
                  • You can earn JEJU tokens when your agent completes tasks
                </li>
                <li>• Reputation score will be built based on performance</li>
              </ul>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-4 pt-8">
          {currentStep > 1 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={prevStep}
              icon={ChevronLeft}
              className="flex-1"
            >
              Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/agents')}
              className="flex-1"
            >
              Cancel
            </Button>
          )}
          {currentStep < 5 ? (
            <Button
              type="button"
              variant="primary"
              onClick={nextStep}
              disabled={!canProceed()}
              icon={ChevronRight}
              className="flex-1"
            >
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={deployMutation.isPending || !isConnected}
              icon={deployMutation.isPending ? Loader2 : Rocket}
              className="flex-1"
            >
              {deployMutation.isPending ? 'Deploying...' : 'Deploy Agent'}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
