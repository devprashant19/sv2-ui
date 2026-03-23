import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export type MinerPhase = 'idle' | 'arming';
interface Miner3DProps { phase: MinerPhase; }

// ─── Geometry ─────────────────────────────────────────────────────────────────
//
//  Real Antminer S9: 350 × 135 × 158 mm (L × W × H).  Scale = 0.8×.
//
//  CSS 3D face mapping:
//    front / back  →  W × H  = long aluminium vent faces  (280 × 126)
//    left  / right →  D × H  = narrow FAN END faces       (108 × 126)
//    top           →  W × D  = top plate + PSU box        (280 × 108)
//    bottom        →  W × D  = bottom plate               (280 × 108)
//
//  PSU box: ~40% of chassis width, sits on top offset toward back.
//    PSU_W=110  PSU_H=36  PSU_D=52
//    Z_PSU = -(D/2 - PSU_D/2) = -(54 - 26) = -28  (back-aligned)
//
// ──────────────────────────────────────────────────────────────────────────────

const W = 280;
const H = 126;
const D = 108;
const R = 50;

const PSU_W = 110;
const PSU_H = 36;
const PSU_D = 52;
const Z_PSU = -(D / 2 - PSU_D / 2);   // −28 px

const DEF_ROT = { x: -8, y: 90 };

// ─── Fan physics constants ─────────────────────────────────────────────────────
const IDLE_VEL     = 360 / 3000;  // 0.12 deg/ms → 3.0 s/rev at idle
const ACTIVE_VEL   = 360 / 60;   // 6.00 deg/ms → full speed when arming
const CLICK_IMPULSE = 1.5;        // deg/ms added per hub click
const MAX_VEL      = 4.5;         // deg/ms cap  → ~80 ms/rev max boost
const HALF_LIFE    = 350;         // ms — friction half-life back to idle

// ─── Fan blade path ────────────────────────────────────────────────────────────

function bladePath(r: number): string {
  const ri  = r * 0.38;
  const ro  = r * 0.91;
  const rl  = r * 0.06;
  const tl  = r * 0.05;
  const tt  = r * 0.31;
  const c1y = ri + (ro - ri) * 0.54;
  const c2y = ri + (ro - ri) * 0.80;
  return (
    `M ${rl},${-ri} ` +
    `C ${rl},${-c1y}  ${-tl},${-c2y}  ${-tl},${-ro} ` +
    `L ${-tt},${-ro} ` +
    `C ${-tt},${-(c2y - r * 0.08)}  ${-rl},${-c1y + r * 0.05}  ${-rl},${-ri} Z`
  );
}
const BLADE  = bladePath(R);
const ANGLES = [0, 40, 80, 120, 160, 200, 240, 280, 320] as const;

// ─── Fan ──────────────────────────────────────────────────────────────────────
// spinRef → driven by RAF loop in parent (no CSS animation)
// hubRef  → pulsed directly via DOM on click

function Fan({ cx, cy, active, off, spinRef, hubRef }: {
  cx: number; cy: number; active: boolean; off: boolean;
  spinRef: React.RefObject<SVGGElement>;
  hubRef:  React.RefObject<SVGCircleElement>;
}) {
  const C      = 'hsl(var(--primary))';
  const fillOp = active ? '0.32' : off ? '0.04' : '0.10';
  return (
    <>
      <circle cx={cx} cy={cy} r={R}        strokeWidth={1.0} />
      <circle cx={cx} cy={cy} r={R * 0.95} strokeWidth={0.4} strokeOpacity={0.32} />
      <g transform={`translate(${cx},${cy})`}>
        {/* RAF sets style.transform on this element directly — no CSS animation */}
        <g ref={spinRef} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          {ANGLES.map(a => (
            <path key={a} transform={`rotate(${a})`} d={BLADE}
              fill={`hsl(var(--primary) / ${fillOp})`} stroke={C} strokeWidth={0.4} />
          ))}
        </g>
      </g>
      {/* hubRef: outer hub ring — pulsed on click via DOM */}
      <circle ref={hubRef} cx={cx} cy={cy} r={R * 0.36} strokeWidth={0.9}
        fill={`hsl(var(--primary) / 0.22)`} stroke={C} />
      <circle cx={cx} cy={cy} r={R * 0.26} strokeWidth={0.6}
        fill={`hsl(var(--primary) / 0.14)`} stroke={C} />
      <circle cx={cx} cy={cy} r={R * 0.10} strokeWidth={0.7}
        fill={`hsl(var(--primary) / 0.45)`} stroke={C} />
      <circle cx={cx} cy={cy} r={R * 0.04}
        fill={`hsl(var(--primary) / 0.90)`} stroke="none" />
    </>
  );
}

