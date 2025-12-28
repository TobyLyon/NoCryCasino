"use client"

import { useRef, useEffect, useState } from "react"

export default function DownloadLogoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const measureRef = useRef<HTMLPreElement>(null)
  const [ready, setReady] = useState(false)

  // Exact same ASCII emoji from the landing page
  const emoji =
    "                      ██████████████████                      \n" +
    "                ██████░░░░░░░░░░░░░░░░██████                \n" +
    "            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            \n" +
    "          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          \n" +
    "        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        \n" +
    "      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██      \n" +
    "    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██    \n" +
    "    ██░░░░░░████████░░░░░░░░░░░░░░░░████████░░░░░░░░██    \n" +
    "  ██░░░░░░██████████░░░░░░░░░░░░░░██████████░░░░░░░░░░██  \n" +
    "  ██░░░░████████████░░░░░░░░░░░░░░████████████░░░░░░░░██  \n" +
    "  ██░░░░██████████░░░░░░░░░░░░░░░░░░██████████░░░░░░░░██  \n" +
    "  ██░░░░░░████████░░░░░░░░░░░░░░░░░░████████░░░░░░░░░░██  \n" +
    "  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  \n" +
    "  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  \n" +
    "  ██░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░██  \n" +
    "  ██░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░░░██  \n" +
    "    ██░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░░░██    \n" +
    "    ██░░░░░░░░████████████████████████████░░░░░░░░░░██    \n" +
    "      ██░░░░░░░░░░░░████████████████░░░░░░░░░░░░░░██      \n" +
    "        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        \n" +
    "          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          \n" +
    "            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            \n" +
    "                ██████░░░░░░░░░░░░░░░░██████                \n" +
    "                      ██████████████████                      "

  const renderToCanvas = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const measureEl = measureRef.current
    if (!measureEl) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const size = 1000
    canvas.width = size
    canvas.height = size
    ctx.clearRect(0, 0, size, size)

    const lines = emoji.split("\n")
    const rows = lines.length

    const style = window.getComputedStyle(measureEl)
    const baseFontSizePx = parseFloat(style.fontSize || "12")
    // computedStyle font-family often includes quotes which break SVG attributes; strip them.
    const fontFamily = (style.fontFamily || "ui-monospace, monospace").replace(/["']/g, "")
    const fontWeight = style.fontWeight || "700"
    const baseLetterSpacingPx = parseFloat(style.letterSpacing || "0")

    const baseLineHeightPxRaw = parseFloat(style.lineHeight || "0")
    const baseLineHeightPx =
      Number.isFinite(baseLineHeightPxRaw) && baseLineHeightPxRaw > 0 ? baseLineHeightPxRaw : baseFontSizePx

    const letterSpacingEm = baseLetterSpacingPx / baseFontSizePx
    const lineHeightEm = baseLineHeightPx / baseFontSizePx
    const cols = Math.max(...lines.map((l) => l.length))

    const targetW = size * 0.88
    const targetH = size * 0.88

    const measureFor = (fontSize: number) => {
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
      const advance = ctx.measureText("█").width
      const step = advance + letterSpacingEm * fontSize
      const w = cols > 0 ? (cols - 1) * step + advance : 0
      const h = rows * (lineHeightEm * fontSize)
      return { advance, step, w, h }
    }

    let lo = 4
    let hi = 240
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2)
      const d = measureFor(mid)
      if (d.w <= targetW && d.h <= targetH) lo = mid
      else hi = mid - 1
    }

    const fontSize = lo
    const d = measureFor(fontSize)
    const startX = (size - d.w) / 2
    const startY = (size - d.h) / 2
    const lineH = lineHeightEm * fontSize

    const letterSpacingPx = letterSpacingEm * fontSize

    const escapeXml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    const escapeXmlAttr = (s: string) =>
      escapeXml(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;")

    const loadSvgToCanvas = async (svg: string) => {
      await new Promise<void>((resolve, reject) => {
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.decoding = "async"
        img.crossOrigin = "anonymous"
        img.onload = () => {
          try {
            ctx.clearRect(0, 0, size, size)
            ctx.drawImage(img, 0, 0)
            resolve()
          } catch (e) {
            reject(e)
          } finally {
            URL.revokeObjectURL(url)
          }
        }
        img.onerror = (e) => {
          URL.revokeObjectURL(url)
          reject(e)
        }
        img.src = url
      })
    }

    const defs = `
      <defs>
        <filter id="nccBlur10" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="nccBlur30" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
        <filter id="nccBlur60" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="60" />
        </filter>
      </defs>
    `

    const baseTextAttrs =
      `xml:space="preserve" dominant-baseline="hanging" ` +
      `font-family="${escapeXmlAttr(fontFamily)}" font-size="${fontSize}" ` +
      `font-weight="${escapeXmlAttr(fontWeight)}" letter-spacing="${letterSpacingPx}px"`

    const renderLayer = (fill: string, extra: string) =>
      lines
        .map((line, i) => {
          const y = startY + i * lineH
          return `<text ${baseTextAttrs} x="${startX}" y="${y}" fill="${fill}" ${extra}>${escapeXml(
            line,
          )}</text>`
        })
        .join("")

    const layer10 = `<g filter="url(#nccBlur10)" opacity="0.80">${renderLayer("#7CFF6B", "")}</g>`
    const layer30 = `<g filter="url(#nccBlur30)" opacity="0.50">${renderLayer("#7CFF6B", "")}</g>`
    const layer60 = `<g filter="url(#nccBlur60)" opacity="0.30">${renderLayer("#7CFF6B", "")}</g>`
    const crisp = `<g opacity="0.98">${renderLayer("#7CFF6B", "")}</g>`

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `${defs}` +
      `${layer60}${layer30}${layer10}${crisp}` +
      `</svg>`

    await loadSvgToCanvas(svg)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await renderToCanvas()
        if (!cancelled) setReady(true)
      } catch {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const downloadPNG = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      await renderToCanvas()
    } catch {
      // best-effort; still attempt to download whatever is currently in the canvas
    }

    const link = document.createElement("a")
    link.download = "no-cry-casino-logo-1000x1000.png"
    link.href = canvas.toDataURL("image/png")
    link.click()
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold text-[#7CFF6B] mb-4">No Cry Casino Logo</h1>
      <p className="text-[#7CFF6B]/70 mb-6 text-center">
        1000 x 1000 PNG with transparent background
      </p>

      <div className="border border-[#7CFF6B]/30 rounded-lg p-4 mb-6 bg-[#111]">
        <canvas
          ref={canvasRef}
          className="max-w-[400px] max-h-[400px] w-full h-auto"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      <pre
        ref={measureRef}
        className="ncc-emoji-ascii"
        style={{ position: "absolute", left: "-99999px", top: "-99999px", pointerEvents: "none" }}
      >
        {emoji}
      </pre>

      {ready && (
        <button
          onClick={downloadPNG}
          className="px-6 py-3 bg-[#7CFF6B] text-black font-bold rounded-lg hover:bg-[#5ed94f] transition-colors"
        >
          Download PNG (1000x1000)
        </button>
      )}

      <p className="text-[#7CFF6B]/50 text-xs mt-8">
        One-time download page • Transparent background included
      </p>
    </div>
  )
}
