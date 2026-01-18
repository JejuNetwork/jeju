import { Route, Routes } from 'react-router-dom'
import { BountiesListPage } from './BountiesList'
import { BountyCreatePage } from './BountyCreate'
import { BountyDetailPage } from './BountyDetail'

export function BountiesPage() {
  return (
    <Routes>
      <Route path="/" element={<BountiesListPage />} />
      <Route path="/create" element={<BountyCreatePage />} />
      <Route path="/:id" element={<BountyDetailPage />} />
    </Routes>
  )
}
