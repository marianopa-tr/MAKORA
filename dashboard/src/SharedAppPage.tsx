import { useState, useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { Panel } from './components/Panel'
import { Metric, MetricInline } from './components/Metric'
import { StatusIndicator } from './components/StatusIndicator'
import { Tooltip, TooltipContent } from './components/Tooltip'
import { Sparkline } from './components/LineChart'
import type { Status, Position, SignalResearch } from './types'

// ── API helper ──────────────────────────────────────────────────────
// Sends eToro credentials from localStorage as custom headers.
// Keys are never stored server-side.
//
// API_BASE is configurable via VITE_APP_API_BASE:
//   - "/app"  (default) — for full deployment where routes are /app/*
//   - ""      — for standalone deployment where routes are at root /
// ────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_APP_API_BASE ?? '/app'

interface AppKeys {
  apiKey: string
  userKey: string
  env: 'demo' | 'real'
}

const STORAGE_KEY = 'makora_app_keys'

function getAppKeys(): AppKeys | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('demo_etoro_keys')
    if (!raw) return null
    return JSON.parse(raw) as AppKeys
  } catch {
    return null
  }
}

function saveAppKeys(keys: AppKeys) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  localStorage.removeItem('demo_etoro_keys')
}

function clearAppKeys() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem('demo_etoro_keys')
}

function appFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const keys = getAppKeys()
  if (!keys) return Promise.reject(new Error('No app keys configured'))
  const headers = new Headers(options.headers)
  headers.set('X-Etoro-Api-Key', keys.apiKey)
  headers.set('X-Etoro-User-Key', keys.userKey)
  headers.set('X-Etoro-Env', keys.env || 'demo')
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

// ── Formatting helpers ──────────────────────────────────────────────

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
    Analyst: 'text-hud-purple',
    Executor: 'text-hud-cyan',
    StockTwits: 'text-hud-success',
    SignalResearch: 'text-hud-cyan',
    PositionResearch: 'text-hud-purple',
    Crypto: 'text-hud-warning',
    System: 'text-hud-text-dim',
  }
  return colors[agent] || 'text-hud-text'
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

