# DCF Studio

A multi-agent valuation platform to orchestrate **Claude Code**, **Codex**, **Grok Build**, and **Antigravity** on DCF (Discounted Cash Flow) modeling tasks. Models are validated into a unified schema, compared side-by-side, tuned with live what-if scenarios, and exported to formulaic Excel workbooks.

## Features

- **Multi-Agent Orchestration**: Run autonomous coding CLIs (Claude, Codex, Grok, Antigravity) with structured prompts and strict tool sandboxing.
- **Unified DCF Schema & Validation (`dcfkit`)**: Standardizes model output (`dcf.json`, `model.py`, and `report.md`) with shared valuation mechanics (WACC, terminal value, enterprise-to-equity bridge).
- **Interactive Web UI**: Compare multi-agent estimates side-by-side, inspect financial statements, run Layer A (macro/engine) and Layer B (model driver) what-if sensitivities, and refresh live market quotes.
- **Excel Export**: Exports standardized workbooks with live Excel formulas matching the valuation engine.
- **Stock Screener**: Screen US equities using free SEC XBRL frames, reverse DCF implied growth calculations, and earnings calendar integration.

## Quick Start

### Prerequisites
- Python >= 3.12 with [`uv`](https://github.com/astral-sh/uv)
- Node.js >= 20
- Supported AI agent CLIs installed and logged in (`claude`, `codex`, `grok`, and/or `agy`)

### Running the App

```bash
# Production mode (builds frontend if needed and serves at http://127.0.0.1:8765)
./run.sh

# Development mode (FastAPI with reload + Vite dev server on http://127.0.0.1:5173)
./run.sh dev
```

> **Security Note:** The server binds strictly to `127.0.0.1` because autonomous agent runs execute code locally with approval prompts bypassed. Do not expose this server to external networks.

### Running Tests

```bash
uv run python -m pytest
```

## Project Structure

```
dcfkit/         # Valuation engine, schema definitions, and validation logic
server/         # FastAPI backend, run queue, CLI adapters, and screener
web/            # React + Vite frontend application
prompts/        # Financial modeling prompt templates and methodology
launcher/       # Desktop and terminal background service launcher
data/           # Model runs, historical data, and screener cache (gitignored)
```

## Configuration

Customize concurrency, timeouts, default models, and screener thresholds in `config.toml`:

```toml
[server]
host = "127.0.0.1"
port = 8765

[backends.claude]
model = "opus"
effort = "high"

[backends.agy]
model = "latest"
effort = "high"
```

Configure your contact email in `runs.sec_user_agent` to ensure compliant access to SEC EDGAR endpoints.
