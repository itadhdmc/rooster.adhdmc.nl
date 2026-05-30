import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log naar de console zodat het zichtbaar is in monitoring/devtools.
    console.error('Onverwachte fout in de app:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="card p-8 max-w-md text-center">
          <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-dark">Er ging iets mis</h1>
          <p className="text-gray-400 text-sm mt-1.5">
            De pagina kon niet geladen worden. Probeer het opnieuw — blijft het misgaan, neem dan contact op met de servicedesk.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{ backgroundColor: '#3c3c3b' }}
          >
            Pagina opnieuw laden
          </button>
          <p className="text-xs text-gray-300 mt-4">
            <a href="mailto:ictservicedesk@adhdmc.nl" className="hover:text-dark transition-colors">ictservicedesk@adhdmc.nl</a>
          </p>
        </div>
      </div>
    )
  }
}
