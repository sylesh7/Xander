'use client'

import { useEffect, useRef } from 'react'

export default function DeadNorthTuner() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    if (!ctx) return

    const off = document.createElement('canvas')
    const offCtx = off.getContext('2d', { willReadFrequently: true })!
    if (!offCtx) return

    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mqDark = window.matchMedia('(prefers-color-scheme: dark)')

    const colors = { ink: '#131316', signal: '#d8280b', bolt: '#0e3fbf' }
    let dots: number[] = []       // [x, y, opacity, ...]
    let W = 0, H = 0              // logical dimensions
    let curX = -9999, curY = -9999
    let glowI = 0, holdI = 0     // glow intensity, hold intensity
    let isHolding = false
    let timeG = 0                 // animation time counter
    let rafId = 0
    let resizeTimer: ReturnType<typeof setTimeout>
    let colorGrad: string[] = []  // 9-color gradient ink→amber
    let gap = 7, waveAmp = 1, plateSep = 1
    let inkOverride: string | null = null

    function hexToRgb(hex: string): [number, number, number] {
      const h = hex.replace('#', '')
      const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
      return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
    }

    function refreshColors() {
      const cs = getComputedStyle(document.documentElement)
      colors.ink = cs.getPropertyValue('--color-ink').trim() || colors.ink
      colors.signal = cs.getPropertyValue('--color-signal').trim() || colors.signal
      colors.bolt = cs.getPropertyValue('--color-bolt').trim() || colors.bolt
      const amber = cs.getPropertyValue('--color-amber').trim() || '#b06414'
      try {
        const [ir, ig, ib] = hexToRgb(colors.ink)
        const [ar, ag, ab] = hexToRgb(amber)
        colorGrad = Array.from({ length: 9 }, (_, s) => {
          const c = (s / 8) * 0.55
          return `rgb(${Math.round(ir + (ar - ir) * c)},${Math.round(ig + (ag - ig) * c)},${Math.round(ib + (ab - ib) * c)})`
        })
      } catch {
        colorGrad = [colors.ink]
      }
    }

    function buildDots() {
      const rect = canvas.getBoundingClientRect()
      W = Math.max(320, Math.round(rect.width))
      H = Math.round(rect.height)

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      off.width = W
      off.height = H
      offCtx.setTransform(1, 0, 0, 1, 0, 0)
      offCtx.fillStyle = '#fff'
      offCtx.fillRect(0, 0, W, H)
      offCtx.fillStyle = '#000'
      offCtx.textAlign = 'center'
      offCtx.textBaseline = 'middle'

      const lines = W < 620 ? ['DEAD', 'NORTH'] : ['DEAD NORTH']
      const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-shout').trim() || 'Anton, Impact, sans-serif'
      let fs = lines.length === 1 ? H * 0.92 : H * 0.52
      offCtx.font = `400 ${fs}px ${fontFamily}`
      const maxW = Math.max(...lines.map(l => offCtx.measureText(l).width))
      if (maxW > W * 0.96) { fs *= (W * 0.96) / maxW; offCtx.font = `400 ${fs}px ${fontFamily}` }
      const lineH = fs * 0.86
      const startY = H / 2 - lineH * (lines.length - 1) / 2
      lines.forEach((line, i) => offCtx.fillText(line, W / 2, startY + i * lineH))

      const { data } = offCtx.getImageData(0, 0, W, H)
      dots = []
      for (let y = gap / 2; y < H; y += gap)
        for (let x = gap / 2; x < W; x += gap) {
          const idx = ((y | 0) * W + (x | 0)) * 4
          dots.push(x, y, 1 - data[idx] / 255)
        }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      const maxR = gap * 0.62

      for (let t = 0; t < dots.length; t += 3) {
        const x = dots[t], y = dots[t + 1], opacity = dots[t + 2]

        const wave = mqMotion.matches
          ? 0
          : (Math.sin(x * 0.014 + timeG * 1.1) * Math.cos(y * 0.02 - timeG * 0.7) + 1) * 0.5 * waveAmp

        const eff = opacity * 0.94 + wave * 0.13

        const dx = x - curX, dy = y - curY
        const dist = Math.sqrt(dx * dx + dy * dy)
        const glow = Math.max(dist < 150 ? (1 - dist / 150) * glowI : 0, holdI)

        let r = (eff + glow * 0.4) * maxR
        if (r < 0.34) continue
        if (r > maxR) r = maxR

        if (glow > 0.06) {
          const sep = glow * 4.2 * plateSep
          ctx.globalAlpha = glow * 0.85
          ctx.fillStyle = colors.signal
          ctx.beginPath(); ctx.arc(x - sep, y, r, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = colors.bolt
          ctx.beginPath(); ctx.arc(x + sep, y, r, 0, Math.PI * 2); ctx.fill()
          ctx.globalAlpha = 1 - glow * 0.55
        } else {
          ctx.globalAlpha = 1
        }

        ctx.fillStyle = inkOverride ?? colorGrad[Math.min(colorGrad.length - 1, (wave * (colorGrad.length - 1)) | 0)] ?? colors.ink
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    function loop() {
      timeG += 0.016
      glowI += (+(curX > -9000) - glowI) * 0.09
      holdI += isHolding ? (1 - holdI) * 0.045 : -holdI * 0.12
      if (holdI < 0.001) holdI = 0
      draw()
      rafId = requestAnimationFrame(loop)
    }

    function setup() {
      refreshColors()
      buildDots()
      if (rafId) cancelAnimationFrame(rafId)
      if (mqMotion.matches) { glowI = 0; draw() } else { rafId = requestAnimationFrame(loop) }
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect()
      curX = e.clientX - rect.left
      curY = e.clientY - rect.top
    }

    function onPointerLeave() { curX = -9999; curY = -9999; isHolding = false }
    function onPointerDown(e: PointerEvent) { isHolding = true; onPointerMove(e); canvas.setPointerCapture(e.pointerId) }
    function onPointerUp() { isHolding = false }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (curX < 0) { curX = W / 2; curY = H / 2 }
        isHolding = true
      }
    }
    function onKeyUp(e: KeyboardEvent) { if (e.key === ' ' || e.key === 'Enter') isHolding = false }
    function onFocus() { curX = W / 2; curY = H / 2 }
    function onBlur() { curX = -9999; curY = -9999; isHolding = false }
    function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(setup, 180) }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('keydown', onKeyDown)
    canvas.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('focus', onFocus)
    canvas.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)
    mqDark.addEventListener('change', setup)
    mqMotion.addEventListener('change', setup)

    const themeObs = new MutationObserver(setup)
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // Wait for fonts before first draw
    if (document.fonts?.ready) {
      document.fonts.ready.then(setup)
    } else {
      setup()
    }

    // Expose control API (CH99 control room compatibility)
    ;(window as any).__dnTuner = {
      setGap(v: number) { gap = Math.min(14, Math.max(4, Math.round(v))); setup() },
      setWave(v: number) { waveAmp = Math.min(3, Math.max(0, v)) },
      setSep(v: number) { plateSep = Math.min(4, Math.max(0, v)) },
      setInk(v: string) { inkOverride = v; if (mqMotion.matches) draw() },
      setLines() {},
      getState: () => ({ gap, wave: waveAmp, sep: plateSep }),
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      clearTimeout(resizeTimer)
      if ((window as any).__dnTuner) delete (window as any).__dnTuner
      themeObs.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('focus', onFocus)
      canvas.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onResize)
      mqDark.removeEventListener('change', setup)
      mqMotion.removeEventListener('change', setup)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-tuner=""
      data-lines="DEAD NORTH"
      className="block w-full cursor-crosshair touch-pan-y"
      style={{ height: '260px' }}
      role="img"
      aria-label="Interactive halftone rendering of the words DEAD NORTH. Moving the pointer separates the color plates; with keyboard focus, hold Space or Enter to tune the color in."
      tabIndex={0}
    >
      DEAD NORTH
    </canvas>
  )
}
