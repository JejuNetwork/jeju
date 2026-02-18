/**
 * Simple markdown renderer for basic formatting without external dependencies.
 * Supports: headings, links, bold, inline code, and auto-linking URLs.
 */

interface SimpleMarkdownProps {
  content: string
  className?: string
}

export function SimpleMarkdown({ content, className = '' }: SimpleMarkdownProps) {
  // First, extract code blocks before line-by-line processing
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  const parts: React.ReactNode[] = []
  let lastEnd = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Process text before code block
    if (match.index > lastEnd) {
      parts.push(
        <span key={key++}>{processLines(content.slice(lastEnd, match.index), key)}</span>
      )
      key += 1000
    }

    const lang = match[1].toLowerCase()
    const code = match[2].trim()

    parts.push(
      <pre
        key={key++}
        className="my-2 p-3 rounded text-xs font-mono overflow-x-auto"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        <code>{lang === 'json' ? formatJson(code) : code}</code>
      </pre>
    )
    lastEnd = match.index + match[0].length
  }

  // Process remaining text
  if (lastEnd < content.length) {
    parts.push(<span key={key++}>{processLines(content.slice(lastEnd), key)}</span>)
  }

  return <span className={className}>{parts.length > 0 ? parts : processLines(content, 0)}</span>
}

function formatJson(code: string): React.ReactNode {
  try {
    const parsed = JSON.parse(code)
    const formatted = JSON.stringify(parsed, null, 2)
    return highlightJson(formatted)
  } catch {
    return code
  }
}

function highlightJson(json: string): React.ReactNode[] {
  const result: React.ReactNode[] = []
  // Simple regex-based highlighting for JSON
  const tokenRegex = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+\.?\d*)|(\btrue\b|\bfalse\b|\bnull\b)/g
  let match: RegExpExecArray | null
  let lastEnd = 0
  let key = 0

  while ((match = tokenRegex.exec(json)) !== null) {
    if (match.index > lastEnd) {
      result.push(json.slice(lastEnd, match.index))
    }

    if (match[1]) {
      // Key (with colon)
      result.push(
        <span key={key++} style={{ color: 'var(--color-primary)' }}>
          {match[1]}
        </span>
      )
      result.push(':')
    } else if (match[2]) {
      // String value
      result.push(
        <span key={key++} style={{ color: '#a8cc8c' }}>
          {match[2]}
        </span>
      )
    } else if (match[3]) {
      // Number
      result.push(
        <span key={key++} style={{ color: '#dbab79' }}>
          {match[3]}
        </span>
      )
    } else if (match[4]) {
      // Boolean/null
      result.push(
        <span key={key++} style={{ color: '#e88388' }}>
          {match[4]}
        </span>
      )
    }

    lastEnd = match.index + match[0].length
  }

  if (lastEnd < json.length) {
    result.push(json.slice(lastEnd))
  }

  return result
}

function processLines(content: string, baseKey: number): React.ReactNode[] {
  const lines = content.split('\n')
  let key = baseKey

  return lines.map((line, lineIndex) => {
    // Check for headings at start of line
    const h3Match = line.match(/^###\s+(.+)$/)
    if (h3Match) {
      return (
        <strong key={key++} className="block text-sm font-semibold mt-2 mb-1">
          {parseInline(h3Match[1], key)}
        </strong>
      )
    }

    const h2Match = line.match(/^##\s+(.+)$/)
    if (h2Match) {
      return (
        <strong key={key++} className="block text-base font-semibold mt-3 mb-1">
          {parseInline(h2Match[1], key)}
        </strong>
      )
    }

    const h1Match = line.match(/^#\s+(.+)$/)
    if (h1Match) {
      return (
        <strong key={key++} className="block text-lg font-bold mt-3 mb-2">
          {parseInline(h1Match[1], key)}
        </strong>
      )
    }

    // Regular line - parse inline elements
    const inlineElements = parseInline(line, key)
    key += 100 // Increment key space for next line

    // Add line break between lines (except last)
    if (lineIndex < lines.length - 1) {
      return (
        <span key={`line-${lineIndex}`}>
          {inlineElements}
          <br />
        </span>
      )
    }

    return <span key={`line-${lineIndex}`}>{inlineElements}</span>
  })
}

function parseInline(text: string, baseKey: number): React.ReactNode[] {
  const result: React.ReactNode[] = []
  let key = baseKey

  // Combined regex for inline markdown patterns
  const allPatterns =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(?<!\]\()https?:\/\/[^\s<>)\]]+|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g

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
