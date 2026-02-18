/**
 * Stars Component
 * Renders twinkling stars and occasional shooting stars in the night sky
 */

import { useEffect, useState } from 'react'

interface Star {
  id: number
  x: number
  y: number
  size: number
  opacity: number
  delay: number
  color: string
}

// Generate random stars on mount
function generateStars(count: number): Star[] {
  const stars: Star[] = []
  const colors = [
    'rgba(255, 255, 255, 0.9)',
    'rgba(255, 220, 180, 0.85)',
    'rgba(200, 220, 255, 0.85)',
    'rgba(255, 200, 150, 0.8)',
  ]

  for (let i = 0; i < count; i++) {
    stars.push({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.5 + 0.5,
      delay: Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
    })
  }
  return stars
}

export function Stars() {
  const [stars, setStars] = useState<Star[]>([])
  const [showShootingStar, setShowShootingStar] = useState(false)
  const [shootingStarKey, setShootingStarKey] = useState(0)
  const [shootingStarTop, setShootingStarTop] = useState(12)

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (prefersReducedMotion) return

    // Fewer stars on mobile for better performance
    const isMobile = window.innerWidth < 768
    setStars(generateStars(isMobile ? 15 : 25))

    // Trigger shooting star occasionally (every 30-60 seconds)
    const triggerShootingStar = () => {
      setShootingStarTop(5 + Math.random() * 20) // Random position between 5-25%
      setShowShootingStar(true)
      setShootingStarKey((k) => k + 1)
      setTimeout(() => setShowShootingStar(false), 1800)
    }

    // First shooting star after 10-20 seconds
    const initialDelay = setTimeout(
      triggerShootingStar,
      10000 + Math.random() * 10000,
    )

    // Then every 30-60 seconds
    const interval = setInterval(
      () => {
        if (Math.random() > 0.3) {
          triggerShootingStar()
        }
      },
      30000 + Math.random() * 30000,
    )

    return () => {
      clearTimeout(initialDelay)
      clearInterval(interval)
    }
  }, [])

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 2, height: '50vh' }}
      aria-hidden="true"
    >
      {/* Static stars */}
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full animate-pulse"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            backgroundColor: star.color,
            boxShadow: `0 0 ${star.size * 2}px ${star.color}`,
            animationDuration: `${2 + star.delay}s`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}

      {/* Shooting star - elegant meteor */}
      {showShootingStar && (
        <div
          key={shootingStarKey}
          className="absolute shooting-star-meteor"
          style={{ top: `${shootingStarTop}%` }}
        >
          {/* Glowing head */}
          <div
            className="absolute"
            style={{
              width: '3px',
              height: '3px',
              borderRadius: '50%',
              background: 'white',
              boxShadow:
                '0 0 3px 1px white, 0 0 8px 3px rgba(200, 220, 255, 0.8)',
            }}
          />
          {/* Long fading tail */}
          <div
            className="absolute"
            style={{
              width: '80px',
              height: '2px',
              right: '2px',
              top: '0.5px',
              background:
                'linear-gradient(90deg, transparent 0%, rgba(200,220,255,0.2) 30%, rgba(255,255,255,0.6) 100%)',
              borderRadius: '2px',
            }}
          />
        </div>
      )}

      <style>{`
        .shooting-star-meteor {
          left: -100px;
          transform: rotate(-25deg);
          animation: meteorShoot 1.5s cubic-bezier(0.2, 0, 0.3, 1) forwards;
          will-change: left, opacity;
        }

        @keyframes meteorShoot {
          0% {
            left: -100px;
            opacity: 0;
          }
          8% {
            opacity: 1;
          }
          85% {
            opacity: 0.9;
          }
          100% {
            left: 105vw;
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shooting-star-meteor {
            animation: none;
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