function generateMockPriceHistory(
  currentPrice: number,
  unrealizedPl: number,
  points = 20
): number[] {
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

// ── Phase 1: Key Entry Form ─────────────────────────────────────────

function KeyEntryForm({ onConnect }: { onConnect: () => void }) {
  const [apiKey, setApiKey] = useState('')
  const [userKey, setUserKey] = useState('')
  const [env, setEnv] = useState<'demo' | 'real'>('demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  const handleConnect = async () => {
    if (!apiKey.trim() || !userKey.trim()) {
      setError('Both API Key and User Key are required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      saveAppKeys({ apiKey: apiKey.trim(), userKey: userKey.trim(), env })
      const res = await appFetch('/status')
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Connection failed' }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onConnect()
    } catch (err) {
      clearAppKeys()
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-hud-text-bright text-3xl font-light tracking-wider mb-2">
            MAKORA
          </h1>
          <p className="hud-label text-xs">
            AUTONOMOUS TRADING AGENT — CONNECT YOUR ACCOUNT
          </p>
        </div>

        <Panel title="CONNECT YOUR ETORO ACCOUNT" className="w-full">
          <div className="space-y-5 py-2">
            <p className="text-hud-text-dim text-[10px] leading-relaxed">
              Enter your eToro API credentials to connect. Keys are stored in
              your browser only and sent with each request — never saved on the
              server.
            </p>

            <div>
              <label className="hud-label block mb-1.5">eToro API Key</label>
              <input
                type="password"
                className="hud-input w-full"
                placeholder="Your eToro API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>

            <div>
              <label className="hud-label block mb-1.5">eToro User Key</label>
              <input
                type="password"
                className="hud-input w-full"
                placeholder="Your eToro User Key"
                value={userKey}
                onChange={(e) => setUserKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>

            <div>
              <label className="hud-label block mb-1.5">Environment</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setEnv('demo')}
                  className={clsx(
                    'flex-1 py-2 text-center text-[10px] uppercase tracking-wider border transition-all',
                    env === 'demo'
                      ? 'border-hud-primary bg-hud-primary/10 text-hud-primary'
                      : 'border-hud-line text-hud-text-dim hover:border-hud-dim'
                  )}
                >
                  Demo
                </button>
                <button
                  onClick={() => setEnv('real')}
                  className={clsx(
                    'flex-1 py-2 text-center text-[10px] uppercase tracking-wider border transition-all',
                    env === 'real'
                      ? 'border-hud-warning bg-hud-warning/10 text-hud-warning'
                      : 'border-hud-line text-hud-text-dim hover:border-hud-dim'
                  )}
                >
                  Real
                </button>
              </div>
              {env === 'real' && (
                <p className="text-hud-warning text-[9px] mt-1.5">
                  WARNING: Real mode will execute live trades with real money on your account
                </p>
              )}
            </div>

            {/* Disclaimer */}
            <div className="border border-hud-warning/30 bg-hud-warning/5 p-3 space-y-2">
              <p className="text-hud-warning text-[9px] font-medium uppercase tracking-wider">
                Important Disclaimer
              </p>
              <p className="text-hud-text-dim text-[10px] leading-relaxed">
                This is an <span className="text-hud-text">experimental autonomous trading agent</span>.
                Once connected, it will <span className="text-hud-text">immediately begin analyzing markets
                and may open or close positions</span> on your eToro account without further confirmation.
              </p>
              <ul className="text-hud-text-dim text-[10px] leading-relaxed space-y-1 pl-3 list-disc">
                <li>Trading decisions are made by AI and may result in <span className="text-hud-warning">financial losses</span></li>
                <li>Past performance does not guarantee future results</li>
                <li>The developers assume <span className="text-hud-text">no liability</span> for any trades executed</li>
                <li>You are solely responsible for any activity on your account</li>
                <li>Use a <span className="text-hud-text">demo account</span> first to evaluate behavior before risking real funds</li>
              </ul>
              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 accent-hud-warning"
                />
                <span className="text-[10px] text-hud-text leading-tight">
                  I understand the risks. This is experimental software and I accept
                  full responsibility for any trades placed on my account.
                </span>
              </label>
            </div>

            {error && (
              <div className="text-hud-error text-[10px] bg-hud-error/10 border border-hud-error/30 p-2">
                {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || !apiKey.trim() || !userKey.trim() || !accepted}
              className="hud-button w-full"
            >
              {loading ? 'CONNECTING...' : 'CONNECT & START TRADING'}
            </button>
          </div>
        </Panel>

        <p className="text-hud-text-dim text-[9px] text-center mt-4">
          Your credentials are stored in your browser only (localStorage) and
          transmitted via HTTPS headers. They are never persisted on our servers.
        </p>
      </div>
    </div>
  )
}

// ── Phase 2: Live Dashboard ─────────────────────────────────────────

function SharedDashboard({ onDisconnect }: { onDisconnect: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(new Date())
  const [tickInFlight, setTickInFlight] = useState(false)
  const tickInFlightRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await appFetch('/status')
      if (res.status === 401) {
        setError('Invalid credentials — please reconnect')
        return
      }
      const data = await res.json()
      if (data.ok) {
        setStatus(data.data as Status)
        setError(null)
      } else {
        setError(data.error || 'Unknown error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [])

  const triggerTick = useCallback(async () => {
    if (tickInFlightRef.current) return
    tickInFlightRef.current = true
    setTickInFlight(true)
    try {
      const res = await appFetch('/tick', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setStatus(data.data as Status)
          setError(null)
        }
      }
    } catch {
      // Non-critical — will retry
    } finally {
      tickInFlightRef.current = false
      setTickInFlight(false)
    }
  }, [])

  // Poll status every 5s
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5_000)
    const clock = setInterval(() => setTime(new Date()), 1_000)
    return () => {
      clearInterval(interval)
      clearInterval(clock)
    }
  }, [fetchStatus])

  // Trigger tick every 30s
  useEffect(() => {
    triggerTick()
    const interval = setInterval(triggerTick, 30_000)
    return () => clearInterval(interval)
  }, [triggerTick])

  // ── Derived ───────────────────────────────────────────────────
  const account = status?.account
  const positions = status?.positions || []
  const signals = status?.signals || []
  const logs = status?.logs || []
  const config = status?.config
  const isMarketOpen = status?.clock?.is_open ?? false

  const unrealizedPl = positions.reduce((sum, p) => sum + p.unrealized_pl, 0)
  const positionsValue = positions.reduce((sum, p) => sum + p.market_value, 0)
  const positionsUnrealizedPct = positionsValue
    ? (unrealizedPl / positionsValue) * 100
    : 0

  const signalResearch = (status?.signalResearch ?? {}) as Record<
    string,
    SignalResearch
  >

  const keys = getAppKeys()
  const envLabel = keys?.env === 'real' ? 'REAL' : 'DEMO'

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-hud-bg">
      <div className="max-w-[1920px] mx-auto p-4">
        {/* Environment banner */}
        <div
          className={clsx(
            'mb-3 px-4 py-2 text-[10px] uppercase tracking-wider text-center border',
            keys?.env === 'real'
              ? 'bg-hud-warning/10 border-hud-warning/30 text-hud-warning'
              : 'bg-hud-cyan/10 border-hud-cyan/30 text-hud-cyan'
          )}
        >
          {envLabel} ENVIRONMENT — Trading with your eToro keys
          (browser-only, never stored server-side)
        </div>

        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-hud-line">
          <div className="flex items-center gap-4">
            <h1 className="text-hud-text-bright text-base font-light tracking-wider">
              MAKORA
            </h1>
            <StatusIndicator
              status={isMarketOpen ? 'active' : 'inactive'}
              label={isMarketOpen ? 'MKT OPEN' : 'MKT CLOSED'}
              pulse={isMarketOpen}
            />
            {tickInFlight && (
              <span className="hud-label text-hud-cyan animate-pulse">
                TICK...
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 md:gap-6 flex-wrap">
            <span className="hud-value-sm font-mono">
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </span>
            <button
              onClick={onDisconnect}
              className="hud-button text-hud-error border-hud-error hover:bg-hud-error"
            >
              DISCONNECT
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 px-4 py-2 text-[10px] bg-hud-error/10 border border-hud-error/30 text-hud-error">
            {error}
          </div>
        )}

        {/* Account summary row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Panel title="EQUITY">
            <Metric
              label=""
              value={account ? formatCurrency(account.equity) : '---'}
              size="lg"
            />
          </Panel>
          <Panel title="CASH">
            <Metric
              label=""
              value={account ? formatCurrency(account.cash) : '---'}
              size="md"
            />
          </Panel>
          <Panel title="POSITIONS VALUE">
            <Metric
              label=""
              value={positionsValue ? formatCurrency(positionsValue) : '---'}
              size="md"
            />
          </Panel>
          <Panel title="UNREALIZED P&L">
            <Metric
              label=""
              value={
                unrealizedPl
                  ? `${formatCurrency(unrealizedPl)} (${formatPercent(positionsUnrealizedPct)})`
                  : '---'
              }
              size="md"
              color={
                unrealizedPl > 0
                  ? 'success'
                  : unrealizedPl < 0
                    ? 'error'
                    : 'default'
              }
            />
          </Panel>
          <Panel title="BUYING POWER">
            <Metric
              label=""
              value={
                account ? formatCurrency(account.buying_power) : '---'
              }
              size="md"
            />
          </Panel>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Positions */}
          <Panel
            title="POSITIONS"
            titleRight={`${positions.length}${config?.max_positions ? ` / ${config.max_positions}` : ''}`}
            className="lg:col-span-2"
          >
            {positions.length === 0 ? (
              <div className="text-hud-text-dim text-[10px] text-center py-6">
                NO OPEN POSITIONS
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-hud-text-dim border-b border-hud-line">
                      <th className="text-left py-1.5 pr-2">SYMBOL</th>
                      <th className="text-right pr-2">QTY</th>
                      <th className="text-right pr-2">ENTRY</th>
                      <th className="text-right pr-2">CURRENT</th>
                      <th className="text-right pr-2">P&L</th>
                      <th className="text-right pr-2">VALUE</th>
                      <th className="text-right w-16">TREND</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => {
                      const plPct =
                        pos.avg_entry_price && pos.avg_entry_price > 0
                          ? ((pos.current_price - pos.avg_entry_price) /
                              pos.avg_entry_price) *
                            100
                          : 0
                      const mockHistory = generateMockPriceHistory(
                        pos.current_price,
                        pos.unrealized_pl
                      )
                      return (
                        <tr
                          key={getPositionKey(pos)}
                          className="border-b border-hud-line/50 hover:bg-hud-line/10"
                        >
                          <td className="py-1.5 pr-2 text-hud-text-bright font-medium">
                            <Tooltip
                              position="right"
                              content={
                                <TooltipContent
                                  title={pos.symbol}
                                  items={[
                                    { label: 'Entry Price', value: pos.avg_entry_price ? formatCurrency(pos.avg_entry_price) : 'N/A' },
                                    { label: 'Current Price', value: formatCurrency(pos.current_price) },
                                    { label: 'Quantity', value: pos.qty },
                                    { label: 'Market Value', value: formatCurrency(pos.market_value) },
                                    { label: 'P&L', value: `${formatCurrency(pos.unrealized_pl)} (${formatPercent(plPct)})`, color: pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error' },
                                    { label: 'Side', value: pos.side === 'short' ? 'Short' : 'Long' },
                                  ]}
                                />
                              }
                            >
                              <span className="cursor-help border-b border-dotted border-hud-text-dim">
                                {pos.symbol}
                              </span>
                            </Tooltip>
                            <span className="ml-1 text-hud-text-dim">
                              {pos.side === 'short' ? 'S' : 'L'}
                            </span>
                          </td>
                          <td className="text-right pr-2">{pos.qty}</td>
                          <td className="text-right pr-2">
                            {pos.avg_entry_price
                              ? `$${pos.avg_entry_price.toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="text-right pr-2">
                            ${pos.current_price.toFixed(2)}
                          </td>
                          <td
                            className={clsx(
                              'text-right pr-2',
                              pos.unrealized_pl >= 0
                                ? 'text-hud-success'
                                : 'text-hud-error'
                            )}
                          >
                            {formatCurrency(pos.unrealized_pl)}
                            <span className="ml-1 text-[9px]">
                              {formatPercent(plPct)}
                            </span>
                          </td>
                          <td className="text-right pr-2">
                            {formatCurrency(pos.market_value)}
                          </td>
                          <td className="text-right w-16">
                            <Sparkline
                              data={mockHistory}
                              width={56}
                              height={16}
                              variant={
                                pos.unrealized_pl >= 0 ? 'green' : 'red'
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Signals */}
          <Panel
            title="SHARED SIGNALS"
            titleRight={`${signals.length}`}
          >
            <div className="overflow-y-auto max-h-[300px] space-y-1.5">
              {signals.length === 0 ? (
                <div className="text-hud-text-dim text-[10px] text-center py-6">
                  NO SIGNALS YET
                </div>
              ) : (
                signals.slice(0, 30).map((sig, i) => (
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
                    <div
                      className={clsx(
                        'flex items-center justify-between py-1 px-2 border-b border-hud-line/10 hover:bg-hud-line/10 cursor-help text-[10px]',
                        sig.isCrypto && 'bg-hud-warning/5'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {sig.isCrypto && <span className="text-hud-warning text-xs">&#8383;</span>}
                        <span className="text-hud-text-bright font-medium w-12">
                          {sig.symbol}
                        </span>
                        <span className={clsx('text-hud-text-dim text-[9px] uppercase', sig.isCrypto ? 'text-hud-warning' : '')}>
                          {sig.source}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {sig.isCrypto && sig.momentum !== undefined ? (
                          <span className={clsx('text-[9px]', sig.momentum >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                            {sig.momentum >= 0 ? '+' : ''}{sig.momentum.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-hud-text-dim text-[9px]">VOL {sig.volume}</span>
                        )}
                        <span className={clsx('text-[9px]', getSentimentColor(sig.sentiment))}>
                          {(sig.sentiment * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </Tooltip>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Bottom row: Research + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
          {/* Signal Research */}
          <Panel
            title="SIGNAL RESEARCH"
            titleRight={Object.keys(signalResearch).length.toString()}
            className="h-80"
          >
            <div className="overflow-y-auto h-full space-y-2">
              {Object.keys(signalResearch).length === 0 ? (
                <div className="text-hud-text-dim text-[10px] text-center py-6">
                  Researching candidates...
                </div>
              ) : (
                Object.entries(signalResearch)
                  .sort(([, a], [, b]) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
                  .slice(0, 20)
                  .map(([symbol, research]) => (
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
                              <span className={getSentimentColor(research.sentiment ?? 0)}>
                                {((research.sentiment ?? 0) * 100).toFixed(0)}%
                              </span>
                            </div>
                            {research.timestamp && (
                              <div className="flex justify-between">
                                <span className="text-hud-text-dim">Analyzed</span>
                                <span className="text-hud-text">
                                  {new Date(research.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                                </span>
                              </div>
                            )}
                          </div>
                          {research.catalysts && research.catalysts.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-[9px] text-hud-text-dim">CATALYSTS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.catalysts.map((c, i) => (
                                  <li key={i} className="text-[10px] text-hud-success">+ {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {research.red_flags && research.red_flags.length > 0 && (
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
                      <div className="p-2 border border-hud-line/30 hover:border-hud-line/60 cursor-help transition-colors">
                        <div className="flex justify-between items-center mb-1">
                          <span className="hud-value-sm">{symbol}</span>
                          <div className="flex items-center gap-2">
                            {research.entry_quality && (
                              <span className={clsx('hud-label', getQualityColor(research.entry_quality))}>
                                {research.entry_quality.toUpperCase()}
                              </span>
                            )}
                            <span className={clsx('hud-value-sm font-bold', getVerdictColor(research.verdict))}>
                              {research.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-hud-text-dim leading-tight mb-1">
                          {research.reasoning}
                        </p>
                        {research.red_flags && research.red_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {research.red_flags.slice(0, 2).map((flag, i) => (
                              <span key={i} className="text-[9px] text-hud-error bg-hud-error/10 px-1">
                                {flag.length > 30 ? `${flag.slice(0, 30)}...` : flag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Tooltip>
                  ))
              )}
            </div>
          </Panel>

          {/* Activity Feed */}
          <Panel
            title="ACTIVITY FEED"
            titleRight="LIVE"
            className="h-80"
          >
            <div className="overflow-y-auto h-full font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <div className="text-hud-text-dim text-[10px] text-center py-6">
                  Waiting for activity...
                </div>
              ) : (
                logs.slice(-50).reverse().map((log, i) => (
                  <div
                    key={`${log.timestamp}-${log.action}-${i}`}
                    className="flex items-start gap-2 py-1 border-b border-hud-line/10"
                  >
                    <span className="text-hud-text-dim shrink-0 w-[52px]">
                      {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <span className={clsx('shrink-0 w-[72px] text-right', getAgentColor(log.agent))}>
                      {log.agent}
                    </span>
                    <span className="text-hud-text flex-1 text-right break-words">
                      {log.action}
                      {log.symbol && <span className="text-hud-primary ml-1">({log.symbol})</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Footer */}
        <footer className="mt-4 pt-3 border-t border-hud-line flex flex-wrap items-center justify-between gap-3 text-[9px]">
          <div className="flex items-center gap-4">
            <MetricInline
              label="STATUS"
              value={tickInFlight ? 'RUNNING' : 'IDLE'}
              valueClassName={
                tickInFlight ? 'text-hud-cyan' : 'text-hud-text-dim'
              }
            />
            <span className="text-hud-line">|</span>
            <MetricInline
              label="POSITIONS"
              value={`${positions.length}/${config?.max_positions ?? '?'}`}
            />
            <span className="text-hud-line">|</span>
            <MetricInline
              label="SIGNALS"
              value={signals.length}
            />
            <span className="text-hud-line">|</span>
            <MetricInline
              label="ENV"
              value={envLabel}
              valueClassName={
                keys?.env === 'real'
                  ? 'text-hud-warning'
                  : 'text-hud-cyan'
              }
            />
          </div>
          <span className="flex items-center gap-1.5 opacity-40 hover:opacity-60 transition-opacity">
            <span className="hud-label text-[9px]">POWERED BY</span>
            <svg
              width="42"
              height="13"
              viewBox="0 0 103 33"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M15.84 24.42C13.56 24.42 11.7 23.58 10.26 21.9C8.82 20.22 8.1 18.06 8.1 15.42C8.1 12.72 8.82 10.56 10.26 8.94C11.7 7.26 13.56 6.42 15.84 6.42C17.58 6.42 19.02 6.96 20.16 8.04V0.6H23.46V24H20.16V22.8C19.02 23.88 17.58 24.42 15.84 24.42ZM16.5 21.42C17.94 21.42 19.14 20.88 20.1 19.8C21.06 18.72 21.54 17.28 21.54 15.48C21.54 13.62 21.06 12.15 20.1 11.07C19.14 9.99 17.94 9.45 16.5 9.45C15.06 9.45 13.86 9.99 12.9 11.07C11.94 12.15 11.46 13.62 11.46 15.48C11.46 17.28 11.94 18.72 12.9 19.8C13.86 20.88 15.06 21.42 16.5 21.42Z"
                fill="currentColor"
              />
              <path
                d="M36.1 24.42C33.58 24.42 31.54 23.58 30 21.9C28.46 20.22 27.7 18.06 27.7 15.42C27.7 12.72 28.46 10.56 30 8.94C31.54 7.26 33.58 6.42 36.1 6.42C38 6.42 39.6 6.96 40.9 8.04C42.2 9.12 43.04 10.56 43.38 12.36H39.96C39.72 11.4 39.2 10.62 38.4 10.02C37.6 9.42 36.66 9.12 35.58 9.12C34.02 9.12 32.76 9.66 31.8 10.74C30.84 11.82 30.36 13.38 30.36 15.42C30.36 17.4 30.84 18.93 31.8 20.01C32.76 21.09 34.02 21.63 35.58 21.63C36.66 21.63 37.6 21.33 38.4 20.73C39.2 20.13 39.72 19.35 39.96 18.39H43.38C43.04 20.19 42.2 21.63 40.9 22.71C39.6 23.85 38 24.42 36.1 24.42Z"
                fill="currentColor"
              />
              <path
                d="M50.02 24V6.84H57.52C59.5 6.84 61.06 7.38 62.2 8.46C63.34 9.54 63.9 10.98 63.9 12.78C63.9 14.58 63.34 16.02 62.2 17.1C61.06 18.18 59.5 18.72 57.52 18.72H53.32V24H50.02ZM53.32 15.9H57.16C58.36 15.9 59.26 15.6 59.86 15C60.46 14.4 60.76 13.68 60.76 12.84C60.76 11.94 60.46 11.22 59.86 10.68C59.26 10.08 58.36 9.78 57.16 9.78H53.32V15.9Z"
                fill="currentColor"
              />
              <path
                d="M79.34 24V6.84H82.64V21H92.24V24H79.34Z"
                fill="currentColor"
              />
              <path
                d="M68.02 6.84H71.32V24H68.02V6.84Z"
                fill="currentColor"
              />
              <path
                d="M96.02 24V6.84H99.32V24H96.02Z"
                fill="currentColor"
              />
              <circle cx="3.5" cy="15.5" r="3.5" fill="#4CAF50" />
            </svg>
          </span>
        </footer>
      </div>
    </div>
  )
}

// ── Main SharedAppPage ──────────────────────────────────────────────

export default function SharedAppPage() {
  const [connected, setConnected] = useState(() => !!getAppKeys())

  const handleDisconnect = () => {
    clearAppKeys()
    setConnected(false)
  }

  if (!connected) {
    return <KeyEntryForm onConnect={() => setConnected(true)} />
  }

  return <SharedDashboard onDisconnect={handleDisconnect} />
}
