"use client"

import { Header } from "@/components/header"

export default function HomePage() {
  // Large detailed ASCII laughing-crying emoji (like reference image)
  const laughingEmoji = `
                      ██████████████████                      
                ██████░░░░░░░░░░░░░░░░██████                
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        
      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██      
    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██    
    ██░░░░░░████████░░░░░░░░░░░░░░░░████████░░░░░░░░██    
  ██░░░░░░██████████░░░░░░░░░░░░░░██████████░░░░░░░░░░██  
  ██░░░░████████████░░░░░░░░░░░░░░████████████░░░░░░░░██  
  ██░░░░██████████░░░░░░░░░░░░░░░░░░██████████░░░░░░░░██  
  ██░░░░░░████████░░░░░░░░░░░░░░░░░░████████░░░░░░░░░░██  
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  
  ██░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░██  
  ██░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░░░██  
    ██░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░░░██    
    ██░░░░░░░░████████████████████████████░░░░░░░░░░██    
      ██░░░░░░░░░░░░████████████████░░░░░░░░░░░░░░██      
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            
                ██████░░░░░░░░░░░░░░░░██████                
                      ██████████████████                      
`

  // Blocky pixel-style "NO CRY CASINO" text
  const titleText = `
██  ██  █████      █████ █████  ██  ██
███ ██ ██   ██    ██     ██  ██  ████ 
██████ ██   ██    ██     █████    ██  
██ ███ ██   ██    ██     ██  ██   ██  
██  ██  █████      █████ ██  ██   ██  

 ████   ████  ████  ██ ██  ██  ████  
██     ██  ██ ██    ██ ███ ██ ██  ██ 
██     ██████ ████  ██ ██████ ██  ██ 
██     ██  ██    ██ ██ ██ ███ ██  ██ 
 ████  ██  ██ ████  ██ ██  ██  ████  
`

  // Clean ticker text
  const tickerText = "NO CRY CASINO"

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-[#7CFF6B]">
      <div className="relative z-10 flex flex-col min-h-screen">
        <Header />

        {/* Scrolling ticker */}
        <div className="ncc-ticker">
          <div className="ncc-ticker-track">
            {Array.from({ length: 20 }).map((_, i) => (
              <span key={i} className="ncc-ticker-item">
                ◆ {tickerText} ◆
              </span>
            ))}
          </div>
        </div>

        {/* Main content - centered emoji + title */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          {/* Large animated ASCII emoji */}
          <pre className="ncc-emoji-ascii" aria-label="Laughing crying emoji">
            {laughingEmoji}
          </pre>

          {/* Blocky ASCII title */}
          <pre className="ncc-title-ascii" aria-label="No Cry Casino">
            {titleText}
          </pre>

          {/* Subtle tagline */}
          <div className="mt-6 text-center font-mono text-xs text-[#7CFF6B]/50 tracking-[0.3em]">
            LIVE KOL TRACKING • P2P MARKETS
          </div>
        </div>
      </div>
    </div>
  )
}
