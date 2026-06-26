# Troubleshooting

**First step, always:** run the readiness check — it diagnoses most of this for you and prints the fix.

```sh
just doctor          # or:  node scripts/doctor.js
```

Green = you're ready to build. Otherwise find your symptom below.

---

## Setup & toolchain

### `node: command not found` / `'node' is not recognized` (Windows, via `just`)

`just` was running its recipes in a shell without Node on PATH. **Fixed** — the justfile now uses
`cmd.exe` (`set windows-shell := ["cmd.exe", "/c"]`), which has the full system PATH. If you still hit
it: close and reopen your terminal after installing Node, or run the manual steps from the README.

### `npm install --prefix scripts` fails / exit code 1 (Windows PowerShell)

PowerShell 5.1 doesn't handle some npm flag/`&&` combos. Don't fight it — use the justfile (cmd-based)
or run it plainly: `cd scripts && npm install` in a regular Command Prompt.

### `just` isn't installed

It's optional. Install it (`winget install Casey.Just`), or just run the plain
`node` / `npm` / `docker` commands — every recipe in the `justfile` is a one-liner you can copy.

### `Cannot find module '@solana/web3.js'` when running setup/doctor

The `scripts/` deps aren't installed. Run `cd scripts && npm install`, then retry. (`just setup` /
`just doctor` do this for you.)

---

## Funding (the #1 hour-1 blocker)

### "Where are my wallet addresses?"

After `just dev` (or `node scripts/setup.js`) they're printed in the terminal **and saved to
`WALLETS.txt`** in the repo root. Open that file. Re-run `node scripts/setup.js` anytime to reprint.

### The faucet won't give me SOL / "rate limited"

[faucet.solana.com](https://faucet.solana.com) is the **only** way (CLI/RPC `airdrop` is gated). It
requires **GitHub sign-in** and rate-limits per account. If you're throttled:

- Make sure you're **signed in with GitHub** (anonymous requests are limited hardest).
- Request a **small** amount (1 SOL is plenty — each payment is 0.0001).
- Wait a few minutes and retry, or try another faucet (e.g. the QuickNode / Solana faucet mirrors).
- You only need to fund **once** — devnet SOL persists.

### Agents start but never pay / "insufficient funds"

The buyer wallet is empty. Run `just doctor` — it checks both balances — then fund the one it flags
(address in `WALLETS.txt`). The **Checkout** tab uses your **Phantom** wallet instead — set Phantom to
**Devnet** and fund it separately.

---

## Docker & the stack

### `Cannot connect to the Docker daemon` / coral exits immediately

Docker Desktop isn't running. Start it, wait for the whale icon to settle, then `docker compose up -d coral bridge`.

### coral is up but no agents appear when I click "Run"

coral launches the agents as containers — they must be **built first**:

```sh
bash build-agents.sh        # or: just build
```

Then check they exist: `docker images | grep agent`. coral needs the Docker socket mounted (it is, in
`docker-compose.yml`) to spawn them.

### Port already in use — `:5555` or `:3010`

Something else holds the port (an old run, another app).

```sh
docker compose down                       # stop a previous stack
# find a stray process on the port:
#   Windows:  netstat -ano | findstr :3010
#   macOS/Linux:  lsof -i :3010
```

Or change the host port in `docker-compose.yml` (e.g. `"3011:3010"`).

### The UI loads but the feed never updates / first run is slow

On the **first** session, coral pulls/launches the agent containers — give it **~20 seconds**. Watch
progress with `docker compose logs -f coral`. If it's still empty after a minute, the agent images
probably aren't built (see above) or the wallets aren't funded.

---

## Agents & keys

### The autonomous buyer doesn't decide to pay

The LLM buyer needs `ANTHROPIC_API_KEY` in `.env` (free tier at console.anthropic.com). Without it the
buyer can't *reason* — the on-chain payment mechanics work, but nothing triggers them. (The **Checkout**
door needs no LLM key — a human is the buyer.)

### "DELIVERED" never comes back

Trace the conversation: `docker compose logs -f coral`. Common causes, in order: wallets unfunded →
agent images not built → `ANTHROPIC_API_KEY` missing → the seller's upstream API (Jupiter/etc.) is down.

---

## Escrow (optional Rust add-on)

### `anchor build` fails

Needs the Solana + Anchor toolchain (`solana --version`, `anchor --version`). The scaffold targets
**Anchor 0.32.x**. After the first build, run `anchor keys sync` to align the program id in
`Anchor.toml` and `lib.rs`. This add-on is **opt-in** — the core track is TypeScript-only and never
needs it.

### `anchor build` finishes but there's no `target/deploy/escrow.so` (Windows)

On some Windows setups `anchor build` runs the IDL step but skips the SBF link, so no deployable `.so`
appears. Build it directly:

```sh
cd programs/escrow && cargo build-sbf      # → programs/escrow/target/deploy/escrow.so
```

The `cfg`/`anchor-debug` warnings it prints are harmless.

---

## Still stuck?

Run `just doctor` and paste its output into an issue — it captures Node, Docker, wallet, and stack
state in one go, which is everything needed to diagnose a setup problem.
