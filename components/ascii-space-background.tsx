"use client"

import { useEffect, useRef } from "react"

export function AsciiSpaceBackground() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let destroyed = false
    let cleanup: null | (() => void) = null

    const prefersReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

    void (async () => {
      const THREE = await import("three")
      if (destroyed) return

      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" })
      renderer.setClearColor(0x000000, 1)
      renderer.setPixelRatio(1)

      renderer.domElement.style.width = "100%"
      renderer.domElement.style.height = "100%"
      ;(renderer.domElement.style as any).imageRendering = "pixelated"
      renderer.domElement.style.display = "block"

      host.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

      const geometry = new THREE.PlaneGeometry(2, 2)

      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uCellPx: { value: 8.0 },
          uCells: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: `
        precision highp float;
        in vec3 position;
        in vec2 uv;
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        precision highp float;
        precision highp int;

        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uCellPx;
        uniform vec2 uCells;

        out vec4 outColor;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float sdSegment(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }

        float sdCircle(vec2 p, vec2 c, float r) {
          return length(p - c) - r;
        }

        float glyph(int id, vec2 uv) {
          vec2 p = (uv - 0.5) * 2.0;
          float w = 0.10;
          float d = 1e6;

          if (id == 0) {
            return 0.0;
          } else if (id == 1) {
            d = sdCircle(p, vec2(0.0, 0.0), 0.14);
          } else if (id == 2) {
            d = min(sdCircle(p, vec2(0.0, 0.38), 0.12), sdCircle(p, vec2(0.0, -0.38), 0.12));
          } else if (id == 3) {
            d = sdSegment(p, vec2(-0.65, 0.0), vec2(0.65, 0.0));
          } else if (id == 4) {
            d = min(sdSegment(p, vec2(-0.65, 0.32), vec2(0.65, 0.32)), sdSegment(p, vec2(-0.65, -0.32), vec2(0.65, -0.32)));
          } else if (id == 5) {
            d = min(sdSegment(p, vec2(-0.65, 0.0), vec2(0.65, 0.0)), sdSegment(p, vec2(0.0, -0.65), vec2(0.0, 0.65)));
          } else if (id == 6) {
            d = min(
              min(sdSegment(p, vec2(-0.65, 0.0), vec2(0.65, 0.0)), sdSegment(p, vec2(0.0, -0.65), vec2(0.0, 0.65))),
              min(sdSegment(p, vec2(-0.55, -0.55), vec2(0.55, 0.55)), sdSegment(p, vec2(-0.55, 0.55), vec2(0.55, -0.55)))
            );
          } else if (id == 7) {
            d = min(
              min(sdSegment(p, vec2(-0.25, -0.7), vec2(-0.25, 0.7)), sdSegment(p, vec2(0.25, -0.7), vec2(0.25, 0.7))),
              min(sdSegment(p, vec2(-0.7, 0.22), vec2(0.7, 0.22)), sdSegment(p, vec2(-0.7, -0.22), vec2(0.7, -0.22)))
            );
          } else if (id == 8) {
            d = min(
              sdSegment(p, vec2(-0.55, 0.55), vec2(0.55, -0.55)),
              min(sdCircle(p, vec2(-0.38, 0.38), 0.12), sdCircle(p, vec2(0.38, -0.38), 0.12))
            );
          } else {
            float ring = abs(sdCircle(p, vec2(0.0, 0.0), 0.62)) - 0.08;
            float tail = sdSegment(p, vec2(-0.05, 0.15), vec2(0.42, -0.22));
            float dotc = sdCircle(p, vec2(0.22, -0.05), 0.10);
            d = min(ring, min(tail, dotc));
          }

          float a = 1.0 - smoothstep(w, w + 0.02, d);
          return a;
        }

        float planetAndRing(vec2 uv, float t) {
          vec2 center = vec2(0.68, 0.54);
          vec2 p = uv - center;

          float r = 0.22;
          float d = length(p) - r;

          float planet = 0.0;
          if (d < 0.0) {
            float z = sqrt(max(0.0, r * r - dot(p, p))) / r;
            vec3 n = normalize(vec3(p / r, z));
            vec3 l = normalize(vec3(-0.55, 0.35, 0.75));
            float diff = max(dot(n, l), 0.0);
            float rim = pow(1.0 - max(n.z, 0.0), 2.0);
            float bands = 0.04 * sin((p.y / r) * 10.0 + t * 0.08);
            planet = clamp(0.10 + 0.85 * diff + 0.18 * rim + bands, 0.0, 1.0);
          }

          float ang = 0.45 + 0.02 * sin(t * 0.05);
          float ca = cos(ang);
          float sa = sin(ang);
          vec2 pr = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
          pr.y *= 2.6;

          float ringR = r * 1.45;
          float ringW = 0.03;
          float ringD = abs(length(pr) - ringR) - ringW;

          float ring = 0.0;
          if (ringD < 0.0) {
            float fade = smoothstep(ringW, 0.0, abs(length(pr) - ringR));
            float front = pr.y > 0.0 ? 1.0 : smoothstep(0.0, 0.01, d);
            ring = 0.65 * fade * front;
          }

          return max(planet, ring);
        }

        float stars(vec2 uv, float t) {
          vec2 drift = vec2(t * 0.003, t * 0.0015);
          vec2 p = uv * vec2(120.0, 60.0) + drift;
          vec2 ip = floor(p);
          float rnd = hash12(ip);
          if (rnd < 0.996) return 0.0;
          float tw = 0.65 + 0.35 * sin(t * 0.25 + rnd * 31.0);
          float b = smoothstep(0.996, 1.0, rnd) * tw;
          return b;
        }

        float shootingStar(vec2 uv, float t) {
          float period = 22.0;
          float k = floor(t / period);
          float x = hash12(vec2(k, 1.3));
          if (x < 0.78) return 0.0;

          float u = fract(t / period);
          float life = smoothstep(0.08, 0.14, u) * (1.0 - smoothstep(0.32, 0.40, u));
          if (life <= 0.0) return 0.0;

          vec2 start = vec2(0.15 + 0.25 * hash12(vec2(k, 2.1)), 0.20 + 0.35 * hash12(vec2(k, 3.7)));
          vec2 dir = normalize(vec2(1.0, -0.55));
          float speed = 0.55;
          vec2 pos = start + dir * (u * speed);

          vec2 p = uv - pos;
          vec2 a = vec2(0.0, 0.0);
          vec2 b = -dir * 0.12;
          float d = sdSegment(p, a, b);
          float streak = 1.0 - smoothstep(0.0, 0.02, d);
          return streak * life;
        }

        void main() {
          vec2 frag = gl_FragCoord.xy;
          vec2 cell = floor(frag / uCellPx);
          vec2 local = fract(frag / uCellPx);

          if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uCells.x || cell.y >= uCells.y) {
            outColor = vec4(0.0);
            return;
          }

          vec2 uv = (cell + 0.5) / uCells;

          float t = uTime;
          float lum = 0.0;

          lum = max(lum, 0.9 * stars(uv, t));
          lum = max(lum, 0.9 * planetAndRing(uv, t));
          lum = max(lum, 0.9 * shootingStar(uv, t));

          lum = clamp(lum, 0.0, 1.0);

          int rampLen = 10;
          float idxf = floor(lum * float(rampLen - 1) + 0.5);
          int idx = int(clamp(idxf, 0.0, float(rampLen - 1)));

          float g = glyph(idx, local);
          outColor = vec4(vec3(g), 1.0);
        }
      `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })

      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)

      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

      let raf = 0
      let start = performance.now()
      let lastRender = 0
      const targetFrameMs = 1000 / 30

      const resize = () => {
        const w = host.clientWidth
        const h = host.clientHeight
        if (w <= 0 || h <= 0) return

        const downscale = clamp(Math.round(Math.max(1, Math.min(3, Math.max(w, h) / 700))), 1, 3)
        const rw = Math.max(1, Math.floor(w / downscale))
        const rh = Math.max(1, Math.floor(h / downscale))

        renderer.setSize(rw, rh, false)

        const cellPx = clamp(Math.round(Math.max(7, Math.min(12, Math.max(rw, rh) / 110))), 7, 12)
        ;(material.uniforms.uResolution.value as any).set(rw, rh)
        material.uniforms.uCellPx.value = cellPx

        const cellsX = Math.max(1, Math.floor(rw / cellPx))
        const cellsY = Math.max(1, Math.floor(rh / cellPx))
        ;(material.uniforms.uCells.value as any).set(cellsX, cellsY)
      }

      resize()

      const ro = new ResizeObserver(resize)
      ro.observe(host)

      const animate = () => {
        const now = performance.now()

        if (prefersReduced) {
          material.uniforms.uTime.value = 0
          renderer.render(scene, camera)
          return
        }

        raf = requestAnimationFrame(animate)

        if (now - lastRender < targetFrameMs) return
        lastRender = now
        const t = (now - start) / 1000
        material.uniforms.uTime.value = t

        renderer.render(scene, camera)
      }

      animate()

      cleanup = () => {
        if (raf) cancelAnimationFrame(raf)
        ro.disconnect()
        geometry.dispose()
        material.dispose()
        renderer.dispose()
        const el = renderer.domElement
        if (el.parentElement) el.parentElement.removeChild(el)
      }
    })()

    return () => {
      destroyed = true
      if (cleanup) cleanup()
    }
  }, [])

  return <div ref={hostRef} className="absolute inset-0 z-0 pointer-events-none" />
}
