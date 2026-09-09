/**
 * Basic dev/QA page for Xander's real Claim Gate API + World ID Selfie Check
 * flow. Every call here is real: the backend's real endpoints, and — from
 * "Open Selfie Check" onward — the real `@worldcoin/idkit-core` client SDK
 * building a real signed request and polling a real World bridge.
 *
 * No mocks. If Selfie Check preview access hasn't been granted yet (Phase 13),
 * the World App side of the flow will surface a real error from World's own
 * bridge — that is a genuine, informative result, not a bug in this page.
 */
import { IDKit, selfieCheckLegacy, type IDKitInviteCodeRequest } from '@worldcoin/idkit-core'
import QRCode from 'qrcode'
import { api, ApiError, type FinalizeResponse, type RequestLogger, type ScreenClaimResponse, type VerifyResponse } from './api'

// ---------------------------------------------------------------------------
// Persisted config
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'xander-worldid-tester-config'

interface StoredConfig {
  baseUrl: string
  apiKey: string
  wallet: string
  campaignId: string
  environment: 'staging' | 'production' | 'sandbox'
}

const DEFAULTS: StoredConfig = {
  baseUrl: '/api',
  apiKey: '',
  // A real, seeded wallet whose cluster reliably scores into the CHALLENGE
  // band (see backend/src/claim/fixtures.ts) — picking it here means a fresh
  // checkout gets a real CHALLENGE on the first click, not a dead end.
  wallet: '0x000000000000000000000000000000000000cae1',
  campaignId: 'world-id-tester',
  // A REAL phone's REAL World App generates production-environment proofs by
  // default — confirmed by testing: World's own verify endpoint rejected a
  // genuine, otherwise-valid proof with "environment_mismatch: This proof was
  // generated for the production environment, but this request uses staging."
  // "staging" is Section 13.3's confirmed path for World's SIMULATOR tool
  // (simulator.worldcoin.org), not for a real device's real World App.
  environment: 'production',
}

function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const stored = JSON.parse(raw) as Partial<StoredConfig>
    // `environment` is deliberately NOT restored from storage. It bit us
    // exactly this way: correcting DEFAULTS.environment from 'staging' to
    // 'production' did nothing for anyone who had already saved 'staging'
    // before the fix landed, because a stored value always overrides a
    // default on the next merge — the fix silently never took effect. Given
    // how consequential a wrong value is here (a real, otherwise-valid proof
    // gets rejected) versus how cheap it is to glance at one dropdown, this
    // field always starts from the current code default, every load.
    return { ...DEFAULTS, ...stored, environment: DEFAULTS.environment }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveConfig(config: StoredConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Private browsing / storage disabled — the form still works this session.
  }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

interface LogEntry {
  time: string
  method: string
  path: string
  status: number | null
  ok: boolean
  durationMs: number
  requestBody: unknown
  responseBody: unknown
}

const logEntries: LogEntry[] = []

function appendLog(entry: Omit<LogEntry, 'time'>): void {
  logEntries.unshift({ ...entry, time: new Date().toLocaleTimeString() })
  renderLog()
}

function makeLogger(): RequestLogger {
  return (e) => appendLog(e)
}

