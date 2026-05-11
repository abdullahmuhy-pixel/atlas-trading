# ATLAS — Institutional Market Intelligence Terminal

A professional-grade market analysis tool for active traders using XM Trader. Built as a standalone web app — no server required, no installation needed.

## Features

- **10-pane analysis engine** — Overview, Technical, Fundamental, Sentiment, News, Trade Tactics, Multi-Timeframe, Intermarket, SMC/Wyckoff, Session Analysis
- **TradingView live charts** — Professional candlestick charts with RSI, MACD, Bollinger Bands, EMA, ATR built in
- **Live news feed** — Finnhub API integration with AI fallback
- **Weekly Strategy Optimizer** — Tests strategy families against last 30 days, picks the best for this week
- **Daily Trade Plan Generator** — Complete morning briefing with exact entry/stop/target levels
- **Performance Tracker** — Full trade log, win rate, profit factor, drawdown tracking, AI coaching
- **Drawdown Guard** — Auto risk-cut rules (Arvid method)
- **MT4/MT5 EA Generator** — Generates compilable MQL4/MQL5 code for XM MetaTrader
- **Price Alerts** — Browser push notifications + audio when price hits your target
- **Correlation Matrix** — 30-day Pearson correlation across 8 key instruments
- **Pip Value Calculator** — Exact risk sizing for all XM instruments
- **Personal Rules Editor** — Your trading rules injected into every analysis automatically
- **Black-Scholes Greeks** — Full options calculator
- **Risk-of-Ruin Calculator** — Kelly criterion, expectancy, system edge assessment

## Deployment

This is a single HTML file. No backend, no database, no server costs.

Hosted on GitHub Pages at: `https://abdullahmuhy-pixel.github.io/atlas-trading/`

## API Keys Required

| Service | Purpose | Cost | Link |
|---|---|---|---|
| Anthropic Claude | All AI analysis | Pay per use (~$0.01/analysis) | console.anthropic.com |
| Finnhub | Live news feed | Free | finnhub.io |
| Twelve Data | Streaming prices (optional) | Free tier | twelvedata.com |

Add keys in the **API KEYS** section of the sidebar. Stored in browser localStorage only.

## Privacy

- All data (trades, journal, alerts, rules) stored in your browser's localStorage only
- Never sent to any server except the APIs you configure
- Keep the GitHub repo **Private** to prevent others accessing your deployment URL

## Disclaimer

ATLAS provides analytical intelligence only. Not financial advice. Trading involves substantial risk of loss.
