/**
 * JNS Names Page
 *
 * Register and manage .jeju domain names with real contract integration.
 */

import { Clock, Search, Tag } from 'lucide-react'
import { useState } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import {
  calculateRegistrationPriceWei,
  formatExpiryDate,
  formatFullName,
  formatTimeRemaining,
  getNameLengthCategory,
  normalizeName,
  REGISTRATION_DURATIONS,
  validateName,
} from '../../lib/jns'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { EmptyState, Grid, InfoCard, PageHeader } from '../components/ui'
import {
  type JNSName,
  useJNSRegistrarAddress,
  useNameAvailability,
  useRegisterName,
  useRegistrationPrice,
  useRenewName,
  useUserNames,
} from '../hooks/useJNS'

type DurationOption = (typeof REGISTRATION_DURATIONS)[number]

export default function NamesPage() {
  const { address, isConnected } = useAccount()
  const registrarAddress = useJNSRegistrarAddress()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDuration, setSelectedDuration] = useState<DurationOption>(365)
  const [selectedName, setSelectedName] = useState<JNSName | null>(null)
  const [renewDuration, setRenewDuration] = useState<DurationOption>(365)

  const normalized = normalizeName(searchQuery)
  const validation = validateName(normalized)

  const { data: availability, isLoading: checkingAvailability } =
    useNameAvailability(searchQuery)
  const { data: price } = useRegistrationPrice(normalized, selectedDuration)
  const { data: userNames, isLoading: loadingNames } = useUserNames(address)
  const { register, isLoading: registering } = useRegisterName()
  const { renew, isLoading: renewing } = useRenewName()

  const handleRegister = async () => {
    if (!normalized || !availability?.available) return
    await register(normalized, selectedDuration)
    setSearchQuery('')
  }

  const handleRenew = async (name: string) => {
    await renew(name, renewDuration)
    setSelectedName(null)
  }

  const lengthCategory =
    normalized.length >= 3 ? getNameLengthCategory(normalized) : null

  // Calculate price locally if contract not available
  const displayPrice =
    price ??
    (normalized.length >= 3
      ? calculateRegistrationPriceWei(normalized, selectedDuration)
      : 0n)

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="🏷️"
        title="Names"
        description="Register your .jeju name - your decentralized identity on the network"
      />

      {/* JNS Not Deployed Warning */}
      {!registrarAddress && (
        <InfoCard variant="warning" className="mb-6">
          <p className="font-medium">JNS Not Deployed</p>
          <p className="text-sm opacity-80">
            The JNS Registrar contract is not deployed on this network. Run the
            deployment script to enable name registration.
          </p>
        </InfoCard>
      )}

      {/* Search Section */}
      <section className="max-w-2xl mx-auto mb-12">
        <div className="card p-6">
          <label
            htmlFor="name-search"
            className="text-sm font-medium text-secondary mb-2 flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Search for a name
          </label>
          <div className="flex gap-2 mb-4">
            <input
              id="name-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
              placeholder="yourname"
              className="input flex-1 font-mono"
              autoComplete="off"
            />
            <span className="flex items-center px-4 rounded-xl bg-surface-secondary text-primary font-semibold">
              .jeju
            </span>
          </div>

          {/* Validation Feedback */}
          {searchQuery && !validation.valid && (
            <InfoCard variant="error" className="mb-4">
              {validation.error}
            </InfoCard>
          )}

          {/* Availability Result */}
          {searchQuery && validation.valid && (
            <div className="space-y-4 animate-fade-in">
              {checkingAvailability ? (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-surface-secondary">
                  <LoadingSpinner size="sm" />
                  <span className="text-secondary">
                    Checking availability...
                  </span>
                </div>
              ) : availability?.available ? (
                <>
                  <div className="p-4 rounded-xl bg-surface-secondary">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-primary text-lg">
                        {formatFullName(normalized)}
                      </span>
                      <span className="badge badge-success">Available</span>
                    </div>

                    {lengthCategory && (
                      <div className="text-xs text-tertiary mb-3">
                        {lengthCategory === 'premium' &&
                          '⭐ Premium 3-character name (100x pricing)'}
                        {lengthCategory === 'semi-premium' &&
                          '✨ Semi-premium 4-character name (10x pricing)'}
                        {lengthCategory === 'standard' && '📝 Standard name'}
                      </div>
                    )}

                    {/* Duration Selection */}
                    <div className="mb-3">
                      <span
                        id="reg-duration-label"
                        className="text-xs text-tertiary block mb-2"
                      >
                        Registration Duration
                      </span>
                      <div
                        className="flex gap-2"
                        role="radiogroup"
                        aria-labelledby="reg-duration-label"
                      >
                        {REGISTRATION_DURATIONS.map((days) => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => setSelectedDuration(days)}
                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                              selectedDuration === days
                                ? 'bg-gradient-warm text-white'
                                : 'bg-surface text-secondary hover:text-primary'
                            }`}
                          >
                            {days / 365} year{days > 365 ? 's' : ''}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-tertiary">Registration Fee</span>
                      <span className="font-semibold text-primary">
                        {formatEther(displayPrice)} ETH
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRegister}
                    disabled={!isConnected || registering || !registrarAddress}
                    className="btn-primary w-full py-4 text-lg"
                  >
                    {!isConnected
                      ? 'Connect Wallet to Register'
                      : !registrarAddress
                        ? 'JNS Not Available'
                        : registering
                          ? 'Registering...'
                          : `Register ${formatFullName(normalized)}`}
                  </button>
                </>
              ) : (
                <div className="p-4 rounded-xl bg-surface-secondary">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-primary">
                      {formatFullName(normalized)}
                    </span>
                    <span className="badge badge-error">Taken</span>
                  </div>
                  {availability?.owner && (
                    <p className="text-xs text-tertiary font-mono">
                      Owner: {availability.owner.slice(0, 10)}...
                      {availability.owner.slice(-8)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* User's Names */}
      <section>
        <h2 className="text-xl font-bold text-primary mb-4 flex items-center gap-2">
          <Tag className="w-5 h-5" />
          Your Names
        </h2>

        {!isConnected ? (
          <EmptyState
            icon="🏷️"
            title="Connect Your Wallet"
            description="Connect your wallet to view and manage your .jeju names"
          />
        ) : loadingNames ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : !userNames || userNames.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="No Names Yet"
            description="You don't own any .jeju names yet. Register your first name above."
          />
        ) : (
          <Grid cols={3}>
            {userNames.map((jnsName) => (
              <NameCard
                key={jnsName.labelhash}
                name={jnsName}
                onRenew={() => setSelectedName(jnsName)}
              />
            ))}
          </Grid>
        )}
      </section>

      {/* Renew Modal */}
      {selectedName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0 w-full h-full border-none bg-transparent cursor-default"
            onClick={() => setSelectedName(null)}
            onKeyDown={(e) => e.key === 'Escape' && setSelectedName(null)}
            aria-label="Close renewal modal"
          />
          <div
            className="card p-6 w-full max-w-md animate-modal-in relative z-10"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-xl font-bold text-primary mb-4">
              Renew {selectedName.fullName}
            </h3>

            <div className="mb-4">
              <span
                id="renew-duration-label"
                className="text-sm text-tertiary block mb-2"
              >
                Renewal Duration
              </span>
              <div
                className="flex gap-2"
                role="radiogroup"
                aria-labelledby="renew-duration-label"
              >
                {REGISTRATION_DURATIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setRenewDuration(days)}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                      renewDuration === days
                        ? 'bg-gradient-warm text-white'
                        : 'bg-surface-secondary text-secondary hover:text-primary'
                    }`}
                  >
                    {days / 365} year{days > 365 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-secondary mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-tertiary">Current Expiry</span>
                <span className="text-primary">
                  {formatExpiryDate(selectedName.expiresAt)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-tertiary">Renewal Fee</span>
                <span className="font-semibold text-primary">
                  {formatEther(
                    calculateRegistrationPriceWei(
                      selectedName.name,
                      renewDuration,
                    ),
                  )}{' '}
                  ETH
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedName(null)}
                className="btn-secondary flex-1 py-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRenew(selectedName.name)}
                disabled={renewing || !registrarAddress}
                className="btn-primary flex-1 py-3"
              >
                {renewing ? 'Renewing...' : 'Renew Name'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NameCard({ name, onRenew }: { name: JNSName; onRenew: () => void }) {
  const timeRemaining = formatTimeRemaining(name.expiresAt)
  const isExpiringSoon =
    name.expiresAt - Math.floor(Date.now() / 1000) < 30 * 86400 // 30 days

  return (
    <article className="card p-5 hover:scale-[1.02] transition-transform">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl gradient-cool flex items-center justify-center text-white font-bold text-lg">
          {name.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-primary truncate">
            {name.fullName}
          </h3>
          <div className="flex items-center gap-1 text-xs text-tertiary">
            <Clock className="w-3 h-3" />
            {name.isExpired ? (
              <span className="text-error">Expired</span>
            ) : (
              <span className={isExpiringSoon ? 'text-warning' : ''}>
                {timeRemaining}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-tertiary mb-4">
        Expires: {formatExpiryDate(name.expiresAt)}
      </div>

      <button
        type="button"
        onClick={onRenew}
        className={`w-full py-2.5 rounded-lg font-medium text-sm transition-all ${
          name.isExpired || isExpiringSoon ? 'btn-primary' : 'btn-secondary'
        }`}
      >
        {name.isExpired ? 'Reclaim' : 'Renew'}
      </button>
    </article>
  )
}