function renderLog(): void {
  const el = document.getElementById('log')
  if (!el) return
  el.innerHTML =
    logEntries
      .map((e) => {
        const statusClass = e.ok ? 'status-ok' : 'status-bad'
        const statusText = e.status === null ? 'ERR' : String(e.status)
        return `
        <div class="log-entry">
          <div class="meta">
            <span class="method">${escapeHtml(e.method)}</span> ${escapeHtml(e.path)}
            — <span class="${statusClass}">${statusText}</span>
            — ${e.durationMs}ms — ${e.time}
          </div>
          <pre>${escapeHtml(formatJson({ request: e.requestBody, response: e.responseBody }))}</pre>
        </div>`
      })
      .join('') || '<p style="opacity:.6">No requests yet.</p>'
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

const app = document.getElementById('app')
if (!app) throw new Error('#app root element missing')

app.innerHTML = `
  <h1>Xander — World ID Selfie Check tester</h1>
  <p class="subtitle">
    Exercises the real <code>/screen-claim → /world/rp-signature → IDKit →
    /world/verify → /claim/finalize</code> chain end to end. Nothing here is
    mocked — every button makes a real network call.
  </p>

  <div class="notice">
    Selfie Check is a World preview feature gated by manual access approval
    (see <code>backend/Backend-Sylesh.md</code> Phase 13). If access hasn't
    been granted for this app yet, Steps 3–5 will still run for real, but
    World's own bridge may report the credential as unavailable — that is a
    genuine result from World, not a bug in this page.
  </div>

  <div class="card">
    <h2>Config</h2>
    <div class="row"><label for="cfg-baseUrl">Backend base URL</label>
      <input id="cfg-baseUrl" placeholder="/api or http://localhost:3000" /></div>
    <div class="row"><label for="cfg-apiKey">X-API-Key</label>
      <input id="cfg-apiKey" type="password" placeholder="BACKEND_API_KEY value" /></div>
    <div class="row"><label for="cfg-wallet">Wallet</label>
      <input id="cfg-wallet" /></div>
    <div class="row"><label for="cfg-campaignId">Campaign ID</label>
      <input id="cfg-campaignId" /></div>
    <div class="row"><label for="cfg-environment">World environment</label>
      <select id="cfg-environment">
        <option value="production">production</option>
        <option value="staging">staging</option>
        <option value="sandbox">sandbox</option>
      </select>
    </div>
    <p style="font-size:.8rem;opacity:.7;margin:-4px 0 8px">
      Use <strong>production</strong> for a real phone's real World App — confirmed
      by testing (World rejects a real proof with <code>environment_mismatch</code>
      otherwise). "staging" is for World's own simulator tool, not a real device.
    </p>
    <div class="row">
      <button id="btn-health" class="secondary">Check backend health</button>
      <span id="health-status" class="status-line"></span>
    </div>
  </div>

  <div class="card">
    <h2>Step 1 — Screen the claim <span id="decision-badge"></span></h2>
    <button id="btn-screen">POST /screen-claim</button>
    <pre id="screen-result" style="display:none"></pre>
  </div>

  <div class="card disabled" id="card-rpsig">
    <h2>Step 2 — Get RP signature</h2>
    <p style="font-size:.85rem;opacity:.75;margin-top:0">
      Must happen before IDKit opens — the signing key never leaves the backend.
    </p>
    <button id="btn-rpsig">POST /world/rp-signature</button>
    <pre id="rpsig-result" style="display:none"></pre>
    <hr style="border-color:var(--border);margin:14px 0" />
    <p style="font-size:.85rem;opacity:.75;margin:0 0 6px">
      <strong>If Step 4 later returns 409 "no open verification challenge"</strong> —
      this claim's challenge already resolved or expired (e.g. from a previous
      run against the same wallet + campaign ID). Re-issue a fresh one, then
      redo Steps 2–3 with the button above and below.
    </p>
    <button id="btn-reissue" class="secondary">POST /world/challenge (re-issue)</button>
    <pre id="reissue-result" style="display:none"></pre>
  </div>

  <div class="card disabled" id="card-idkit">
    <h2>Step 3 — Open Selfie Check <span id="idkit-status-badge"></span></h2>
    <button id="btn-idkit">Build request &amp; start polling</button>
    <button id="btn-idkit-cancel" class="secondary" style="display:none">Cancel</button>
    <div id="idkit-qr" class="qr-box" style="display:none"></div>
    <p id="idkit-status" class="status-line"></p>
    <pre id="idkit-result" style="display:none"></pre>
  </div>

  <div class="card disabled" id="card-verify">
    <h2>Step 4 — Verify with World <span id="verify-badge"></span></h2>
    <button id="btn-verify">POST /world/verify</button>
    <pre id="verify-result" style="display:none"></pre>
  </div>

  <div class="card disabled" id="card-finalize">
    <h2>Step 5 — Finalize claim <span id="finalize-badge"></span></h2>
    <button id="btn-finalize">POST /claim/finalize</button>
    <pre id="finalize-result" style="display:none"></pre>
  </div>

  <div class="card disabled" id="card-receipt">
    <h2>Step 6 — Evidence receipt</h2>
    <button id="btn-receipt">GET /receipts/:id</button>
    <pre id="receipt-result" style="display:none"></pre>
  </div>

  <div class="card">
    <h2>Activity log</h2>
    <div id="log"></div>
  </div>
`

// ---------------------------------------------------------------------------
// Wire config inputs
// ---------------------------------------------------------------------------

const config = loadConfig()

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing #${id}`)
  return found as T
}

