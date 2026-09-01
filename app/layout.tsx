import type { Metadata } from "next"
import Link from "next/link"
import "./globals.css"

export const metadata: Metadata = {
  title: "WIWO — Will it? Won't it?",
  description: "Autonomous QA that finds, fixes and verifies software bugs with Solari.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/" aria-label="WIWO home">
            <span className="brandMark"><b>WI</b><b>WO</b></span>
            <span className="brandName">WIWO<small>VERIFICATION SYSTEM</small></span>
          </Link>
          <div className="topbarMeta"><span className="pulse" /> SYSTEM READY <i>POWERED BY SOLARI</i></div>
        </header>
        {children}
      </body>
    </html>
  )
}
