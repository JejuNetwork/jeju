import { clsx } from 'clsx'
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  Plus,
  Shield,
  Tag,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount, useBalance } from 'wagmi'
import { Button, PageHeader } from '../../components/shared'
import {
  calculateRequiredStake,
  calculateTotalRequired,
  useBountyContractAvailable,
  useCreateBountyOnChain,
} from '../../hooks/useBountyContract'
import { api, extractData } from '../../lib/client'

interface Milestone {
  title: string
  description: string
  percentage: number
}

export function BountyCreatePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({ address })

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reward, setReward] = useState('')
  const [currency, setCurrency] = useState('ETH')
  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [deadline, setDeadline] = useState('')
  const [milestones, setMilestones] = useState<Milestone[]>([
    {
      title: 'Complete Work',
      description: 'Deliver the full solution',
      percentage: 100,
    },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [useEscrow, setUseEscrow] = useState(true)
  const [specUri, setSpecUri] = useState('')

  // On-chain bounty creation
  const contractAvailable = useBountyContractAvailable()
  const {
    createBounty: createOnChainBounty,
    isPending: isOnChainPending,
    isConfirming,
    isSuccess: isOnChainSuccess,
    txHash,
    reset: resetOnChain,
  } = useCreateBountyOnChain()

  // Calculate escrow amounts
  const stakeRequired = calculateRequiredStake(reward)
  const totalRequired = calculateTotalRequired(reward)
  const hasEnoughBalance =
    balance && Number(balance.formatted) >= Number(totalRequired)

  // Navigate on successful on-chain creation
  useEffect(() => {
    if (isOnChainSuccess && txHash) {
      toast.success('Bounty created on-chain with escrow')
      navigate('/bounties')
      resetOnChain()
    }
  }, [isOnChainSuccess, txHash, navigate, resetOnChain])

  const addSkill = useCallback(() => {
    const skill = skillInput.trim()
    if (skill && !skills.includes(skill)) {
      setSkills((prev) => [...prev, skill])
      setSkillInput('')
    }
  }, [skillInput, skills])

  const removeSkill = useCallback((skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill))
  }, [])

  const addMilestone = useCallback(() => {
    setMilestones((prev) => [
      ...prev,
      { title: '', description: '', percentage: 0 },
    ])
  }, [])

  const updateMilestone = useCallback(
    (index: number, field: keyof Milestone, value: string | number) => {
      setMilestones((prev) =>
        prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
      )
    },
    [],
  )

  const removeMilestone = useCallback((index: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const totalPercentage = milestones.reduce((sum, m) => sum + m.percentage, 0)
  const isValidPercentage = totalPercentage === 100

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isConnected) {
      toast.error('Please connect your wallet to create a bounty')
      return
    }

    if (!isValidPercentage) {
      toast.error('Milestone percentages must total 100%')
      return
    }

    const deadlineMs = new Date(deadline).getTime()
    const deadlineSecs = Math.floor(deadlineMs / 1000)

    // On-chain creation with escrow
    if (useEscrow && contractAvailable && currency === 'ETH') {
      if (!hasEnoughBalance) {
        toast.error(`Insufficient balance. Need ${totalRequired} ETH`)
        return
      }

      try {
        await createOnChainBounty({
          title,
          description,
          specUri: specUri || '',
          deadline: deadlineSecs,
          rewardAmount: reward,
          milestoneTitles: milestones.map((m) => m.title),
          milestoneDescriptions: milestones.map((m) => m.description),
          milestonePercentages: milestones.map((m) => m.percentage * 100), // Convert to basis points
          requiredSkills: skills,
        })
      } catch (error) {
        console.error('On-chain bounty creation failed:', error)
        toast.error('Failed to create on-chain bounty')
      }
      return
    }

    // Off-chain creation (database only)
    setIsSubmitting(true)

    const response = await api.api.bounties.post({
      title,
      description,
      reward,
      currency,
      skills,
      deadline: deadlineMs,
      milestones: milestones.map((m) => ({
        name: m.title,
        description: m.description,
        reward: ((Number.parseFloat(reward) * m.percentage) / 100).toString(),
        currency,
        deadline: deadlineMs,
      })),
      creator: address as string,
    })

    setIsSubmitting(false)

    const data = extractData(response)
    if (data && 'id' in data && typeof data.id === 'string') {
      toast.success('Bounty created successfully')
      navigate(`/bounties/${data.id}`)
    }
  }

  return (
    <div className="page-container">
      <Link
        to="/bounties"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Bounties
      </Link>

      <PageHeader
        title="Create Bounty"
        icon={DollarSign}
        iconColor="text-success-400"
      />

      <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
        {/* Escrow Mode Selection */}
        {contractAvailable && (
          <div className="card p-6 animate-in">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="w-5 h-5 text-success-400" />
                  <h3 className="font-semibold text-surface-100">
                    On-Chain Escrow
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useEscrow}
                      onChange={(e) => setUseEscrow(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-700 peer-focus:ring-2 peer-focus:ring-success-400/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success-500" />
                  </label>
                </div>
                <p className="text-sm text-surface-400">
                  {useEscrow
                    ? 'Funds are locked in a smart contract. Released when work is approved. 10% stake required.'
                    : 'Off-chain bounty without escrow. Payments handled manually.'}
                </p>
                {useEscrow && reward && (
                  <div className="mt-3 p-3 bg-surface-800/50 rounded-lg text-sm">
                    <div className="flex justify-between text-surface-300">
                      <span>Reward:</span>
                      <span>{reward} ETH</span>
                    </div>
                    <div className="flex justify-between text-surface-300">
                      <span>Stake (10%):</span>
                      <span>{stakeRequired} ETH</span>
                    </div>
                    <div className="flex justify-between font-medium text-surface-100 border-t border-surface-700 mt-2 pt-2">
                      <span>Total Required:</span>
                      <span>{totalRequired} ETH</span>
                    </div>
                    {!hasEnoughBalance && balance && (
                      <p className="text-warning-400 text-xs mt-2">
                        ⚠️ Insufficient balance ({balance.formatted} ETH)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Transaction Status */}
        {(isOnChainPending || isConfirming) && (
          <div className="card p-6 animate-in bg-info-500/10 border-info-500/30">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-info-400 animate-spin" />
              <div>
                <h4 className="font-medium text-info-300">
                  {isOnChainPending
                    ? 'Waiting for wallet confirmation...'
                    : 'Confirming transaction...'}
                </h4>
                {txHash && (
                  <a
                    href={`https://explorer.jejunetwork.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-info-400 hover:text-info-300 flex items-center gap-1"
                  >
                    View on explorer
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Basic Info */}
        <div className="card p-6 space-y-4 animate-in">
          <h3 className="font-semibold text-surface-100 mb-4">
            Basic Information
          </h3>

          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Build a decentralized exchange"
              className="input w-full"
              required
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-surface-300 mb-2"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work to be done, requirements, and deliverables..."
              className="input w-full min-h-[120px] resize-y"
              required
            />
          </div>

          {useEscrow && (
            <div>
              <label
                htmlFor="specUri"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                <Link2 className="w-4 h-4 inline mr-1" />
                Specification URI (optional)
              </label>
              <input
                id="specUri"
                type="text"
                value={specUri}
                onChange={(e) => setSpecUri(e.target.value)}
                placeholder="ipfs://... or https://..."
                className="input w-full"
              />
              <p className="text-xs text-surface-500 mt-1">
                IPFS or HTTP link to detailed specifications document
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="reward"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                Reward Amount
              </label>
              <div className="flex gap-2">
                <input
                  id="reward"
                  type="number"
                  step="0.001"
                  min="0"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  placeholder="0.00"
                  className="input flex-1"
                  required
                />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input w-24"
                >
                  <option value="ETH">ETH</option>
                  <option value="USDC">USDC</option>
                  <option value="DAI">DAI</option>
                </select>
              </div>
              <p className="text-xs text-surface-500 mt-1">
                10% stake required (returned on completion)
              </p>
            </div>

            <div>
              <label
                htmlFor="deadline"
                className="block text-sm font-medium text-surface-300 mb-2"
              >
                <Calendar className="w-4 h-4 inline mr-1" />
                Deadline
              </label>
              <input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="input w-full"
                required
              />
            </div>
          </div>
        </div>

        {/* Skills */}
        <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
          <h3 className="font-semibold text-surface-100 mb-4">
            <Tag className="w-4 h-4 inline mr-2" />
            Required Skills
          </h3>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSkill()
                }
              }}
              placeholder="Add a skill (e.g., Solidity, React)"
              className="input flex-1"
            />
            <Button type="button" variant="secondary" onClick={addSkill}>
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="badge badge-info flex items-center gap-1.5"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="hover:text-error-400 transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
            {skills.length === 0 && (
              <span className="text-sm text-surface-500">
                No skills added yet
              </span>
            )}
          </div>
        </div>

        {/* Milestones */}
        <div
          className="card p-6 animate-in"
          style={{ animationDelay: '100ms' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-surface-100">Milestones</h3>
            <span
              className={clsx(
                'text-sm font-medium',
                isValidPercentage ? 'text-success-400' : 'text-warning-400',
              )}
            >
              Total: {totalPercentage}%
            </span>
          </div>

          <div className="space-y-4">
            {milestones.map((milestone, index) => (
              <div
                key={index}
                className="p-4 bg-surface-800/50 rounded-lg space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-surface-400">
                    Milestone {index + 1}
                  </span>
                  {milestones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMilestone(index)}
                      className="text-surface-500 hover:text-error-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={milestone.title}
                    onChange={(e) =>
                      updateMilestone(index, 'title', e.target.value)
                    }
                    placeholder="Title"
                    className="input sm:col-span-2"
                    required
                  />
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={milestone.percentage}
                      onChange={(e) =>
                        updateMilestone(
                          index,
                          'percentage',
                          Number.parseInt(e.target.value, 10) || 0,
                        )
                      }
                      className="input w-full pr-8"
                      required
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500">
                      %
                    </span>
                  </div>
                </div>

                <textarea
                  value={milestone.description}
                  onChange={(e) =>
                    updateMilestone(index, 'description', e.target.value)
                  }
                  placeholder="Description and deliverables..."
                  className="input w-full min-h-[60px] resize-y"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addMilestone}
            className="mt-4 w-full p-3 border-2 border-dashed border-surface-700 rounded-lg text-surface-400 hover:text-surface-100 hover:border-surface-600 transition-colors"
          >
            <Plus className="w-4 h-4 inline mr-2" />
            Add Milestone
          </button>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-4">
          <Link
            to="/bounties"
            className="btn bg-surface-800 text-surface-300 hover:bg-surface-700"
          >
            Cancel
          </Link>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting || isOnChainPending || isConfirming}
            disabled={
              !isConnected ||
              !isValidPercentage ||
              (useEscrow && currency === 'ETH' && !hasEnoughBalance)
            }
          >
            {!isConnected
              ? 'Connect Wallet'
              : isOnChainPending
                ? 'Confirm in Wallet...'
                : isConfirming
                  ? 'Confirming...'
                  : useEscrow && contractAvailable
                    ? `Create with ${totalRequired} ETH`
                    : 'Create Bounty'}
          </Button>
        </div>

        {/* Info about escrow */}
        {useEscrow && contractAvailable && (
          <div className="p-4 bg-surface-800/50 rounded-lg text-sm text-surface-400">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 text-info-400 shrink-0" />
              <div>
                <p className="font-medium text-surface-300 mb-1">
                  How escrow works:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Your reward + 10% stake is locked in the smart contract
                  </li>
                  <li>Workers apply and you select the best candidate</li>
                  <li>Worker submits deliverables for each milestone</li>
                  <li>You approve milestones to release payments</li>
                  <li>Your stake is returned when the bounty completes</li>
                  <li>Disputes are resolved via guardian validators</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