// ─── VentGrid ─────────────────────────────────────────────────────────────────

function VentGrid({ w, h, sp }: { w: number; h: number; sp: React.SVGProps<SVGSVGElement> }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} {...sp}>
      {Array.from({ length: 12 }, (_, i) => {
        const y = ((i + 1) * h) / 13;
        return <line key={i} x1={10} y1={y} x2={w - 10} y2={y}
          strokeWidth={0.65} strokeOpacity={0.50} />;
      })}
    </svg>
  );
}

// ─── Miner3D ──────────────────────────────────────────────────────────────────

export function Miner3D({ phase }: Miner3DProps) {
  const [rot, setRot]       = useState(DEF_ROT);
  const [dragging, setDrag] = useState(false);
  const [powered, setPowered] = useState(true);

  const drag = useRef<{ px: number; py: number; rx: number; ry: number } | null>(null);

  // ── Fan physics (all refs — zero React re-renders during spin) ───────────────
  const angleRef    = useRef(0);
  const velRef      = useRef(IDLE_VEL);
  const targetRef   = useRef(IDLE_VEL);
  const lastTimeRef = useRef<number | null>(null);
  const rafRef      = useRef<number | null>(null);

  // Left and right fan faces each get their own spin + hub refs
  const spinRefL = useRef<SVGGElement>(null);
  const spinRefR = useRef<SVGGElement>(null);
  const hubRefL  = useRef<SVGCircleElement>(null);
  const hubRefR  = useRef<SVGCircleElement>(null);

  const isOff    = !powered;
  const isActive = powered && phase === 'arming';

  // Border flash: briefly spike opacity on activation for electrical surge feel
  const [borderFlash, setBorderFlash] = useState(false);
  useEffect(() => {
    if (!isActive) { setBorderFlash(false); return; }
    setBorderFlash(true);
    const t = setTimeout(() => setBorderFlash(false), 140);
    return () => clearTimeout(t);
  }, [isActive]);

  // Sync target velocity when power or arming state changes
  useEffect(() => {
    if (isOff) {
      targetRef.current = 0;           // coast to full stop
    } else if (isActive) {
      velRef.current    = MAX_VEL * 1.8;  // overshoot: turbine rev spike
      targetRef.current = ACTIVE_VEL;    // friction decays back to cruise
    } else {
      targetRef.current = IDLE_VEL;   // friction coasts back to idle
    }
  }, [isActive, isOff]);

  // RAF loop — started once, reads only refs (never stale, zero re-renders)
  useEffect(() => {
    const frame = (now: number) => {
      const dt = lastTimeRef.current !== null
        ? Math.min(now - lastTimeRef.current, 100)  // cap: handles tab wake-up
        : 0;
      lastTimeRef.current = now;

      // Exponential friction toward target velocity
      const decay = Math.pow(0.5, dt / HALF_LIFE);
      velRef.current = targetRef.current + (velRef.current - targetRef.current) * decay;

      // Advance angle continuously — no modulo reset means no position jump
      angleRef.current = (angleRef.current + velRef.current * dt) % 360;
      const t = `rotate(${angleRef.current.toFixed(2)}deg)`;

      // Motion blur scales with velocity: hides stroboscopic aliasing at high speed
      // (9 blades × 40° spacing → aliasing threshold ≈ 1.2 deg/ms at 60 fps)
      const blurPx = Math.max(0, (velRef.current - 0.40) * 2).toFixed(1);
      const f = blurPx !== '0.0' ? `blur(${blurPx}px)` : '';

      if (spinRefL.current) { spinRefL.current.style.transform = t; spinRefL.current.style.filter = f; }
      if (spinRefR.current) { spinRefR.current.style.transform = t; spinRefR.current.style.filter = f; }

      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // ── Drag-to-rotate ──────────────────────────────────────────────────────────
  const onPD = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, rx: rot.x, ry: rot.y };
    setDrag(true);
  };
  const onPM = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setRot({
      x: Math.max(-60, Math.min(10, drag.current.rx - (e.clientY - drag.current.py) * 0.35)),
      y: drag.current.ry + (e.clientX - drag.current.px) * 0.4,
    });
  };
  const onPU = () => { drag.current = null; setDrag(false); };

  // ── Hub click — pure ref mutation, no setState ───────────────────────────────
  const handleFanClick = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isActive || isOff) return;

    // Each click stacks velocity; friction will decay it back to idle
    velRef.current = Math.min(velRef.current + CLICK_IMPULSE, MAX_VEL);

    // Hub ring pulse — direct DOM manipulation, no React state involved
    [hubRefL.current, hubRefR.current].forEach(hub => {
      if (!hub) return;
      hub.style.transition = 'none';
      hub.style.fill = 'hsl(var(--primary) / 0.80)';
      requestAnimationFrame(() => {
        if (!hub) return;
        hub.style.transition = 'fill 0.4s ease';
        hub.style.fill = '';
      });
    });
  };

  // ── Style helpers ───────────────────────────────────────────────────────────
  const C   = 'hsl(var(--primary))';
  const bOp = borderFlash ? '1.0' : isActive ? '0.88' : isOff ? '0.18' : '0.55';

  const glow = isActive
    ? '0 0 20px hsl(var(--primary) / 0.80), 0 0 48px hsl(var(--primary) / 0.25)'
    : isOff ? 'none'
    : '0 0 4px hsl(var(--primary) / 0.15)';

  const face = (w: number, h: number, ml: number, mt: number, t: string, r = 6): CSSProperties => ({
    position:           'absolute',
    top:                '50%',
    left:               '50%',
    width:              w,
    height:             h,
    marginLeft:         ml,
    marginTop:          mt,
    boxSizing:          'border-box',
    border:             `1px solid hsl(var(--primary) / ${bOp})`,
    borderRadius:       r,
    background:         'hsl(var(--primary) / 0.018)',
    backfaceVisibility: 'hidden',
    boxShadow:          glow,
    transition:         isActive ? 'box-shadow 0.15s ease-out, border-color 0.1s ease-out' : 'box-shadow 0.5s ease, border-color 0.3s ease',
    transform:          t,
  });

  const sp: React.SVGProps<SVGSVGElement> = {
    fill:           'none',
    stroke:         C,
    shapeRendering: 'geometricPrecision',
    style:          { display: 'block' },
    'aria-hidden':  true,
  };

  const FC = D / 2;
  const FY = H / 2;

  const psuFace = (w: number, h: number, ml: number, mt: number, t: string, r = 3): CSSProperties => ({
    position:           'absolute',
    top:                '50%',
    left:               '50%',
    width:              w,
    height:             h,
    marginLeft:         ml,
    marginTop:          mt,
    boxSizing:          'border-box',
    border:             `1px solid hsl(var(--primary) / ${bOp})`,
    borderRadius:       r,
    background:         'hsl(var(--primary) / 0.025)',
    backfaceVisibility: 'hidden',
    boxShadow:          glow,
    transition:         isActive ? 'box-shadow 0.15s ease-out, border-color 0.1s ease-out' : 'box-shadow 0.5s ease, border-color 0.3s ease',
    transform:          t,
  });

  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          '100%',
        maxWidth:       440,
        height:         280,
        flexShrink:     0,
        cursor:         dragging ? 'grabbing' : 'grab',
        userSelect:     'none',
        touchAction:    'none',
        position:       'relative',
      }}
      onPointerDown={onPD}
      onPointerMove={onPM}
      onPointerUp={onPU}
      onPointerCancel={onPU}
      onDoubleClick={() => setRot(DEF_ROT)}
    >
      {/* Glow bloom — sibling to 3D scene so filter never flattens preserve-3d */}
      <div
        aria-hidden
        style={{
          position:      'absolute',
          inset:         '-15%',
          borderRadius:  '50%',
          background:    'radial-gradient(ellipse at center, hsl(var(--primary) / 0.55) 0%, transparent 65%)',
          filter:        'blur(28px)',
          animation:     isActive ? 'miner-glow-bloom 0.55s ease-out forwards' : 'none',
          opacity:       isActive ? undefined : 0,
          pointerEvents: 'none',
        }}
      />

      {/* Vibration wrapper — 5 quick shakes (~450 ms) then stops naturally */}
      <div style={{ animation: isActive ? 'miner-vibrate 0.09s linear 5' : 'none' }}>
      <div style={{ perspective: '1100px' }}>
        <div style={{
          width:          W,
          height:         H,
          position:       'relative',
          transformStyle: 'preserve-3d',
          transform:      `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
          transition:     dragging ? 'none' : 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
        } as CSSProperties}>

          {/* ════════════════════ CHASSIS FACES ════════════════════════════ */}

          {/* Front  (W×H)  — long vent face */}
          <div style={face(W, H, -W / 2, -H / 2, `translateZ(${D / 2}px)`)}>
            <VentGrid w={W} h={H} sp={sp} />
          </div>

          {/* Back  (W×H)  — long vent face */}
          <div style={face(W, H, -W / 2, -H / 2, `rotateY(180deg) translateZ(${D / 2}px)`)}>
            <VentGrid w={W} h={H} sp={sp} />
          </div>

          {/* Left  (D×H)  — FAN END */}
          <div style={face(D, H, -D / 2, -H / 2, `rotateY(-90deg) translateZ(${W / 2}px)`)}>
            <svg viewBox={`0 0 ${D} ${H}`} width={D} height={H} {...sp}>
              <Fan cx={FC} cy={FY} active={isActive} off={isOff} spinRef={spinRefL} hubRef={hubRefL} />
              {([[ 8, 8 ], [ D-8, 8 ], [ 8, H-8 ], [ D-8, H-8 ]] as const).map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={2.8}
                  strokeWidth={0.55} strokeOpacity={0.45}
                  fill={`hsl(var(--primary) / 0.06)`} />
              ))}
              {/* Hit target = hub only (r stops at blade inner radius) */}
              <circle cx={FC} cy={FY} r={R * 0.38}
                fill="transparent" stroke="none"
                style={{ cursor: 'pointer' }}
                onPointerDown={handleFanClick} />
            </svg>
          </div>

          {/* Right  (D×H)  — FAN END — faces viewer at DEF_ROT y=90 */}
          <div style={face(D, H, -D / 2, -H / 2, `rotateY(90deg) translateZ(${W / 2}px)`)}>
            <svg viewBox={`0 0 ${D} ${H}`} width={D} height={H} {...sp}>
              <Fan cx={FC} cy={FY} active={isActive} off={isOff} spinRef={spinRefR} hubRef={hubRefR} />
              {([[ 8, 8 ], [ D-8, 8 ], [ 8, H-8 ], [ D-8, H-8 ]] as const).map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={2.8}
                  strokeWidth={0.55} strokeOpacity={0.45}
                  fill={`hsl(var(--primary) / 0.06)`} />
              ))}
              {/* Hit target = hub only */}
              <circle cx={FC} cy={FY} r={R * 0.38}
                fill="transparent" stroke="none"
                style={{ cursor: 'pointer' }}
                onPointerDown={handleFanClick} />
            </svg>
          </div>

          {/* Top  (W×D) */}
          <div style={face(W, D, -W / 2, -D / 2, `rotateX(-90deg) translateZ(${H / 2}px)`)} />

          {/* Bottom  (W×D) */}
          <div style={face(W, D, -W / 2, -D / 2, `rotateX(90deg) translateZ(${H / 2}px)`)} />

          {/* ════════════════════ PSU BOX ══════════════════════════════════ */}
          <div style={{
            position:       'absolute',
            top:            '50%',
            left:           '50%',
            width:          PSU_W,
            height:         PSU_H,
            marginLeft:     -PSU_W / 2,
            marginTop:      -(H / 2 + PSU_H),
            transformStyle: 'preserve-3d',
            transform:      `translateZ(${Z_PSU}px)`,
          }}>

            {/* PSU front face  (110 × 36) */}
            <div style={psuFace(PSU_W, PSU_H, -PSU_W / 2, -PSU_H / 2, `translateZ(${PSU_D / 2}px)`)}>
              <svg viewBox={`0 0 ${PSU_W} ${PSU_H}`} width={PSU_W} height={PSU_H} {...sp}>
                <rect x={6} y={6} width={52} height={24}
                  fill={`hsl(var(--primary) / 0.06)`} stroke={C}
                  strokeWidth={0.5} strokeOpacity={0.5} rx={1.5} />
                <line x1={10} y1={14} x2={54} y2={14} strokeWidth={0.35} strokeOpacity={0.4} />
                <line x1={10} y1={20} x2={54} y2={20} strokeWidth={0.3}  strokeOpacity={0.3} />
                <rect x={68} y={8} width={18} height={10}
                  fill={`hsl(var(--primary) / 0.08)`} stroke={C}
                  strokeWidth={0.45} strokeOpacity={0.6} rx={1} />
                {/* Power button — clickable ring + center dot */}
                <circle
                  cx={95} cy={13} r={6}
                  stroke={C} strokeWidth={1.2}
                  strokeOpacity={powered ? 0.80 : 0.28}
                  fill={powered ? `hsl(var(--primary) / 0.28)` : 'transparent'}
                  style={{
                    cursor: 'pointer',
                    filter: powered ? `drop-shadow(0 0 4px hsl(var(--primary) / 0.55))` : 'none',
                    transition: 'fill 0.35s ease, filter 0.35s ease, stroke-opacity 0.35s ease',
                  }}
                  onPointerDown={e => { e.stopPropagation(); setPowered(p => !p); }}
                />
                <circle cx={95} cy={13} r={1.8}
                  fill={powered ? C : `hsl(var(--primary) / 0.25)`}
                  stroke="none"
                  style={{ pointerEvents: 'none', transition: 'fill 0.35s ease' }}
                />
              </svg>
            </div>

            {/* PSU back face */}
            <div style={psuFace(PSU_W, PSU_H, -PSU_W / 2, -PSU_H / 2,
              `rotateY(180deg) translateZ(${PSU_D / 2}px)`)} />

            {/* PSU right face  (52 × 36) */}
            <div style={psuFace(PSU_D, PSU_H, -PSU_D / 2, -PSU_H / 2,
              `rotateY(90deg) translateZ(${PSU_W / 2}px)`)}>
              <svg viewBox={`0 0 ${PSU_D} ${PSU_H}`} width={PSU_D} height={PSU_H} {...sp}>
                {[9, 21].map(y => (
                  <rect key={y} x={8} y={y} width={36} height={8}
                    fill={`hsl(var(--primary) / 0.06)`} stroke={C}
                    strokeWidth={0.4} strokeOpacity={0.5} rx={1} />
                ))}
              </svg>
            </div>

            {/* PSU left face  (52 × 36) */}
            <div style={psuFace(PSU_D, PSU_H, -PSU_D / 2, -PSU_H / 2,
              `rotateY(-90deg) translateZ(${PSU_W / 2}px)`)} />

            {/* PSU top face  (110 × 52) */}
            <div style={psuFace(PSU_W, PSU_D, -PSU_W / 2, -PSU_D / 2,
              `rotateX(-90deg) translateZ(${PSU_H / 2}px)`)}>
              <svg viewBox={`0 0 ${PSU_W} ${PSU_D}`} width={PSU_W} height={PSU_D} {...sp}>
                {Array.from({ length: 4 }, (_, i) => {
                  const y = ((i + 1) * PSU_D) / 5;
                  return <line key={i} x1={8} y1={y} x2={PSU_W - 8} y2={y}
                    strokeWidth={0.4} strokeOpacity={0.35} />;
                })}
              </svg>
            </div>

            {/* PSU bottom — hidden */}
            <div style={{ ...psuFace(PSU_W, PSU_D, -PSU_W / 2, -PSU_D / 2,
              `rotateX(90deg) translateZ(${PSU_H / 2}px)`), opacity: 0 }} />

          </div>{/* end PSU wrapper */}

        </div>
      </div>
      </div>{/* end vibration wrapper */}
    </div>
  );
}
