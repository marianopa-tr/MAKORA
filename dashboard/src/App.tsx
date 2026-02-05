import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Panel } from './components/Panel'
import { Metric, MetricInline } from './components/Metric'
import { StatusIndicator, StatusBar } from './components/StatusIndicator'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { LineChart, Sparkline } from './components/LineChart'
import { NotificationBell } from './components/NotificationBell'
import { Tooltip, TooltipContent } from './components/Tooltip'
import type { Status, Config, LogEntry, Signal, Position, SignalResearch, PortfolioSnapshot } from './types'

const API_BASE = '/api'

function getApiToken(): string {
  return localStorage.getItem('makora_api_token') || (window as unknown as { VITE_MAKORA_API_TOKEN?: string }).VITE_MAKORA_API_TOKEN || ''
}

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getApiToken()
  const headers = new Headers(options.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url, { ...options, headers })
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function getPositionKey(pos: Position): string {
  if (pos.position_id) return pos.position_id
  const base = pos.asset_id ?? pos.symbol
  const entry = pos.avg_entry_price ?? pos.current_price
  return `${base}-${entry}-${pos.qty}`
}

function getAgentColor(agent: string): string {
  const colors: Record<string, string> = {
    'Analyst': 'text-hud-purple',
    'Executor': 'text-hud-cyan',
    'StockTwits': 'text-hud-success',
    'SignalResearch': 'text-hud-cyan',
    'PositionResearch': 'text-hud-purple',
    'Crypto': 'text-hud-warning',
    'System': 'text-hud-text-dim',
  }
  return colors[agent] || 'text-hud-text'
}

function isCryptoSymbol(symbol: string, cryptoSymbols: string[] = []): boolean {
  return cryptoSymbols.includes(symbol) || symbol.includes('/USD') || symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL')
}

function getVerdictColor(verdict: string): string {
  if (verdict === 'BUY') return 'text-hud-success'
  if (verdict === 'SKIP') return 'text-hud-error'
  return 'text-hud-warning'
}

function getQualityColor(quality: string): string {
  if (quality === 'excellent') return 'text-hud-success'
  if (quality === 'good') return 'text-hud-primary'
  if (quality === 'fair') return 'text-hud-warning'
  return 'text-hud-error'
}

function getSentimentColor(score: number): string {
  if (score >= 0.3) return 'text-hud-success'
  if (score <= -0.2) return 'text-hud-error'
  return 'text-hud-warning'
}

async function fetchPortfolioHistory(period: string = '1D'): Promise<PortfolioSnapshot[]> {
  try {
    const timeframe = period === '1D' ? '15Min' : '1D'
    const intraday = period === '1D' ? '&intraday_reporting=extended_hours' : ''
    const res = await authFetch(`${API_BASE}/history?period=${period}&timeframe=${timeframe}${intraday}`)
    const data = await res.json()
    if (data.ok && data.data?.snapshots) {
      return data.data.snapshots
    }
    return []
  } catch {
    return []
  }
}

