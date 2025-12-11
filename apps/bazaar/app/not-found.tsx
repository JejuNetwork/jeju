'use client'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-gray-500">Page not found</p>
      <a href="/" className="text-blue-500 hover:underline">
        Go back home
      </a>
    </div>
  )
}

