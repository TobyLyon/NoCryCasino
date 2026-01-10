"use client"

import { useEffect, useRef, memo } from "react"

// Optimized ASCII ramp - fewer chars = faster lookup
const ASCII_RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
const RAMP_LEN = ASCII_RAMP.length

// Pre-compute sin/cos lookup tables for performance
const SIN_TABLE_SIZE = 1024
const SIN_TABLE: number[] = new Array(SIN_TABLE_SIZE)
const COS_TABLE: number[] = new Array(SIN_TABLE_SIZE)
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
  const angle = (i / SIN_TABLE_SIZE) * Math.PI * 2
  SIN_TABLE[i] = Math.sin(angle)
  COS_TABLE[i] = Math.cos(angle)
}

function fastSin(x: number): number {
  const normalized = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const index = Math.floor((normalized / (Math.PI * 2)) * SIN_TABLE_SIZE) & (SIN_TABLE_SIZE - 1)
  return SIN_TABLE[index]!
}

function fastCos(x: number): number {
  const normalized = ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const index = Math.floor((normalized / (Math.PI * 2)) * SIN_TABLE_SIZE) & (SIN_TABLE_SIZE - 1)
  return COS_TABLE[index]!
}

type ShaderMode = "waves" | "matrix" | "plasma" | "tunnel"

interface AsciiShaderBackgroundProps {
  mode?: ShaderMode
  opacity?: number
  color?: string
}

function AsciiShaderBackgroundInner({ 
  mode = "plasma", 
  opacity = 0.15,
  color = "emerald"
}: AsciiShaderBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef({
    animationId: 0,
    lastFrame: 0,
    destroyed: false,
    cols: 0,
    rows: 0,
    cellW: 12,
    cellH: 14,
    buffer: "" as string,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { 
      alpha: true,
      desynchronized: true, // Hint for better performance
    })
    if (!ctx) return

    const state = stateRef.current
    state.destroyed = false

    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    const TARGET_FPS = prefersReduced ? 0 : 20
    const FRAME_TIME = TARGET_FPS > 0 ? 1000 / TARGET_FPS : Infinity

    // Shader functions - compute brightness at each (x, y, t)
    const shaders: Record<ShaderMode, (nx: number, ny: number, t: number) => number> = {
      waves: (nx, ny, t) => {
        const wave1 = fastSin(nx * 6 + t * 0.4) * 0.3
        const wave2 = fastCos(ny * 5 - t * 0.3) * 0.3
        const wave3 = fastSin((nx + ny) * 4 + t * 0.5) * 0.2
        return 0.3 + wave1 + wave2 + wave3
      },

      matrix: (nx, ny, t) => {
        // Falling columns effect
        const col = Math.floor(nx * 40)
        const speed = 0.5 + (col % 7) * 0.15
        const offset = (col * 0.73) % 1
        const fall = ((ny + t * speed + offset) % 1)
        const brightness = fall < 0.3 ? (0.3 - fall) * 3 : 0
        // Add some randomness per column
        const flicker = fastSin(col * 12.34 + t * 2) * 0.1
        return brightness + flicker * 0.5
      },

      plasma: (nx, ny, t) => {
        // Classic plasma effect
        const cx = nx - 0.5
        const cy = ny - 0.5
        
        const v1 = fastSin(nx * 10 + t * 0.3)
        const v2 = fastSin(10 * (nx * fastSin(t * 0.2) + ny * fastCos(t * 0.3)) + t * 0.2)
        const v3 = fastSin(Math.sqrt(100 * (cx * cx + cy * cy) + 1) + t * 0.5)
        const v4 = fastSin(Math.sqrt(50 * cx * cx + 50 * cy * cy) - t * 0.4)
        
        return (v1 + v2 + v3 + v4 + 4) / 8
      },

      tunnel: (nx, ny, t) => {
        const cx = nx - 0.5
        const cy = ny - 0.5
        const dist = Math.sqrt(cx * cx + cy * cy) + 0.001
        const angle = Math.atan2(cy, cx)
        
        // Tunnel rings moving inward
        const rings = fastSin(1 / dist * 3 - t * 2) * 0.5 + 0.5
        // Spiral pattern
        const spiral = fastSin(angle * 4 + 1 / dist * 2 - t) * 0.3
        
        // Fade at edges and center
        const fade = Math.min(1, dist * 3) * Math.max(0, 1 - dist * 1.5)
        
        return (rings + spiral) * fade
      },
    }

    const shader = shaders[mode]

    const resize = () => {
      if (state.destroyed) return

      const w = window.innerWidth
      const h = window.innerHeight
      if (w <= 0 || h <= 0) return

      // Lower resolution for performance
      const scale = Math.max(1, Math.min(2, Math.floor(Math.max(w, h) / 800)))
      state.cellW = 10 * scale
      state.cellH = 14 * scale

      state.cols = Math.ceil(w / state.cellW)
      state.rows = Math.ceil(h / state.cellH)

      canvas.width = w
      canvas.height = h
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const render = (t: number) => {
      if (state.destroyed) return

      const { cols, rows, cellW, cellH } = state
      if (cols <= 0 || rows <= 0) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Set font once
      ctx.font = `${cellH - 2}px "Courier New", monospace`
      ctx.textBaseline = "top"

      // Color based on prop
      const colors: Record<string, string> = {
        emerald: `rgba(16, 185, 129, ${opacity})`,
        teal: `rgba(20, 184, 166, ${opacity})`,
        green: `rgba(34, 197, 94, ${opacity})`,
        cyan: `rgba(6, 182, 212, ${opacity})`,
        blue: `rgba(59, 130, 246, ${opacity})`,
      }
      ctx.fillStyle = colors[color] || colors.emerald!

      // Compute and render each character
      for (let y = 0; y < rows; y++) {
        const ny = y / rows
        let line = ""

        for (let x = 0; x < cols; x++) {
          const nx = x / cols

          // Compute brightness using shader function
          let brightness = shader(nx, ny, t)

          // Clamp to [0, 1]
          brightness = Math.max(0, Math.min(1, brightness))

          // Map to ASCII character
          const charIndex = Math.floor(brightness * (RAMP_LEN - 1))
          line += ASCII_RAMP[charIndex] || " "
        }

        // Draw entire row at once (much faster than char by char)
        ctx.fillText(line, 0, y * cellH)
      }
    }

    const animate = (now: number) => {
      if (state.destroyed) return

      state.animationId = requestAnimationFrame(animate)

      // Throttle to target FPS
      if (now - state.lastFrame < FRAME_TIME) return
      state.lastFrame = now

      const t = now / 1000
      render(prefersReduced ? 0 : t)
    }

    resize()
    
    // Debounced resize handler
    let resizeTimeout: ReturnType<typeof setTimeout>
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(resize, 100)
    }
    
    window.addEventListener("resize", handleResize, { passive: true })

    // Start animation
    state.animationId = requestAnimationFrame(animate)

    return () => {
      state.destroyed = true
      if (state.animationId) {
        cancelAnimationFrame(state.animationId)
      }
      clearTimeout(resizeTimeout)
      window.removeEventListener("resize", handleResize)
    }
  }, [mode, opacity, color])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  )
}

export const AsciiShaderBackground = memo(AsciiShaderBackgroundInner)