// Generate mock price history for positions
function generateMockPriceHistory(currentPrice: number, unrealizedPl: number, points: number = 20): number[] {
  const prices: number[] = []
  const isPositive = unrealizedPl >= 0
  const startPrice = currentPrice * (isPositive ? 0.95 : 1.05)
  
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trend = startPrice + (currentPrice - startPrice) * progress
    const noise = trend * (Math.random() - 0.5) * 0.02
    prices.push(trend + noise)
  }
  prices[prices.length - 1] = currentPrice
  return prices
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [time, setTime] = useState(new Date())
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([])
  const [portfolioPeriod, setPortfolioPeriod] = useState<'1D' | '1W' | '1M'>('1D')

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await authFetch(`${API_BASE}/setup/status`)
        const data = await res.json()
        if (data.ok && !data.data.configured) {
          setShowSetup(true)
        }
        setSetupChecked(true)
      } catch {
        setSetupChecked(true)
      }
    }
    checkSetup()
  }, [])

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await authFetch(`${API_BASE}/status`)
        const data = await res.json()
        if (data.ok) {
          setStatus(data.data)
          setError(null)
        } else {
          setError(data.error || 'Failed to fetch status')
        }
      } catch {
        setError('Connection failed - is the agent running?')
      }
    }

    if (setupChecked && !showSetup) {
      fetchStatus()
      const interval = setInterval(fetchStatus, 5000)
      const timeInterval = setInterval(() => setTime(new Date()), 1000)

      return () => {
        clearInterval(interval)
        clearInterval(timeInterval)
      }
    }
  }, [setupChecked, showSetup])

  useEffect(() => {
    if (!setupChecked || showSetup) return

    const loadPortfolioHistory = async () => {
      const history = await fetchPortfolioHistory(portfolioPeriod)
      if (history.length > 0) {
        setPortfolioHistory(history)
      }
    }

    loadPortfolioHistory()
    const historyInterval = setInterval(loadPortfolioHistory, 60000)
    return () => clearInterval(historyInterval)
  }, [setupChecked, showSetup, portfolioPeriod])

  const handleSaveConfig = async (config: Config) => {
    const res = await authFetch(`${API_BASE}/config`, {
      method: 'POST',
      body: JSON.stringify(config),
    })
    const data = await res.json()
    if (data.ok && status) {
      setStatus({ ...status, config: data.data })
    }
  }

  // Derived state (must stay above early returns per React hooks rules)
  const account = status?.account
  const positions = status?.positions || []
  const signals = status?.signals || []
  const logs = status?.logs || []
  const costs = status?.costs || { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 }
  const config = status?.config
  const isMarketOpen = status?.clock?.is_open ?? false

  const startingEquity = config?.starting_equity || 100000
  const unrealizedPl = positions.reduce((sum, p) => sum + p.unrealized_pl, 0)
  const totalPl = account ? account.equity - startingEquity : 0
  const realizedPl = totalPl - unrealizedPl
  const totalPlPct = account ? (totalPl / startingEquity) * 100 : 0

  const positionsValue = positions.reduce((sum, p) => sum + p.market_value, 0)
  const positionsUnrealizedPct = positionsValue ? (unrealizedPl / positionsValue) * 100 : 0

  // Color palette for position lines (distinct colors for each stock)
  const positionColors = ['cyan', 'purple', 'yellow', 'blue', 'green'] as const

  // Generate mock price histories for positions (stable per session via useMemo)
  const positionPriceHistories = useMemo(() => {
    const histories: Record<string, number[]> = {}
    positions.forEach(pos => {
      histories[pos.symbol] = generateMockPriceHistory(pos.current_price, pos.unrealized_pl)
    })
    return histories
  }, [positions.map(p => p.symbol).join(',')])

  const showHistoryChart = portfolioHistory.length > 1

  const topPositionsByValue = useMemo(() => {
    return [...positions].sort((a, b) => b.market_value - a.market_value).slice(0, 5)
  }, [positions])

  // Chart data derived from portfolio history
  const portfolioChartData = useMemo(() => {
    return portfolioHistory.map(s => s.equity)
  }, [portfolioHistory])

  const portfolioChartLabels = useMemo(() => {
    return portfolioHistory.map(s => {
      const date = new Date(s.timestamp)
      if (portfolioPeriod === '1D') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })
  }, [portfolioHistory, portfolioPeriod])

  const { marketMarkers, marketHoursZone } = useMemo(() => {
    if (portfolioPeriod !== '1D' || portfolioHistory.length === 0) {
      return { marketMarkers: undefined, marketHoursZone: undefined }
    }
    
    const markers: { index: number; label: string; color?: string }[] = []
    let openIndex = -1
    let closeIndex = -1
    
    portfolioHistory.forEach((s, i) => {
      const date = new Date(s.timestamp)
      const hours = date.getHours()
      const minutes = date.getMinutes()
      
      if (hours === 9 && minutes >= 30 && minutes < 45 && openIndex === -1) {
        openIndex = i
        markers.push({ index: i, label: 'OPEN', color: 'var(--color-hud-success)' })
      } else if (hours === 16 && minutes === 0 && closeIndex === -1) {
        closeIndex = i
        markers.push({ index: i, label: 'CLOSE', color: 'var(--color-hud-error)' })
      }
    })
    
    const zone = openIndex >= 0 && closeIndex >= 0 
      ? { openIndex, closeIndex } 
      : undefined
    
    return { 
      marketMarkers: markers.length > 0 ? markers : undefined,
      marketHoursZone: zone
    }
  }, [portfolioHistory, portfolioPeriod])

  // Normalize position price histories to % change for stacked comparison view
  const normalizedPositionSeries = useMemo(() => {
    return positions.map((pos, idx) => {
      const priceHistory = positionPriceHistories[pos.symbol] || []
      if (priceHistory.length < 2) return null
      const startPrice = priceHistory[0]
      // Convert to % change from start
      const normalizedData = priceHistory.map(price => ((price - startPrice) / startPrice) * 100)
      return {
        label: pos.symbol,
        data: normalizedData,
        variant: positionColors[idx % positionColors.length],
      }
    }).filter(Boolean) as { label: string; data: number[]; variant: typeof positionColors[number] }[]
  }, [positions, positionPriceHistories])

  // Early returns (after all hooks)
  if (showSetup) {
    return <SetupWizard onComplete={() => setShowSetup(false)} />
  }

  if (error && !status) {
    const isAuthError = error.includes('Unauthorized')
    return (
      <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
        <Panel title={isAuthError ? "AUTHENTICATION REQUIRED" : "CONNECTION ERROR"} className="max-w-md w-full">
          <div className="text-center py-8">
            <div className="text-hud-error text-2xl mb-4">{isAuthError ? "NO TOKEN" : "OFFLINE"}</div>
            <p className="text-hud-text-dim text-sm mb-6">{error}</p>
            {isAuthError ? (
              <div className="space-y-4">
                <div className="text-left bg-hud-panel p-4 border border-hud-line">
                  <label className="hud-label block mb-2">API Token</label>
                  <input
                    type="password"
                    className="hud-input w-full mb-2"
                    placeholder="Enter MAKORA_API_TOKEN"
                    defaultValue={localStorage.getItem('makora_api_token') || ''}
                    onChange={(e) => localStorage.setItem('makora_api_token', e.target.value)}
                  />
                  <button 
                    onClick={() => window.location.reload()}
                    className="hud-button w-full"
                  >
                    Save & Reload
                  </button>
                </div>
                <p className="text-hud-text-dim text-xs">
                  Find your token in <code className="text-hud-primary">.dev.vars</code> (local) or Cloudflare secrets (deployed)
                </p>
              </div>
            ) : (
              <p className="text-hud-text-dim text-xs">
                Enable the agent: <code className="text-hud-primary">curl -H "Authorization: Bearer $TOKEN" localhost:8787/agent/enable</code>
              </p>
            )}
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hud-bg">
      <div className="max-w-[1920px] mx-auto p-4">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-hud-line">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-xl md:text-2xl font-light tracking-tight text-hud-text-bright">
                MAKORA
              </span>
              <span className="hud-label">v2</span>
            </div>
            <StatusIndicator 
              status={isMarketOpen ? 'active' : 'inactive'} 
              label={isMarketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
              pulse={isMarketOpen}
            />
          </div>
          <div className="flex items-center gap-3 md:gap-6 flex-wrap">
            <StatusBar
              items={[
                { label: 'LLM COST', value: `$${costs.total_usd.toFixed(4)}`, status: costs.total_usd > 1 ? 'warning' : 'active' },
                { label: 'API CALLS', value: costs.calls.toString() },
              ]}
            />
            <NotificationBell 
              overnightActivity={status?.overnightActivity}
              premarketPlan={status?.premarketPlan}
            />
            <button 
              className="hud-label hover:text-hud-primary transition-colors"
              onClick={() => setShowSettings(true)}
            >
              [CONFIG]
            </button>
            <span className="hud-value-sm font-mono">
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </span>
            <a href="https://etoro.com" target="_blank" className="hidden sm:flex items-center gap-2 opacity-100 hover:opacity-60 transition-opacity">
            <span className="hidden sm:flex items-center gap-2 opacity-100 hover:opacity-60 transition-opacity">
              <span className="hud-label text-[9px]">POWERED BY</span>
              <svg width="42" height="13" viewBox="0 0 103 33" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-hud-text-bright mb-1">
                <mask id="etoro-mask0" mask-type="alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="11" height="19">
                  <path fillRule="evenodd" clipRule="evenodd" d="M0 0.898926H10.0863V18.9245H0V0.898926Z" fill="white"/>
                </mask>
                <g mask="url(#etoro-mask0)">
                  <path fillRule="evenodd" clipRule="evenodd" d="M9.79682 11.5914C10.0543 11.3621 10.1935 11.1906 9.98568 11.1906C9.55134 11.1906 6.92125 11.5748 6.3794 9.60808C5.83718 7.64157 8.73658 1.70771 8.84588 1.45338C8.95089 1.20906 8.73389 0.898926 8.41548 0.898926C8.1028 0.898926 7.87344 1.23482 7.84047 1.27595C4.88123 4.94981 0.749934 9.53815 0.217754 11.5159C-1.12864 16.5235 4.07705 18.553 7.36295 18.9239C7.42118 18.9303 7.45003 18.8847 7.45003 18.8497V17.0717C7.45003 14.6722 8.35707 12.875 9.79682 11.5914Z" fill="currentColor"/>
                </g>
                <path fillRule="evenodd" clipRule="evenodd" d="M92.0322 11.5914C91.7747 11.3621 91.6355 11.1906 91.8433 11.1906C92.2777 11.1906 94.9077 11.5748 95.4496 9.60808C95.9918 7.64157 93.0924 1.70771 92.9831 1.45338C92.8781 1.20906 93.0951 0.898926 93.4135 0.898926C93.7262 0.898926 93.9556 1.23482 93.9885 1.27595C96.9478 4.94981 101.079 9.53815 101.611 11.5159C102.958 16.5235 97.752 18.553 94.4661 18.9239C94.4078 18.9303 94.3792 18.8847 94.3792 18.8497V17.0717C94.3792 14.6722 93.4719 12.875 92.0322 11.5914Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M88.5737 24.375C88.5737 26.317 85.9508 27.4264 84.2439 27.4264C82.4178 27.4264 79.8345 26.317 79.8345 24.375V17.5316C79.8345 15.5907 82.4178 14.6793 84.2439 14.6793C85.9508 14.6793 88.5737 15.5907 88.5737 17.5316V24.375ZM84.2439 10.4393C80.1946 10.4796 75.4683 12.8168 75.4683 17.5316V24.7034C75.4683 29.4976 80.1946 31.7563 84.2439 31.7957C88.2135 31.7563 92.9404 29.4976 92.9404 24.7034V17.5316C92.9404 12.8168 88.2135 10.4796 84.2439 10.4393Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M58.0631 24.375C58.0631 26.317 55.4393 27.4264 53.7328 27.4264C51.9072 27.4264 49.3239 26.317 49.3239 24.375V17.5316C49.3239 15.5907 51.9072 14.6793 53.7328 14.6793C55.4393 14.6793 58.0631 15.5907 58.0631 17.5316V24.375ZM53.7328 10.4393C49.6841 10.4796 44.9575 12.8168 44.9575 17.5316V24.7034C44.9575 29.4976 49.6841 31.7563 53.7328 31.7957C57.7026 31.7563 62.4295 29.4976 62.4295 24.7034V17.5316C62.4295 12.8168 57.7026 10.4796 53.7328 10.4393Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M44.6305 12.0006C41.3985 11.1276 39.0085 10.7624 35.5447 10.7618C32.0798 10.7609 29.6837 11.1271 26.4577 11.9974C26.3047 12.0315 26.2747 12.188 26.3453 12.2825C27.4497 13.1936 27.9132 14.4112 28.1279 15.7853C29.9022 15.3547 31.5019 15.1034 33.3615 14.9994V31.6548C33.3597 31.7141 33.4031 31.7506 33.4663 31.7506H37.6213C37.693 31.7562 37.7283 31.725 37.7274 31.6585V15.0023C39.5155 15.1078 41.0072 15.3579 42.768 15.7853C43.0361 14.4189 43.5955 13.1447 44.7267 12.2916C44.8271 12.1675 44.7409 12.0303 44.6305 12.0006Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M75.6267 10.5865C75.3161 10.543 74.3994 10.411 73.592 10.4412C69.6146 10.5932 65.1167 12.9359 65.1167 17.5317V17.9023V24.704V31.6994C65.1153 31.7586 65.1585 31.7952 65.2219 31.7952H69.3769C69.4487 31.8008 69.484 31.7696 69.4826 31.7029V31.332H69.4833V17.5317C69.4833 16.0161 71.3527 15.0791 72.9124 14.7632C73.3659 13.2521 74.257 12.162 75.6207 11.069C75.8598 10.8774 75.8469 10.6169 75.6267 10.5865Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M21.7664 18.7414C21.7664 18.7899 21.7477 18.8344 21.7169 18.8666C21.6834 18.902 21.6356 18.9245 21.5829 18.9245H13.619V17.4808C13.619 15.5113 15.964 14.5873 17.8161 14.5873C19.5473 14.5873 21.7674 15.5113 21.7674 17.4808L21.7664 18.7414ZM17.816 10.2871C13.7093 10.3275 9.19043 12.6983 9.19043 17.4808V24.7543C9.19043 29.617 13.7093 31.9081 17.816 31.948C20.7583 31.9189 24.1081 30.7041 25.7025 28.1288C25.7557 28.0433 25.7086 27.9306 25.6276 27.8834C24.2219 27.0789 23.4059 26.6334 22.0127 25.8507C21.9688 25.826 21.9215 25.826 21.8859 25.8852C21.1247 27.1508 19.182 27.8492 17.816 27.8492C15.964 27.8492 13.619 26.7237 13.619 24.7543V22.5812H25.0033C25.6115 22.5812 26.1043 22.0894 26.1043 21.4822V17.4808C26.1043 12.6983 21.8423 10.3275 17.816 10.2871Z" fill="currentColor"/>
              </svg>
            </span>
            </a>
          </div>
        </header>

        <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-4">
          {/* Row 1: Account, Positions, LLM Costs */}
          <div className="col-span-4 md:col-span-4 lg:col-span-3">
            <Panel title="ACCOUNT" className="h-full">
              {account ? (
                <div className="space-y-4">
                  <Metric label="EQUITY" value={formatCurrency(account.equity)} size="xl" />
                  <div className="grid grid-cols-2 gap-4">
                    <Metric label="CASH" value={formatCurrency(account.cash)} size="md" />
                    <Metric label="BUYING POWER" value={formatCurrency(account.buying_power)} size="md" />
                  </div>
                  <div className="pt-2 border-t border-hud-line space-y-2">
                    <Metric 
                      label="TOTAL P&L" 
                      value={`${formatCurrency(totalPl)} (${formatPercent(totalPlPct)})`}
                      size="md"
                      color={totalPl >= 0 ? 'success' : 'error'}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <MetricInline 
                        label="REALIZED" 
                        value={formatCurrency(realizedPl)}
                        color={realizedPl >= 0 ? 'success' : 'error'}
                      />
                      <MetricInline 
                        label="UNREALIZED" 
                        value={formatCurrency(unrealizedPl)}
                        color={unrealizedPl >= 0 ? 'success' : 'error'}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-hud-text-dim text-sm">Loading...</div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-4 lg:col-span-5">
            <Panel title="POSITIONS" titleRight={`${positions.length}/${config?.max_positions || 5}`} className="h-full">
              {positions.length === 0 ? (
                <div className="text-hud-text-dim text-sm py-8 text-center">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-hud-line/50">
                        <th className="hud-label text-left py-2 px-2">Symbol</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Qty</th>
                        <th className="hud-label text-right py-2 px-2 hidden md:table-cell">Value</th>
                        <th className="hud-label text-right py-2 px-2">P&L</th>
                        <th className="hud-label text-center py-2 px-2">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos: Position) => {
                        const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                        const priceHistory = positionPriceHistories[pos.symbol] || []
                        const posEntry = status?.positionEntries?.[pos.symbol]
                        const staleness = status?.stalenessAnalysis?.[pos.symbol]
                        const holdTime = posEntry ? Math.floor((Date.now() - posEntry.entry_time) / 3600000) : null
                        
                        return (
                          <motion.tr 
                            key={getPositionKey(pos)}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="border-b border-hud-line/20 hover:bg-hud-line/10"
                          >
                            <td className="hud-value-sm py-2 px-2">
                              <Tooltip
                                position="right"
                                content={
                                  <TooltipContent
                                    title={pos.symbol}
                                    items={[
                                      { label: 'Entry Price', value: posEntry ? formatCurrency(posEntry.entry_price) : 'N/A' },
                                      { label: 'Current Price', value: formatCurrency(pos.current_price) },
                                      { label: 'Hold Time', value: holdTime !== null ? `${holdTime}h` : 'N/A' },
                                      { label: 'Entry Sentiment', value: posEntry ? `${(posEntry.entry_sentiment * 100).toFixed(0)}%` : 'N/A' },
                                      ...(staleness ? [{ 
                                        label: 'Staleness', 
                                        value: `${(staleness.score * 100).toFixed(0)}%`,
                                        color: staleness.shouldExit ? 'text-hud-error' : 'text-hud-text'
                                      }] : []),
                                    ]}
                                    description={posEntry?.entry_reason}
                                  />
                                }
                              >
                                <span className="cursor-help border-b border-dotted border-hud-text-dim">
                                  {isCryptoSymbol(pos.symbol, config?.crypto_symbols) && (
                                    <span className="text-hud-warning mr-1">₿</span>
                                  )}
                                  {pos.symbol}
                                </span>
                              </Tooltip>
                            </td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden sm:table-cell">{pos.qty}</td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden md:table-cell">{formatCurrency(pos.market_value)}</td>
                            <td className={clsx(
                              'hud-value-sm text-right py-2 px-2',
                              pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error'
                            )}>
                              <div>{formatCurrency(pos.unrealized_pl)}</div>
                              <div className="text-xs opacity-70">{formatPercent(plPct)}</div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="flex justify-center">
                                <Sparkline data={priceHistory} width={60} height={20} />
                              </div>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="LLM COSTS" className="h-full">
              <div className="grid grid-cols-2 gap-4">
                <Metric label="TOTAL SPENT" value={`$${costs.total_usd.toFixed(4)}`} size="lg" />
                <Metric label="API CALLS" value={costs.calls.toString()} size="lg" />
                <MetricInline label="TOKENS IN" value={costs.tokens_in.toLocaleString()} />
                <MetricInline label="TOKENS OUT" value={costs.tokens_out.toLocaleString()} />
                <MetricInline 
                  label="AVG COST/CALL" 
                  value={costs.calls > 0 ? `$${(costs.total_usd / costs.calls).toFixed(6)}` : '$0'} 
                />
                <MetricInline label="MODEL" value={config?.llm_model || 'gpt-4o-mini'} />
              </div>
            </Panel>
          </div>

          {/* Row 2: Portfolio Performance Chart */}
          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <Panel 
              title="PORTFOLIO PERFORMANCE" 
              titleRight={
                <div className="flex gap-2">
                  {(['1D', '1W', '1M'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPortfolioPeriod(p)}
                      className={clsx(
                        'hud-label transition-colors',
                        portfolioPeriod === p ? 'text-hud-primary' : 'text-hud-text-dim hover:text-hud-text'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              } 
              className="h-[320px]"
            >
              {showHistoryChart ? (
                <div className="h-full w-full">
                  <LineChart
                    series={[{ label: 'Equity', data: portfolioChartData, variant: totalPl >= 0 ? 'green' : 'red' }]}
                    labels={portfolioChartLabels}
                    showArea={true}
                    showGrid={true}
                    showDots={false}
                    formatValue={(v) => `$${(v / 1000).toFixed(1)}k`}
                    markers={marketMarkers}
                    marketHours={marketHoursZone}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  <div className="border border-hud-line/40 rounded p-3 flex flex-col justify-between">
                    <div className="hud-label text-hud-text-dim">OPEN POSITIONS SUMMARY</div>
                    <div className="mt-3 space-y-2">
                      <MetricInline label="COUNT" value={positions.length} />
                      <MetricInline label="TOTAL VALUE" value={formatCurrency(positionsValue)} />
                      <MetricInline
                        label="UNREALIZED"
                        value={`${formatCurrency(unrealizedPl)} (${formatPercent(positionsUnrealizedPct)})`}
                        color={unrealizedPl >= 0 ? 'success' : 'error'}
                      />
                    </div>
                    <div className="mt-4 text-xs text-hud-text-dim">
                      Live snapshot based on current eToro rates.
                    </div>
                  </div>
                  <div className="border border-hud-line/40 rounded p-3 flex flex-col">
                    <div className="hud-label text-hud-text-dim">TOP POSITIONS</div>
                    {positions.length === 0 ? (
                      <div className="text-hud-text-dim text-sm mt-4">No open positions</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {topPositionsByValue.map((pos) => {
                          const plPct = (pos.unrealized_pl / (pos.market_value || 1)) * 100
                          return (
                            <div key={getPositionKey(pos)} className="flex justify-between items-center text-xs">
                              <span className="hud-value-sm">{pos.symbol}</span>
                              <span className="hud-value-sm">{formatCurrency(pos.market_value)}</span>
                              <span className={clsx('hud-value-sm', pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                                {formatPercent(plPct)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="POSITION PERFORMANCE" titleRight="% CHANGE" className="h-[320px]">
              {positions.length === 0 ? (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  No positions to display
                </div>
              ) : normalizedPositionSeries.length > 0 ? (
                <div className="h-full flex flex-col">
                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mb-2 pb-2 border-b border-hud-line/30 shrink-0">
                    {positions.slice(0, 5).map((pos: Position, idx: number) => {
                      const isPositive = pos.unrealized_pl >= 0
                      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                      const color = positionColors[idx % positionColors.length]
                      return (
                        <div key={getPositionKey(pos)} className="flex items-center gap-1.5">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: `var(--color-hud-${color})` }}
                          />
                          <span className="hud-value-sm">{pos.symbol}</span>
                          <span className={clsx('hud-label', isPositive ? 'text-hud-success' : 'text-hud-error')}>
                            {formatPercent(plPct)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {/* Stacked chart */}
                  <div className="flex-1 min-h-0 w-full">
                    <LineChart
                      series={normalizedPositionSeries.slice(0, 5)}
                      showArea={false}
                      showGrid={true}
                      showDots={false}
                      animated={false}
                      formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  Loading position data...
                </div>
              )}
            </Panel>
          </div>

          {/* Row 3: Signals, Activity, Research */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVE SIGNALS" titleRight={signals.length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-1">
                {signals.length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">Gathering signals...</div>
                ) : (
                  signals.slice(0, 20).map((sig: Signal, i: number) => (
                    <Tooltip
                      key={`${sig.symbol}-${sig.source}-${i}`}
                      position="right"
                      content={
                        <TooltipContent
                          title={`${sig.symbol} - ${sig.source.toUpperCase()}`}
                          items={[
                            { label: 'Sentiment', value: `${(sig.sentiment * 100).toFixed(0)}%`, color: getSentimentColor(sig.sentiment) },
                            { label: 'Volume', value: sig.volume },
                            ...(sig.bullish !== undefined ? [{ label: 'Bullish', value: sig.bullish, color: 'text-hud-success' }] : []),
                            ...(sig.bearish !== undefined ? [{ label: 'Bearish', value: sig.bearish, color: 'text-hud-error' }] : []),
                            ...(sig.score !== undefined ? [{ label: 'Score', value: sig.score }] : []),
                            ...(sig.upvotes !== undefined ? [{ label: 'Upvotes', value: sig.upvotes }] : []),
                            ...(sig.momentum !== undefined ? [{ label: 'Momentum', value: `${sig.momentum >= 0 ? '+' : ''}${sig.momentum.toFixed(2)}%` }] : []),
                            ...(sig.price !== undefined ? [{ label: 'Price', value: formatCurrency(sig.price) }] : []),
                          ]}
                          description={sig.reason}
                        />
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={clsx(
                          "flex items-center justify-between py-1 px-2 border-b border-hud-line/10 hover:bg-hud-line/10 cursor-help",
                          sig.isCrypto && "bg-hud-warning/5"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {sig.isCrypto && <span className="text-hud-warning text-xs">₿</span>}
                          <span className="hud-value-sm">{sig.symbol}</span>
                          <span className={clsx('hud-label', sig.isCrypto ? 'text-hud-warning' : '')}>{sig.source.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {sig.isCrypto && sig.momentum !== undefined ? (
                            <span className={clsx('hud-label hidden sm:inline', sig.momentum >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                              {sig.momentum >= 0 ? '+' : ''}{sig.momentum.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="hud-label hidden sm:inline">VOL {sig.volume}</span>
                          )}
                          <span className={clsx('hud-value-sm', getSentimentColor(sig.sentiment))}>
                            {(sig.sentiment * 100).toFixed(0)}%
                          </span>
                        </div>
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVITY FEED" titleRight="LIVE" className="h-80">
              <div className="overflow-y-auto h-full font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="text-hud-text-dim py-4 text-center">Waiting for activity...</div>
                ) : (
                  logs.slice(-50).reverse().map((log: LogEntry, i: number) => (
                    <motion.div 
                      key={`${log.timestamp}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-2 py-1 border-b border-hud-line/10"
                    >
                      <span className="text-hud-text-dim shrink-0 hidden sm:inline w-[52px]">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                      <span className={clsx('shrink-0 w-[72px] text-right', getAgentColor(log.agent))}>
                        {log.agent}
                      </span>
                      <span className="text-hud-text flex-1 text-right wrap-break-word">
                        {log.action}
                        {log.symbol && <span className="text-hud-primary ml-1">({log.symbol})</span>}
                      </span>
                    </motion.div>
                  ))
                )}

              </div>
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="SIGNAL RESEARCH" titleRight={Object.keys(status?.signalResearch || {}).length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-2">
                {Object.entries(status?.signalResearch || {}).length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">Researching candidates...</div>
                ) : (
                  Object.entries(status?.signalResearch || {})
                    .sort(([, a], [, b]) => b.timestamp - a.timestamp)
                    .map(([symbol, research]: [string, SignalResearch]) => (
                    <Tooltip
                      key={symbol}
                      position="left"
                      content={
                        <div className="space-y-2 min-w-[200px]">
                          <div className="hud-label text-hud-primary border-b border-hud-line/50 pb-1">
                            {symbol} DETAILS
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Confidence</span>
                              <span className="text-hud-text-bright">{(research.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Sentiment</span>
                              <span className={getSentimentColor(research.sentiment)}>
                                {(research.sentiment * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Analyzed</span>
                              <span className="text-hud-text">
                                {new Date(research.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                              </span>
                            </div>
                          </div>
                          {research.catalysts.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-[9px] text-hud-text-dim">CATALYSTS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.catalysts.map((c, i) => (
                                  <li key={i} className="text-[10px] text-hud-success">+ {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {research.red_flags.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-[9px] text-hud-text-dim">RED FLAGS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.red_flags.map((f, i) => (
                                  <li key={i} className="text-[10px] text-hud-error">- {f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-2 border border-hud-line/30 rounded hover:border-hud-line/60 cursor-help transition-colors"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="hud-value-sm">{symbol}</span>
                          <div className="flex items-center gap-2">
                            <span className={clsx('hud-label', getQualityColor(research.entry_quality))}>
                              {research.entry_quality.toUpperCase()}
                            </span>
                            <span className={clsx('hud-value-sm font-bold', getVerdictColor(research.verdict))}>
                              {research.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-hud-text-dim leading-tight mb-1">{research.reasoning}</p>
                        {research.red_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {research.red_flags.slice(0, 2).map((flag, i) => (
                              <span key={i} className="text-xs text-hud-error bg-hud-error/10 px-1 rounded">
                                {flag.slice(0, 30)}...
                              </span>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>

        <footer className="mt-4 pt-3 border-t border-hud-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-wrap gap-4 md:gap-6">
            {config && (
              <>
                <MetricInline label="MAX POS" value={`$${config.max_position_value}`} />
                <MetricInline label="MIN SENT" value={`${(config.min_sentiment_score * 100).toFixed(0)}%`} />
                <MetricInline label="TAKE PROFIT" value={`${config.take_profit_pct}%`} />
                <MetricInline label="STOP LOSS" value={`${config.stop_loss_pct}%`} />
                <span className="hidden lg:inline text-hud-line">|</span>
                <MetricInline 
                  label="CRYPTO" 
                  value={config.crypto_enabled ? '24/7' : 'OFF'} 
                  valueClassName={config.crypto_enabled ? 'text-hud-warning' : 'text-hud-text-dim'}
                />
                {config.crypto_enabled && (
                  <MetricInline label="SYMBOLS" value={(config.crypto_symbols || ['BTC', 'ETH', 'SOL']).map(s => s.split('/')[0]).join('/')} />
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="hud-label hidden md:inline">AUTONOMOUS TRADING SYSTEM</span>
            <span className="hud-value-sm">DEMO MODE</span>
          </div>
        </footer>
      </div>

      <AnimatePresence>
        {showSettings && config && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SettingsModal 
              config={config} 
              onSave={handleSaveConfig} 
              onClose={() => setShowSettings(false)} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
