/**
 * Simple markdown renderer for basic formatting without external dependencies.
 * Supports: links, bold, inline code, and auto-linking URLs.
 */

interface SimpleMarkdownProps {
  content: string
  className?: string
}

export function SimpleMarkdown({ content, className = '' }: SimpleMarkdownProps) {
  const elements = parseMarkdown(content)
  return <span className={className}>{elements}</span>
}

function parseMarkdown(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = []
  let key = 0

  // Combined regex for markdown patterns
  // Order matters: more specific patterns first
  const patterns = [
    // Markdown links: [text](url)
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    // Raw URLs (not already in markdown link)
    /(?<!\]\()https?:\/\/[^\s<>)\]]+/g,
    // Bold: **text** or __text__
    /\*\*([^*]+)\*\*|__([^_]+)__/g,
    // Inline code: `code`
    /`([^`]+)`/g,
  ]

  // Process text segment by segment
  let remaining = text
  let lastIndex = 0

  // First pass: find all markdown links and raw URLs
  const urlPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<!\]\()https?:\/\/[^\s<>)\]]+/g
  const boldPattern = /\*\*([^*]+)\*\*|__([^_]+)__/g
  const codePattern = /`([^`]+)`/g

  // Split by all patterns and reconstruct
  const allPatterns = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<!\]\()https?:\/\/[^\s<>)\]]+|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g

  let match: RegExpExecArray | null
  let lastEnd = 0

  while ((match = allPatterns.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastEnd) {
      result.push(text.slice(lastEnd, match.index))
    }

    const fullMatch = match[0]

    // Check what type of match
    if (fullMatch.startsWith('[') && fullMatch.includes('](')) {
      // Markdown link: [text](url)
      const linkMatch = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(fullMatch)
      if (linkMatch) {
        result.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-primary)] hover:underline break-all"
          >
            {linkMatch[1]}
          </a>
        )
      }
    } else if (fullMatch.startsWith('http')) {
      // Raw URL
      result.push(
        <a
          key={key++}
          href={fullMatch}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-primary)] hover:underline break-all"
        >
          {fullMatch}
        </a>
      )
    } else if (fullMatch.startsWith('**') || fullMatch.startsWith('__')) {
      // Bold text
      const boldMatch = /\*\*([^*]+)\*\*|__([^_]+)__/.exec(fullMatch)
      if (boldMatch) {
        result.push(<strong key={key++}>{boldMatch[1] || boldMatch[2]}</strong>)
      }
    } else if (fullMatch.startsWith('`')) {
      // Inline code
      const codeMatch = /`([^`]+)`/.exec(fullMatch)
      if (codeMatch) {
        result.push(
          <code
            key={key++}
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          >
            {codeMatch[1]}
          </code>
        )
      }
    }

    lastEnd = match.index + fullMatch.length
  }

  // Add remaining text
  if (lastEnd < text.length) {
    result.push(text.slice(lastEnd))
  }

  return result.length > 0 ? result : [text]
}
