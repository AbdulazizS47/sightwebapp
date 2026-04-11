import React, { useEffect, useMemo, useState } from 'react'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { src, alt, style, className, decoding, ...rest } = props
  const normalizedSrc = typeof src === 'string' ? src.trim() : ''
  const [didError, setDidError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setDidError(false)
    setAttempt(0)
  }, [normalizedSrc])

  const displaySrc = useMemo(() => {
    if (
      !normalizedSrc ||
      attempt === 0 ||
      normalizedSrc.startsWith('data:') ||
      normalizedSrc.startsWith('blob:')
    ) {
      return normalizedSrc
    }

    try {
      const url = new URL(
        normalizedSrc,
        typeof window === 'undefined' ? 'http://localhost' : window.location.href,
      )
      url.searchParams.set('_img_retry', String(attempt))
      return url.toString()
    } catch {
      const separator = normalizedSrc.includes('?') ? '&' : '?'
      return `${normalizedSrc}${separator}_img_retry=${attempt}`
    }
  }, [attempt, normalizedSrc])

  const handleError = () => {
    if (!normalizedSrc) {
      setDidError(true)
      return
    }

    if (attempt < 1) {
      setAttempt((current) => current + 1)
      return
    }

    setDidError(true)
  }

  return didError ? (
    <div
      className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
      style={style}
    >
      <div className="flex items-center justify-center w-full h-full">
        <img src={ERROR_IMG_SRC} alt="Error loading image" {...rest} data-original-url={normalizedSrc} />
      </div>
    </div>
  ) : (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      style={style}
      decoding={decoding ?? 'async'}
      {...rest}
      onError={handleError}
    />
  )
}
