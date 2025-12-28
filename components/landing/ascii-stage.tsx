"use client"

import { useEffect, useMemo, useRef } from "react"

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  a: number
  ch: string
  layer: number
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function AsciiStage({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seed = useMemo(() => Math.floor(Math.random() * 1_000_000_000), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let w = 0
    let h = 0
    let dpr = 1

    const rng = mulberry32(seed)

    const charset = "░▒▓█▄▀<>/\\|=+*•.:;".split("")
    const words = ["NO", "CRY", "CASINO", "SOL", "KOL", "P2P", "YES", "NO"]

    const faceFrames: string[][] = [
      [
        "      .-''''''''-.      ",
        "   .-'            '-.   ",
        "  /   .--.    .--.   \\",
        " |   (o  o)  (o  o)   |",
        " |    '--'    '--'    |",
        " |    .-._    _.-.    |",
        "  \\  (   \\__/   )   / ",
        "   '-.\\   ____   /.-'  ",
        "      '._\\____/_. '    ",
        "         /  __  \\       ",
        "        /__/  \\__\\      ",
      ],
      [
        "      .-''''''''-.      ",
        "   .-'            '-.   ",
        "  /   .--.    .--.   \\",
        " |   (o  o)  (o  o)   |",
        " |    '--'    '--'    |",
        " |    .-._    _.-.    |",
        "  \\   (  ____  )    / ",
        "   '-.\\ (____) /.-'   ",
        "      '._\\____/_. '    ",
        "         /  __  \\       ",
        "        /__/  \\__\\      ",
      ],
      [
        "      .-''''''''-.      ",
        "   .-'            '-.   ",
        "  /   .--.    .--.   \\",
        " |   (x  x)  (x  x)   |",
        " |    '--'    '--'    |",
        " |    .-._    _.-.    |",
        "  \\    (______)     / ",
        "   '-.\\   __   /.-'   ",
        "      '._\\____/_. '    ",
        "         /  __  \\       ",
        "        /__/  \\__\\      ",
      ],
    ]

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = clamp(window.devicePixelRatio || 1, 1, 2)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()

    const baseFont = clamp(Math.round(Math.min(w, h) / 70), 11, 16)
    const cell = baseFont + 4

    const count = clamp(Math.floor((w * h) / (cell * cell) / 1.25), 260, 1300)
    const particles: Particle[] = []

    for (let i = 0; i < count; i++) {
      const layer = rng() < 0.12 ? 2 : rng() < 0.42 ? 1 : 0
      const speed = layer === 2 ? 0.75 : layer === 1 ? 0.45 : 0.22
      particles.push({
        x: rng() * w,
        y: rng() * h,
        vx: (rng() - 0.5) * speed,
        vy: (0.15 + rng() * 0.55) * speed,
        a: layer === 2 ? 0.55 : layer === 1 ? 0.32 : 0.22,
        ch: rng() < 0.08 ? words[Math.floor(rng() * words.length)] : charset[Math.floor(rng() * charset.length)],
        layer,
      })
    }

    let last = performance.now()
    let acc = 0

    const draw = (t: number) => {
      const dt = t - last
      last = t
      acc += dt

      const step = 1000 / 30
      if (acc < step) {
        raf = requestAnimationFrame(draw)
        return
      }
      acc %= step

      ctx.fillStyle = "rgba(0,0,0,0.28)"
      ctx.fillRect(0, 0, w, h)

      const glow = 0.5 + 0.5 * Math.sin(t / 1100)
      ctx.save()
      ctx.globalCompositeOperation = "lighter"

      for (const p of particles) {
        const jitter = p.layer === 2 ? 0.65 : p.layer === 1 ? 0.4 : 0.25
        p.x += p.vx + (rng() - 0.5) * 0.06 * jitter
        p.y += p.vy

        if (p.y > h + 40) {
          p.y = -40 - rng() * 80
          p.x = rng() * w
          p.ch = rng() < 0.08 ? words[Math.floor(rng() * words.length)] : charset[Math.floor(rng() * charset.length)]
          p.a = p.layer === 2 ? 0.58 : p.layer === 1 ? 0.34 : 0.22
        }
        if (p.x < -120) p.x = w + 120
        if (p.x > w + 120) p.x = -120

        const fontSize = p.layer === 2 ? baseFont + 5 : p.layer === 1 ? baseFont + 2 : baseFont
        ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
        ctx.textBaseline = "top"

        const a = p.a * (0.65 + 0.55 * glow)
        ctx.fillStyle = `rgba(124,255,107,${a})`
        ctx.fillText(p.ch, p.x, p.y)
      }

      const cx = w * 0.5
      const cy = h * 0.43
      const frameIdx = Math.floor((t / 240) % faceFrames.length)
      const frame = faceFrames[frameIdx]
      const faceFont = clamp(Math.round(baseFont * 1.55), 16, 28)
      ctx.font = `700 ${faceFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
      ctx.textBaseline = "top"

      const faceW = Math.max(...frame.map((s) => s.length)) * (faceFont * 0.6)
      const faceH = frame.length * (faceFont * 1.05)

      const wobble = Math.sin(t / 700) * 2.5
      const glitch = Math.sin(t / 120) > 0.98 ? (rng() - 0.5) * 18 : 0

      ctx.fillStyle = `rgba(124,255,107,${0.20 + 0.10 * glow})`
      for (let i = 0; i < frame.length; i++) {
        const line = frame[i]
        const x = cx - faceW / 2 + wobble + glitch
        const y = cy - faceH / 2 + i * faceFont * 1.05 + wobble * 0.35
        ctx.fillText(line, x, y)
      }

      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    const onResize = () => {
      resize()
    }

    window.addEventListener("resize", onResize)
    raf = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(raf)
    }
  }, [seed])

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="ncc-ascii-canvas" />
      <div className="ncc-crt" />
    </div>
  )
}
