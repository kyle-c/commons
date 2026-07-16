import { useRef } from "react";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  frames: Rect[];
  pins: { x: number; y: number }[];
  /** Currently visible canvas region, in canvas coordinates. */
  viewRect: Rect;
  /** Center the viewport on this canvas point. */
  onJump: (canvasX: number, canvasY: number) => void;
}

/** Corner overview of the canvas: frame map, open-thread pins, viewport. Click or drag to jump. */
export default function Minimap({ frames, pins, viewRect, onJump }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  if (frames.length === 0) return null;

  const minX = Math.min(...frames.map((f) => f.x));
  const minY = Math.min(...frames.map((f) => f.y));
  const maxX = Math.max(...frames.map((f) => f.x + f.width));
  const maxY = Math.max(...frames.map((f) => f.y + f.height));
  const span = Math.max(maxX - minX, maxY - minY);
  const pad = span * 0.08;
  const vb = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };

  const toCanvas = (clientX: number, clientY: number) => {
    const el = svgRef.current!;
    const rect = el.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": uniform scale, centered.
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const ox = (rect.width - vb.w * scale) / 2;
    const oy = (rect.height - vb.h * scale) / 2;
    return { x: vb.x + (clientX - rect.left - ox) / scale, y: vb.y + (clientY - rect.top - oy) / scale };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const jump = (ev: { clientX: number; clientY: number }) => {
      const p = toCanvas(ev.clientX, ev.clientY);
      onJump(p.x, p.y);
    };
    jump(e);
    const move = (ev: MouseEvent) => jump(ev);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="minimap" onMouseDown={onMouseDown} title="Jump around the canvas">
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet">
        {frames.map((f, i) => (
          <rect
            key={i}
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            rx={span * 0.01}
            fill="var(--bg-panel-raised)"
            stroke="var(--border-strong)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {pins.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={span * 0.016} fill="var(--comment)" />
        ))}
        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.width}
          height={viewRect.height}
          fill="rgba(90, 162, 255, 0.08)"
          stroke="var(--accent)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
