import type { Page } from '@playwright/test'

/**
 * Check if page contains error indicators
 * @returns Object with error detection results
 */
export async function detectPageErrors(page: Page): Promise<{
  hasError: boolean
  errorType: 'none' | '404' | '500' | 'crash' | 'react-error' | 'network-error'
  errorMessage?: string
}> {
  const body = await page.textContent('body')

  if (!body) {
    return {
      hasError: true,
      errorType: 'crash',
      errorMessage: 'Page body is empty',
    }
  }

  // Check for Next.js 404 (but not in JavaScript chunks)
  const is404Page =
    body.includes('404') &&
    body.includes('This page could not be found') &&
    !body.includes('__next_f') // Skip if it's just in JS bundle

  if (is404Page) {
    return {
      hasError: true,
      errorType: '404',
      errorMessage: '404 page not found',
    }
  }

  // Check for Next.js error page
  if (
    body.includes('Application error: a client-side exception has occurred')
  ) {
    return {
      hasError: true,
      errorType: 'react-error',
      errorMessage: 'React client-side error',
    }
  }

  // Check for 500 server error (actual error page, not in bundle)
  const has500Error =
    body.includes('500') &&
    body.includes('Internal Server Error') &&
    !body.includes('static/chunks')

  if (has500Error) {
    return {
      hasError: true,
      errorType: '500',
      errorMessage: '500 server error',
    }
  }

  // Check for React error boundaries
  if (body.match(/Something went wrong|An error occurred/i)) {
    const errorText = body.match(/Error: ([^\n]+)/)?.[1]
    return {
      hasError: true,
      errorType: 'react-error',
      errorMessage: errorText || 'React error boundary triggered',
    }
  }

  // Check for "Error" or "Failed" in visible UI (not in bundles)
  // This catches unhandled errors that make it to the user
  const hasErrorInUI =
    body.includes('<h1') &&
    (body.match(/>\s*(Error|Failed to|Cannot|Unable to)\s*</i) ||
      body.match(/class="[^"]*error[^"]*"[^>]*>Error/i))

  if (hasErrorInUI) {
    const errorMatch = body.match(
      />\s*(Error[^<]{0,100}|Failed to[^<]{0,100})/i,
    )
    return {
      hasError: true,
      errorType: 'react-error',
      errorMessage: errorMatch?.[1] || 'UI shows error state',
    }
  }

  // Check for console errors visible in rendered HTML
  const hasVisibleError =
    !body.includes('__next_f') &&
    (body.match(/\berror\b.*\boccurred\b/i) ||
      body.match(/\bfailed\b.*\bload\b/i))

  if (hasVisibleError) {
    return {
      hasError: true,
      errorType: 'react-error',
      errorMessage: 'Error or failure message in rendered page',
    }
  }

  return {
    hasError: false,
    errorType: 'none',
  }
}

/**
 * Assert that page has no errors
 * Throws if errors are detected
 */
export async function assertNoPageErrors(page: Page): Promise<void> {
  const errorCheck = await detectPageErrors(page)

  if (errorCheck.hasError) {
    throw new Error(
      `Page has ${errorCheck.errorType} error: ${errorCheck.errorMessage || 'Unknown error'}`,
    )
  }
}

/**
 * Check for console errors in the browser
 */
export async function getConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })

  page.on('pageerror', (error) => {
    errors.push(error.message)
  })

  return errors
}
