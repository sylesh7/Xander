/**
 * OpenTelemetry — Xander V2 spec section 33, Phase 12.
 *
 * Off by default and started before anything else when on. Auto-instrumentation
 * has to patch `http`, `pg` and `ioredis` BEFORE they are imported, so this
 * module is loaded from the very top of `server.ts` and `worker.ts` and must
 * not import anything from the application itself beyond config.
 *
 * WHAT IS DELIBERATELY NOT TRACED: request and response bodies. Section 28
 * limits what Xander stores, and a tracing backend is storage like any other —
 * a span carrying a World nullifier or an operator token would leak a
 * credential into a system with completely different access controls.
 */
import { env } from '../config/env.js'

let started = false
let sdk: { shutdown: () => Promise<void> } | null = null

/**
 * Starts tracing if enabled. Idempotent and never fatal.
 *
 * A telemetry failure must not stop the service: observability is how you find
 * out something is wrong, not a thing worth refusing to boot over.
 */
export async function startTelemetry(): Promise<{ started: boolean; detail: string }> {
  if (!env.OTEL_ENABLED) return { started: false, detail: 'OTEL_ENABLED is false' }
  if (started) return { started: true, detail: 'already started' }

  try {
    const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }, { resourceFromAttributes }] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/auto-instrumentations-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
      ])

    const instance = new NodeSDK({
      resource: resourceFromAttributes({
        'service.name': env.OTEL_SERVICE_NAME,
        'deployment.environment': env.NODE_ENV,
      }),
      ...(env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? { traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }) }
        : {}),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Noise, and it fires on every file read.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    })

    instance.start()
    sdk = instance
    started = true
    return {
      started: true,
      detail: env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? `exporting to ${env.OTEL_EXPORTER_OTLP_ENDPOINT}`
        : 'started with no exporter configured',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Reported, never thrown.
    return { started: false, detail: `telemetry failed to start: ${message}` }
  }
}

export async function stopTelemetry(): Promise<void> {
  if (!sdk) return
  try {
    await sdk.shutdown()
  } catch {
    // Shutting down is best-effort by definition.
  }
  sdk = null
  started = false
}

export function telemetryStatus(): { enabled: boolean; started: boolean } {
  return { enabled: env.OTEL_ENABLED, started }
}