const inputs = {
  baseUrl: el<HTMLInputElement>('cfg-baseUrl'),
  apiKey: el<HTMLInputElement>('cfg-apiKey'),
  wallet: el<HTMLInputElement>('cfg-wallet'),
  campaignId: el<HTMLInputElement>('cfg-campaignId'),
  environment: el<HTMLSelectElement>('cfg-environment'),
}

inputs.baseUrl.value = config.baseUrl
inputs.apiKey.value = config.apiKey
inputs.wallet.value = config.wallet
inputs.campaignId.value = config.campaignId
inputs.environment.value = config.environment

function currentConfig(): StoredConfig {
  const stored: StoredConfig = {
    baseUrl: inputs.baseUrl.value.trim() || DEFAULTS.baseUrl,
    apiKey: inputs.apiKey.value,
    wallet: inputs.wallet.value.trim(),
    campaignId: inputs.campaignId.value.trim(),
    environment: inputs.environment.value as StoredConfig['environment'],
  }
  saveConfig(stored)
  return stored
}

for (const input of Object.values(inputs)) {
  input.addEventListener('change', () => currentConfig())
}

el<HTMLButtonElement>('btn-health').addEventListener('click', async () => {
  const status = el<HTMLElement>('health-status')
  status.textContent = 'checking…'
  try {
    const result = await api.health(currentConfig(), makeLogger())
    status.textContent = result.ok ? '✅ reachable' : '⚠️ responded, ok:false'
  } catch (err) {
    status.textContent = `❌ ${describeError(err)}`
  }
})

// ---------------------------------------------------------------------------
// Flow state
// ---------------------------------------------------------------------------

let screenResult: ScreenClaimResponse | null = null
let rpSignature: { sig: string; nonce: string; created_at: number; expires_at: number } | null = null
let idkitProof: unknown = null
let activeRequest: IDKitInviteCodeRequest | null = null
let pollAbort: AbortController | null = null
let verifyResult: VerifyResponse | null = null
let finalizeResult: FinalizeResponse | null = null

function setCardEnabled(cardId: string, enabled: boolean): void {
  el(cardId).classList.toggle('disabled', !enabled)
}

function setBadge(id: string, text: string): void {
  const badge = el<HTMLElement>(id)
  badge.textContent = text
  badge.className = `badge ${text}`
}

