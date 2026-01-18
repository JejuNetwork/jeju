import { Route, Routes } from 'react-router-dom'
import { JobCreatePage } from './JobCreate'
import { JobDetailPage } from './JobDetail'
import { JobsListPage } from './JobsList'

export function JobsPage() {
  return (
    <Routes>
      <Route path="/" element={<JobsListPage />} />
      <Route path="/create" element={<JobCreatePage />} />
      <Route path="/:id" element={<JobDetailPage />} />
    </Routes>
  )
}
