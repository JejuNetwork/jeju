/**
 * Bazaar Feed Page
 *
 * Displays the Farcaster feed for marketplace updates
 */

import { FarcasterFeed } from '../components/FarcasterFeed'

export default function FeedPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <FarcasterFeed />
    </div>
  )
}
