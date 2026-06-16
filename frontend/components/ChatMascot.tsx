"use client";
import { useEffect, useRef } from "react";

const CSS = `
.cm-wrap { position: fixed; right: 20px; bottom: 20px; z-index: 999999; }
.cm-box  { position: relative; width: 78px; height: 78px; }
.cm-ring {
  position: absolute; left: 50%; top: 50%; width: 78px; height: 78px; border-radius: 50%;
  background: radial-gradient(circle, rgba(124,92,252,.55) 0%, rgba(232,75,214,.35) 70%);
  animation: cmPulse 2.6s ease-out infinite; pointer-events: none;
}
.cm-ring-b { animation-delay: 1.3s; background: radial-gradient(circle, rgba(124,92,252,.5) 0%, rgba(232,75,214,.3) 70%); }
.cm-btn {
  position: relative; width: 78px; height: 78px; border: none; padding: 0; cursor: pointer;
  border-radius: 50%;
  background: linear-gradient(140deg, #8B6CFF 0%, #E84BD6 52%, #FF7A6B 100%);
  box-shadow: 0 14px 30px rgba(124,92,252,.5), inset 0 -6px 14px rgba(120,40,160,.28), inset 0 6px 12px rgba(255,255,255,.4);
  animation: cmWobble 3.4s ease-in-out infinite;
  transition: transform .22s cubic-bezier(.2,.8,.3,1.4), box-shadow .22s ease;
  outline: none;
}
.cm-btn:hover  { transform: translateY(-5px) scale(1.09); box-shadow: 0 22px 40px rgba(124,92,252,.6), inset 0 -6px 14px rgba(120,40,160,.28), inset 0 6px 12px rgba(255,255,255,.45); }
.cm-btn:active { transform: translateY(-1px) scale(.97); }
.cm-antenna { position: absolute; left: 50%; top: -13px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
.cm-bulb { width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #FFF7C7, #FFE66D 60%, #FFC93C); animation: cmAntenna 1.8s ease-in-out infinite; }
.cm-stem { width: 3px; height: 9px; background: linear-gradient(#F0C95A, #C9A33F); border-radius: 2px; }
.cm-face { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: cmBreathe 2.8s ease-in-out infinite; }
.cm-eyes { display: flex; gap: 13px; margin-top: 2px; }
.cm-eye  { width: 19px; height: 21px; border-radius: 50%; background: #fff; box-shadow: inset 0 -2px 3px rgba(120,60,160,.12); display: flex; align-items: center; justify-content: center; animation: cmBlink 4.2s ease-in-out infinite; }
.cm-eye-r { animation-delay: .12s; }
.cm-pupil { position: relative; width: 10px; height: 11px; border-radius: 50%; background: #3A2350; transition: transform .12s ease-out; }
.cm-glint { position: absolute; top: 1.5px; right: 1.5px; width: 4px; height: 4px; border-radius: 50%; background: #fff; }
.cm-blush { position: absolute; top: 41px; width: 11px; height: 7px; border-radius: 50%; background: rgba(255,120,170,.55); filter: blur(.4px); }
.cm-blush-l { left: 13px; } .cm-blush-r { right: 13px; }
.cm-smile { margin-top: 5px; width: 15px; height: 8px; border: 2.6px solid #3A2350; border-top: none; border-radius: 0 0 14px 14px; }
.cm-spark { position: absolute; background: #fff; clip-path: polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%); animation: cmSpark 2.4s ease-in-out infinite; }
.cm-spark-a { top: 9px; right: 11px; width: 7px; height: 7px; }
.cm-spark-b { bottom: 12px; left: 10px; width: 5px; height: 5px; animation-delay: 1.1s; }
@keyframes cmBreathe { 0%,100%{transform:scale(1)}50%{transform:scale(1.055)} }
@keyframes cmWobble  { 0%,100%{transform:rotate(-3.5deg) translateY(0)}25%{transform:rotate(2deg) translateY(-1.5px)}50%{transform:rotate(3.5deg) translateY(0)}75%{transform:rotate(-1.5deg) translateY(-1.5px)} }
@keyframes cmBlink   { 0%,88%,100%{transform:scaleY(1)}92%,96%{transform:scaleY(.08)} }
@keyframes cmAntenna { 0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,230,109,.7)}50%{transform:scale(1.25);box-shadow:0 0 0 5px rgba(255,230,109,0)} }
@keyframes cmPulse   { 0%{transform:translate(-50%,-50%) scale(.92);opacity:.5}100%{transform:translate(-50%,-50%) scale(2.15);opacity:0} }
@keyframes cmSpark   { 0%,100%{transform:scale(.6) rotate(0deg);opacity:0}50%{transform:scale(1) rotate(90deg);opacity:1} }
`;

export default function ChatMascot({ onClick }: { onClick: () => void }) {
  const btnRef   = useRef<HTMLButtonElement>(null);
  const pupilL   = useRef<HTMLDivElement>(null);
  const pupilR   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const btn = btnRef.current;
      if (!btn || !pupilL.current || !pupilR.current) return;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
      const t = `translate(${clamp((e.clientX - cx) / 26, 3.2)}px,${clamp((e.clientY - cy) / 26, 3.2)}px)`;
      pupilL.current.style.transform = t;
      pupilR.current.style.transform = t;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cm-wrap">
        <div className="cm-box">
          <div className="cm-ring" />
          <div className="cm-ring cm-ring-b" />
          <button ref={btnRef} className="cm-btn" onClick={onClick} aria-label="チャットを開く">
            <div className="cm-antenna">
              <div className="cm-bulb" />
              <div className="cm-stem" />
            </div>
            <div className="cm-face">
              <div className="cm-eyes">
                <div className="cm-eye cm-eye-l">
                  <div ref={pupilL} className="cm-pupil"><div className="cm-glint" /></div>
                </div>
                <div className="cm-eye cm-eye-r">
                  <div ref={pupilR} className="cm-pupil"><div className="cm-glint" /></div>
                </div>
              </div>
              <div className="cm-blush cm-blush-l" />
              <div className="cm-blush cm-blush-r" />
              <div className="cm-smile" />
            </div>
            <div className="cm-spark cm-spark-a" />
            <div className="cm-spark cm-spark-b" />
          </button>
        </div>
      </div>
    </>
  );
}
