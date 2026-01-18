(() => {
  const themeToggle = document.getElementById('themeToggle')
  const themeIcon = document.getElementById('themeIcon')
  const container = document.getElementById('graphiql-container')

  if (!(themeToggle instanceof HTMLElement)) {
    throw new Error('Missing #themeToggle')
  }
  if (!(themeIcon instanceof HTMLElement)) {
    throw new Error('Missing #themeIcon')
  }
  if (!container) {
    throw new Error('Missing #graphiql-container')
  }

  const savedTheme = localStorage.getItem('jeju-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light')

  document.body.setAttribute('data-theme', initialTheme)
  themeIcon.textContent = initialTheme === 'dark' ? '☀️' : '🌙'

  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme')
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
    document.body.setAttribute('data-theme', nextTheme)
    localStorage.setItem('jeju-theme', nextTheme)
    themeIcon.textContent = nextTheme === 'dark' ? '☀️' : '🌙'
  })

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', (e) => {
    if (localStorage.getItem('jeju-theme')) return
    const nextTheme = e.matches ? 'dark' : 'light'
    document.body.setAttribute('data-theme', nextTheme)
    themeIcon.textContent = nextTheme === 'dark' ? '☀️' : '🌙'
  })

  if (typeof React !== 'object' || React === null) {
    throw new Error('React global not available')
  }
  if (typeof ReactDOM !== 'object' || ReactDOM === null) {
    throw new Error('ReactDOM global not available')
  }
  if (
    typeof GraphiQL !== 'function' ||
    typeof GraphiQL.createFetcher !== 'function'
  ) {
    throw new Error('GraphiQL global not available')
  }

  const graphqlUrl = '/graphql'
  const fetcher = GraphiQL.createFetcher({ url: graphqlUrl })
  const defaultQuery = `query {
  blocks(limit: 5, orderBy: number_DESC) {
    number
    hash
    timestamp
  }
}`

  ReactDOM.createRoot(container).render(
    React.createElement(GraphiQL, {
      fetcher,
      defaultQuery,
      defaultEditorToolsVisibility: false,
    }),
  )
})()






