/**
 * Autocrat Feed Page
 *
 * Displays the Farcaster feed for governance updates
 */

import { FarcasterFeed } from '../components/FarcasterFeed'

export default function FeedPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <FarcasterFeed />
    </div>
  )
}
