import { useEffect, useState } from "react";

const sample = {
  chapterIndex: 1,
  totalChapters: 6,
  source: "Global News Network",
  headline: "FEDERAL RESERVE SIGNALS PAUSE IN RATE HIKE CYCLE",
  caption: "Markets surge as policymakers hold rates at 5.25–5.50%",
  explanation:
    "Investors welcomed the Federal Reserve's decision to hold interest rates steady, with the S&P 500 climbing 2.3% in after-hours trading. Technology stocks led the rally as analysts pointed to easing inflation data and resilient consumer spending as key factors behind the policy shift.",
};

const tickerItems = [
  "S&P 500 ▲ 2.3%  ·  DOW JONES ▲ 1.8%  ·  NASDAQ ▲ 3.1%",
  "GOLD $2,041 / OZ  ·  CRUDE OIL $78.45 / BBL  ·  USD/EUR 1.089",
  "FED HOLDS RATES AT 5.25–5.50%  ·  NEXT MEETING: JUNE 12",
  "GLOBAL MARKETS REACT POSITIVELY TO RATE DECISION",
];

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: "Oswald, sans-serif" }} className="text-white tabular-nums tracking-wider text-sm font-medium">
      {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

export function BroadcastSlide() {
  const [lowerThirdIn, setLowerThirdIn] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLowerThirdIn(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="relative w-full overflow-hidden select-none"
      style={{ background: "#050508", height: "100vh", fontFamily: "IBM Plex Sans, sans-serif" }}
    >
      {/* ── Background: simulated footage ── */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 60% 35%, #0d1a2e 0%, #050508 70%)",
        }}
      />
      {/* subtle scanline texture */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 3px)",
        }}
      />
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.75) 100%)",
        }}
      />
      {/* center glow accent */}
      <div
        className="absolute"
        style={{
          top: "15%", left: "55%", width: "480px", height: "320px",
          background: "radial-gradient(ellipse, rgba(20,60,120,0.28) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      {/* ── Top bar ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
        {/* Network bug */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-sm"
            style={{ background: "#c8102e" }}>
            <span style={{ fontFamily: "Oswald, sans-serif", color: "#fff", fontWeight: 700, fontSize: "13px", letterSpacing: "0.05em" }}>GNN</span>
          </div>
          <span className="text-white/50 text-xs tracking-widest uppercase"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}>
            Global News Network
          </span>
        </div>

        {/* Right: LIVE + clock */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm"
            style={{ background: "#c8102e" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span style={{ fontFamily: "Oswald, sans-serif", color: "#fff", fontWeight: 600, fontSize: "12px", letterSpacing: "0.12em" }}>LIVE</span>
          </div>
          <LiveClock />
        </div>
      </div>

      {/* ── Top accent line ── */}
      <div className="absolute top-0 left-0 right-0 h-[3px] z-30"
        style={{ background: "linear-gradient(to right, #c8102e, #ff4444, #c8102e)" }} />

      {/* ── Chapter pill ── */}
      <div
        className="absolute z-20"
        style={{ top: "52%", left: "48px", opacity: lowerThirdIn ? 1 : 0, transition: "opacity 0.6s ease 0.2s" }}
      >
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-sm" style={{ background: "#c8102e" }} />
          <span
            className="text-white/60 text-xs tracking-[0.2em] uppercase"
            style={{ fontFamily: "Oswald, sans-serif", fontWeight: 500 }}
          >
            Chapter {sample.chapterIndex} of {sample.totalChapters}
          </span>
        </div>
      </div>

      {/* ── Lower third block ── */}
      <div
        className="absolute left-0 right-0 z-20"
        style={{
          bottom: "60px",
          transform: lowerThirdIn ? "translateY(0)" : "translateY(110%)",
          transition: "transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Red accent stripe */}
        <div className="absolute left-0 top-0 bottom-0 w-[6px]" style={{ background: "#c8102e" }} />

        {/* Main lower-third panel */}
        <div
          className="ml-[6px] px-10 py-5"
          style={{ background: "linear-gradient(to right, rgba(5,5,10,0.97) 0%, rgba(5,5,10,0.92) 80%, transparent 100%)" }}
        >
          {/* Headline */}
          <div
            className="text-white leading-none mb-3"
            style={{
              fontFamily: "Oswald, sans-serif",
              fontWeight: 700,
              fontSize: "clamp(28px, 3.8vw, 48px)",
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              textShadow: "0 2px 12px rgba(0,0,0,0.8)",
            }}
          >
            {sample.headline}
          </div>

          {/* Rule */}
          <div className="w-16 h-[2px] mb-3" style={{ background: "#c8102e" }} />

          {/* Caption */}
          <div
            className="text-white/80 leading-snug mb-3"
            style={{
              fontFamily: "IBM Plex Sans, sans-serif",
              fontWeight: 400,
              fontSize: "clamp(14px, 1.6vw, 20px)",
              letterSpacing: "0.01em",
            }}
          >
            {sample.caption}
          </div>

          {/* Explanation */}
          <div
            className="text-white/55 leading-relaxed max-w-3xl"
            style={{
              fontFamily: "IBM Plex Sans, sans-serif",
              fontWeight: 300,
              fontSize: "clamp(11px, 1.1vw, 14px)",
            }}
          >
            {sample.explanation}
          </div>
        </div>
      </div>

      {/* ── Bottom ticker ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex items-center overflow-hidden"
        style={{ height: "56px", background: "rgba(5,5,10,0.98)", borderTop: "2px solid #c8102e" }}
      >
        {/* Source label */}
        <div
          className="flex-shrink-0 flex items-center justify-center px-4 h-full z-10"
          style={{ background: "#c8102e", minWidth: "90px" }}
        >
          <span style={{ fontFamily: "Oswald, sans-serif", color: "#fff", fontWeight: 700, fontSize: "13px", letterSpacing: "0.08em" }}>
            {sample.source.split(" ")[0].toUpperCase()}
          </span>
        </div>

        {/* Ticker scroll */}
        <div className="flex-1 overflow-hidden relative">
          <div
            className="flex gap-20 whitespace-nowrap"
            style={{
              animation: "ticker-scroll 22s linear infinite",
              paddingLeft: "100%",
            }}
          >
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={i}
                style={{ fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 500, fontSize: "13px", color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Ticker animation ── */}
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
