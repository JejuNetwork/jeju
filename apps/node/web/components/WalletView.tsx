import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Copy,
  ExternalLink,
  Import,
  Key,
  Plus,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { useAppStore } from '../context/AppContext'
import { formatEther } from '../utils'

const CreateWalletRequestSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const ImportWalletRequestSchema = z
  .object({
    private_key: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .nullable(),
    mnemonic: z.string().min(1).nullable(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((data) => (data.private_key !== null) !== (data.mnemonic !== null), {
    message: 'Must provide either private_key or mnemonic, not both',
  })

type WalletAction = 'create' | 'import' | 'external' | 'jeju' | null

export function WalletView() {
  const { wallet, balance, agent, fetchWallet, fetchBalance, isLoading } =
    useAppStore()
  const [action, setAction] = useState<WalletAction>(null)
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [importType, setImportType] = useState<'key' | 'mnemonic'>('mnemonic')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const request = CreateWalletRequestSchema.parse({ password })

    setLoading(true)
    setError(null)

    await invoke('create_wallet', { request })
    await fetchWallet()
    await fetchBalance()
    setAction(null)
    setPassword('')
    setLoading(false)
  }

  const handleImport = async () => {
    const request = ImportWalletRequestSchema.parse({
      private_key:
        importType === 'key'
          ? privateKey.startsWith('0x')
            ? privateKey
            : `0x${privateKey}`
          : null,
      mnemonic: importType === 'mnemonic' ? mnemonic : null,
      password,
    })

    setLoading(true)
    setError(null)

    await invoke('import_wallet', { request })
    await fetchWallet()
    await fetchBalance()
    setAction(null)
    setPassword('')
    setPrivateKey('')
    setMnemonic('')
    setLoading(false)
  }

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!wallet) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Wallet</h1>
          <p className="text-volcanic-400 mt-1">
            Connect or create a wallet to start earning
          </p>
        </div>

        {/* Wallet Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setAction('create')}
            className="card-hover p-6 text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-jeju-600/20 text-jeju-400 group-hover:bg-jeju-600/30 transition-colors">
                <Plus size={24} />
              </div>
              <div>
                <h3 className="font-semibold">Create New Wallet</h3>
                <p className="text-sm text-volcanic-400">
                  Generate a new embedded wallet
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAction('import')}
            className="card-hover p-6 text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-600/20 text-blue-400 group-hover:bg-blue-600/30 transition-colors">
                <Import size={24} />
              </div>
              <div>
                <h3 className="font-semibold">Import Wallet</h3>
                <p className="text-sm text-volcanic-400">
                  Import from seed phrase or private key
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAction('external')}
            className="card-hover p-6 text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-purple-600/20 text-purple-400 group-hover:bg-purple-600/30 transition-colors">
                <ExternalLink size={24} />
              </div>
              <div>
                <h3 className="font-semibold">Connect External Wallet</h3>
                <p className="text-sm text-volcanic-400">
                  MetaMask, Rabby, or other browser wallet
                </p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAction('jeju')}
            className="card-hover p-6 text-left group border-jeju-500/30"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-jeju-600/20 to-jeju-700/20 text-jeju-400 group-hover:from-jeju-600/30 group-hover:to-jeju-700/30 transition-colors">
                <Shield size={24} />
              </div>
              <div>
                <h3 className="font-semibold gradient-text">
                  Connect Network Wallet
                </h3>
                <p className="text-sm text-volcanic-400">
                  Use your Network Wallet with full integration
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Action Modals */}
        <AnimatePresence>
          {action && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setAction(null)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="card max-w-md w-full p-6"
                onClick={(e) => e.stopPropagation()}
              >
                {action === 'create' && (
                  <>
                    <h2 className="text-xl font-bold mb-4">
                      Create New Wallet
                    </h2>

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="create-password-input"
                          className="label"
                        >
                          Password
                        </label>
                        <input
                          id="create-password-input"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input"
                          placeholder="Enter a strong password"
                        />
                        <p className="text-xs text-volcanic-500 mt-1">
                          This encrypts your wallet. Don't forget it.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        type="button"
                        onClick={() => setAction(null)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleCreate}
                        disabled={loading}
                        className="btn-primary flex-1"
                      >
                        {loading ? 'Creating...' : 'Create Wallet'}
                      </button>
                    </div>
                  </>
                )}

                {action === 'import' && (
                  <>
                    <h2 className="text-xl font-bold mb-4">Import Wallet</h2>

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="flex gap-2 bg-volcanic-800 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => setImportType('mnemonic')}
                          className={clsx(
                            'flex-1 py-2 rounded-md text-sm transition-all',
                            importType === 'mnemonic'
                              ? 'bg-volcanic-700 text-white'
                              : 'text-volcanic-400',
                          )}
                        >
                          Seed Phrase
                        </button>
                        <button
                          type="button"
                          onClick={() => setImportType('key')}
                          className={clsx(
                            'flex-1 py-2 rounded-md text-sm transition-all',
                            importType === 'key'
                              ? 'bg-volcanic-700 text-white'
                              : 'text-volcanic-400',
                          )}
                        >
                          Private Key
                        </button>
                      </div>

                      {importType === 'mnemonic' ? (
                        <div>
                          <label htmlFor="mnemonic-input" className="label">
                            Seed Phrase
                          </label>
                          <textarea
                            id="mnemonic-input"
                            value={mnemonic}
                            onChange={(e) => setMnemonic(e.target.value)}
                            className="input h-24"
                            placeholder="Enter your 12 or 24 word seed phrase"
                          />
                        </div>
                      ) : (
                        <div>
                          <label htmlFor="private-key-input" className="label">
                            Private Key
                          </label>
                          <input
                            id="private-key-input"
                            type="password"
                            value={privateKey}
                            onChange={(e) => setPrivateKey(e.target.value)}
                            className="input"
                            placeholder="0x..."
                          />
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="import-password-input"
                          className="label"
                        >
                          Password
                        </label>
                        <input
                          id="import-password-input"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input"
                          placeholder="Enter a strong password"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        type="button"
                        onClick={() => setAction(null)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleImport}
                        disabled={loading}
                        className="btn-primary flex-1"
                      >
                        {loading ? 'Importing...' : 'Import Wallet'}
                      </button>
                    </div>
                  </>
                )}

                {action === 'external' && (
                  <>
                    <h2 className="text-xl font-bold mb-4">
                      Connect External Wallet
                    </h2>

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={async () => {
                          setLoading(true)
                          setError(null)
                          if (!window.ethereum) {
                            setError('No wallet extension found. Install MetaMask or Rabby.')
                            setLoading(false)
                            return
                          }
                          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
                          if (accounts.length > 0) {
                            await invoke('connect_external_wallet', { address: accounts[0] })
                            await fetchWallet()
                            await fetchBalance()
                            setAction(null)
                          }
                          setLoading(false)
                        }}
                        disabled={loading}
                        className="w-full p-4 bg-volcanic-800 hover:bg-volcanic-700 rounded-xl flex items-center gap-3 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                          <Wallet size={20} className="text-orange-400" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium">Browser Wallet</p>
                          <p className="text-xs text-volcanic-400">MetaMask, Rabby, etc.</p>
                        </div>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAction(null)}
                      className="btn-secondary w-full mt-4"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {action === 'jeju' && (
                  <>
                    <h2 className="text-xl font-bold mb-4">
                      Connect Network Wallet
                    </h2>

                    {error && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
                        {error}
                      </div>
                    )}

                    <p className="text-volcanic-400 mb-4">
                      Connect using your Network Wallet for enhanced security and seamless integration.
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setLoading(true)
                        setError(null)
                        await invoke('connect_jeju_wallet')
                        await fetchWallet()
                        await fetchBalance()
                        setAction(null)
                        setLoading(false)
                      }}
                      disabled={loading}
                      className="btn-primary w-full"
                    >
                      {loading ? 'Connecting...' : 'Connect Network Wallet'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setAction(null)}
                      className="btn-secondary w-full mt-3"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-volcanic-400 mt-1">
          Manage your wallet and agent identity
        </p>
      </div>

      {/* Wallet Card */}
      <div className="card bg-gradient-to-br from-volcanic-900 to-volcanic-900/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-jeju-500 to-jeju-700 flex items-center justify-center">
              <Wallet size={28} className="text-white" />
            </div>
            <div>
              <p className="text-sm text-volcanic-400 capitalize">
                {wallet.wallet_type} Wallet
              </p>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-lg font-mono">
                  {wallet.address.slice(0, 10)}...{wallet.address.slice(-8)}
                </code>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="p-1.5 rounded-lg hover:bg-volcanic-800 transition-colors"
                >
                  {copied ? (
                    <Check size={16} className="text-jeju-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              fetchWallet()
              fetchBalance()
            }}
            className="btn-ghost p-2"
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div>
            <p className="text-sm text-volcanic-400">ETH Balance</p>
            <p className="text-xl font-bold">
              {isLoading && !balance ? (
                <span className="inline-block w-16 h-6 bg-volcanic-700 rounded animate-pulse" />
              ) : (
                formatEther(balance?.eth ?? '0')
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">JEJU Balance</p>
            <p className="text-xl font-bold">
              {isLoading && !balance ? (
                <span className="inline-block w-16 h-6 bg-volcanic-700 rounded animate-pulse" />
              ) : (
                formatEther(balance?.jeju ?? '0')
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Staked</p>
            <p className="text-xl font-bold">
              {isLoading && !balance ? (
                <span className="inline-block w-16 h-6 bg-volcanic-700 rounded animate-pulse" />
              ) : (
                formatEther(balance?.staked ?? '0')
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Pending Rewards</p>
            <p className="text-xl font-bold text-jeju-400">
              {isLoading && !balance ? (
                <span className="inline-block w-16 h-6 bg-volcanic-700 rounded animate-pulse" />
              ) : (
                formatEther(balance?.pending_rewards ?? '0')
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Agent Identity (ERC-8004) */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shield size={18} className="text-volcanic-400" />
          Agent Identity (ERC-8004)
        </h2>

        {agent ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-volcanic-400">Agent ID</span>
              <span className="font-mono">#{agent.agent_id}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-volcanic-400">Stake Tier</span>
              <span className="capitalize">{agent.stake_tier}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-volcanic-400">Reputation Score</span>
              <span>{agent.reputation_score} / 100</span>
            </div>
            {agent.is_banned && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400">
                This agent is currently banned: {agent.ban_reason}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-volcanic-400 mb-4">
              Register an ERC-8004 agent to participate in the network
            </p>
            <button
              type="button"
              onClick={async () => {
                setLoading(true)
                setError(null)
                await invoke('register_agent', { stake_tier: 'small' })
                await fetchWallet()
                setLoading(false)
              }}
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Registering...' : 'Register Agent'}
            </button>
          </div>
        )}
      </div>

      {/* Security */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Key size={18} className="text-volcanic-400" />
          Security
        </h2>

        <div className="space-y-3">
          {wallet.wallet_type === 'embedded' && (
            <>
              <button
                type="button"
                onClick={async () => {
                  const pwd = prompt('Enter your wallet password to export:')
                  if (!pwd) return
                  const key = await invoke<string>('export_private_key', { password: pwd })
                  navigator.clipboard.writeText(key)
                  alert('Private key copied to clipboard. Store it safely.')
                }}
                className="btn-secondary w-full text-left flex items-center justify-between"
              >
                <span>Export Private Key</span>
                <ExternalLink size={16} />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const oldPwd = prompt('Current password:')
                  if (!oldPwd) return
                  const newPwd = prompt('New password (min 8 chars):')
                  if (!newPwd || newPwd.length < 8) {
                    alert('Password must be at least 8 characters')
                    return
                  }
                  await invoke('change_wallet_password', { old_password: oldPwd, new_password: newPwd })
                  alert('Password changed.')
                }}
                className="btn-secondary w-full text-left flex items-center justify-between"
              >
                <span>Change Password</span>
                <Key size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Disconnect wallet? You will need to reconnect to use services.')) return
              await invoke('disconnect_wallet')
              await fetchWallet()
            }}
            className="btn-ghost w-full text-left text-red-400 hover:text-red-300 flex items-center justify-between"
          >
            <span>Disconnect Wallet</span>
          </button>
        </div>
      </div>
    </div>
  )
}
