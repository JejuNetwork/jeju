/**
 * Share Referral Page
 * Converted from Next.js to React Router
 * Fetches referral code and redirects to home with ref param
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../../components/LoadingSpinner'

interface ReferralCodeResponse {
  referralCode: string | null
}

async function fetchReferralCode(
  userId: string,
): Promise<ReferralCodeResponse> {
  const response = await fetch(
    `/api/users/${encodeURIComponent(userId)}/referral-code`,
  )
  if (!response.ok) {
    throw new Error(`Failed to fetch referral code: ${response.status}`)
  }
  return response.json() as Promise<ReferralCodeResponse>
}

export default function ShareReferralPage() {
  const { userId } = useParams<{ userId?: string }>()
  const navigate = useNavigate()
  const decodedUserId = userId ? decodeURIComponent(userId) : null

  const { data, isSuccess, isError } = useQuery({
    queryKey: ['referralCode', decodedUserId],
    queryFn: () => {
      if (!decodedUserId) {
        throw new Error('User ID is required to fetch referral code')
      }
      return fetchReferralCode(decodedUserId)
    },
    enabled: !!decodedUserId,
    retry: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (!decodedUserId) {
      navigate('/', { replace: true })
      return
    }

    if (isSuccess && data?.referralCode) {
      navigate(`/?ref=${data.referralCode}`, { replace: true })
    } else if (isSuccess && !data?.referralCode) {
      navigate('/', { replace: true })
    } else if (isError) {
      navigate('/', { replace: true })
    }
  }, [decodedUserId, isSuccess, isError, data, navigate])

  if (!decodedUserId) {
    return null
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <LoadingSpinner size="lg" />
      <h1
        className="mt-4 font-bold text-xl"
        style={{ color: 'var(--text-primary)' }}
      >
        Redirecting...
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Taking you to your referral link
      </p>
    </div>
  )
}