function showPre(id: string, value: unknown): void {
  const pre = el<HTMLPreElement>(id)
  pre.style.display = 'block'
  pre.textContent = formatJson(value)
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`
  if (err instanceof Error) return err.message
  return String(err)
}

/** Renders an error including the raw response body — the actual diagnostic
 * surface, not just the one-line message extracted from it. */
function showError(id: string, err: unknown): void {
  showPre(id, {
    error: describeError(err),
    ...(err instanceof ApiError ? { responseBody: err.body } : {}),
  })
}

// --- Step 1: screen-claim ---------------------------------------------------

el<HTMLButtonElement>('btn-screen').addEventListener('click', async () => {
  const cfg = currentConfig()
  const btn = el<HTMLButtonElement>('btn-screen')
  btn.disabled = true
  try {
    screenResult = await api.screenClaim(
      cfg,
      { wallet: cfg.wallet, campaignId: cfg.campaignId },
      makeLogger(),
    )
    showPre('screen-result', screenResult)
    setBadge('decision-badge', screenResult.decision)

    const isChallenge = screenResult.decision === 'CHALLENGE' && screenResult.idkit !== null
    setCardEnabled('card-rpsig', isChallenge)
    setCardEnabled('card-idkit', false)
    setCardEnabled('card-verify', false)
    setCardEnabled('card-finalize', false)
    setCardEnabled(
      'card-receipt',
      screenResult.evidenceReceiptId !== null && !isChallenge,
    )
    if (screenResult.evidenceReceiptId && !isChallenge) {
      el<HTMLButtonElement>('btn-receipt').dataset.receiptId = screenResult.evidenceReceiptId
    }
  } catch (err) {
    showError('screen-result', err)
  } finally {
    btn.disabled = false
  }
})

// --- Step 2: rp-signature ----------------------------------------------------

el<HTMLButtonElement>('btn-rpsig').addEventListener('click', async () => {
  if (!screenResult?.idkit) return
  const cfg = currentConfig()
  const btn = el<HTMLButtonElement>('btn-rpsig')
  btn.disabled = true
  try {
    const res = await api.rpSignature(cfg, { action: screenResult.idkit.action }, makeLogger())
    rpSignature = {
      sig: res.sig,
      nonce: res.nonce,
      created_at: res.created_at,
      expires_at: res.expires_at,
    }
    showPre('rpsig-result', res)
    setCardEnabled('card-idkit', true)
  } catch (err) {
    showError('rpsig-result', err)
  } finally {
    btn.disabled = false
  }
})

// --- Recovery: re-issue a challenge that already resolved or expired --------

el<HTMLButtonElement>('btn-reissue').addEventListener('click', async () => {
  if (!screenResult) return
  const cfg = currentConfig()
  const btn = el<HTMLButtonElement>('btn-reissue')
  btn.disabled = true
  try {
    const res = await api.reissueChallenge(cfg, { claimId: screenResult.claimId }, makeLogger())
    showPre('reissue-result', res)

    // The new challenge needs a fresh RP signature and a fresh IDKit request —
    // the old ones were bound to the challenge that just got replaced. `idkit`
    // itself is unchanged (same claimId -> same signal binding), but rpSig and
    // any in-flight proof are now stale.
    if (res.idkit) screenResult.idkit = res.idkit
    rpSignature = null
    idkitProof = null

    el<HTMLPreElement>('rpsig-result').style.display = 'none'
    el<HTMLPreElement>('idkit-result').style.display = 'none'
    el<HTMLElement>('idkit-status').textContent = ''
    el<HTMLElement>('idkit-status-badge').textContent = ''
    el<HTMLElement>('idkit-status-badge').className = 'badge'
    el<HTMLElement>('idkit-qr').style.display = 'none'

    setCardEnabled('card-idkit', false)
    setCardEnabled('card-verify', false)
    setCardEnabled('card-finalize', false)
  } catch (err) {
    showError('reissue-result', err)
  } finally {
    btn.disabled = false
  }
})

// --- Step 3: build the real IDKit request, show the code/QR, poll -----------

el<HTMLButtonElement>('btn-idkit').addEventListener('click', async () => {
  if (!screenResult?.idkit || !rpSignature) return
  const cfg = currentConfig()
  const idkit = screenResult.idkit
  const startBtn = el<HTMLButtonElement>('btn-idkit')
  const cancelBtn = el<HTMLButtonElement>('btn-idkit-cancel')
  const statusEl = el<HTMLElement>('idkit-status')
  const qrBox = el<HTMLElement>('idkit-qr')

  startBtn.disabled = true
  setBadge('idkit-status-badge', 'RUNNING')
  statusEl.textContent = 'Building the signed request…'

  try {
    // The field-name change that trips up every first integration: the
    // backend's /world/rp-signature returns `sig`, but the real
    // @worldcoin/idkit-core RpContext type names that field `signature`.
    // See backend/docs/API-CONTRACT.md, "Building the real IDKit request".
    const request = await IDKit.requestWithInviteCode({
      app_id: idkit.app_id as `app_${string}`,
      action: idkit.action,
      allow_legacy_proofs: idkit.allow_legacy_proofs,
      environment: cfg.environment,
      rp_context: {
        rp_id: idkit.rp_id,
        nonce: rpSignature.nonce,
        created_at: rpSignature.created_at,
        expires_at: rpSignature.expires_at,
        signature: rpSignature.sig,
      },
    }).preset(selfieCheckLegacy({ signal: idkit.signal }))

    activeRequest = request
    statusEl.textContent = `Waiting for World App — code expires ${new Date(request.expiresAt * 1000).toLocaleTimeString()}`
    qrBox.style.display = 'flex'
    qrBox.innerHTML = `
      <div>
        <div id="idkit-qr-img"></div>
      </div>
      <div>
        <p><strong>Open in World App</strong>, or scan the code:</p>
        <p class="qr-link"><a href="${request.connectorURI}" target="_blank" rel="noopener">${request.connectorURI}</a></p>
      </div>
    `
    const qrDataUrl = await QRCode.toDataURL(request.connectorURI, { width: 220, margin: 1 })
    const img = document.createElement('img')
    img.src = qrDataUrl
    img.width = 220
    img.height = 220
    el<HTMLElement>('idkit-qr-img').appendChild(img)

    cancelBtn.style.display = 'inline-block'
    pollAbort = new AbortController()

    const completion = await request.pollUntilCompletion({ signal: pollAbort.signal })

    if (completion.success) {
      idkitProof = completion.result
      setBadge('idkit-status-badge', 'COMPLETE')
      statusEl.textContent = 'Proof received from World App.'
      showPre('idkit-result', completion.result)
      setCardEnabled('card-verify', true)
    } else {
      setBadge('idkit-status-badge', 'FAILED')
      statusEl.textContent = `World App reported: ${completion.error}`
      showPre('idkit-result', { errorCode: completion.error })
    }
  } catch (err) {
    setBadge('idkit-status-badge', 'FAILED')
    statusEl.textContent = describeError(err)
    showError('idkit-result', err)
  } finally {
    startBtn.disabled = false
    cancelBtn.style.display = 'none'
    activeRequest = null
    pollAbort = null
  }
})

el<HTMLButtonElement>('btn-idkit-cancel').addEventListener('click', () => {
  pollAbort?.abort()
  el<HTMLElement>('idkit-status').textContent = `Cancelled (requestId: ${activeRequest?.requestId ?? 'unknown'}).`
  setBadge('idkit-status-badge', 'CANCELLED')
})

// --- Step 4: verify ----------------------------------------------------------

el<HTMLButtonElement>('btn-verify').addEventListener('click', async () => {
  if (!screenResult || idkitProof === null) return
  const cfg = currentConfig()
  const btn = el<HTMLButtonElement>('btn-verify')
  btn.disabled = true
  try {
    verifyResult = await api.worldVerify(
      cfg,
      {
        claimId: screenResult.claimId,
        idkitResponse: idkitProof,
        ...(screenResult.idkit?.rp_id ? { rp_id: screenResult.idkit.rp_id } : {}),
      },
      makeLogger(),
    )
    showPre('verify-result', verifyResult)
    setBadge('verify-badge', verifyResult.status)
    setCardEnabled('card-finalize', verifyResult.status !== 'RETRYABLE')
  } catch (err) {
    showError('verify-result', err)
  } finally {
    btn.disabled = false
  }
})

// --- Step 5: finalize ---------------------------------------------------------

el<HTMLButtonElement>('btn-finalize').addEventListener('click', async () => {
  if (!screenResult) return
  const cfg = currentConfig()
  const btn = el<HTMLButtonElement>('btn-finalize')
  btn.disabled = true
  try {
    finalizeResult = await api.finalize(cfg, { claimId: screenResult.claimId }, makeLogger())
    showPre('finalize-result', finalizeResult)
    setBadge('finalize-badge', finalizeResult.decision)
    if (finalizeResult.evidenceReceiptId) {
      el<HTMLButtonElement>('btn-receipt').dataset.receiptId = finalizeResult.evidenceReceiptId
      setCardEnabled('card-receipt', true)
    }
  } catch (err) {
    showError('finalize-result', err)
  } finally {
    btn.disabled = false
  }
})

// --- Step 6: receipt -----------------------------------------------------------

el<HTMLButtonElement>('btn-receipt').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-receipt')
  const receiptId = btn.dataset.receiptId
  if (!receiptId) return
  const cfg = currentConfig()
  btn.disabled = true
  try {
    const receipt = await api.receipt(cfg, receiptId, makeLogger())
    showPre('receipt-result', receipt)
  } catch (err) {
    showError('receipt-result', err)
  } finally {
    btn.disabled = false
  }
})

renderLog()
