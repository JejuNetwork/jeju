import { redirect } from 'next/navigation'

// Smart Pools functionality has been merged into /pools
export default function TFMMPage() {
  redirect('/pools')
}
