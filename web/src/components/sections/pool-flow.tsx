"use client";

import { useEffect, useRef } from "react";

type Pt = { x: number; y: number };
type Agent = {
  i: number;
  x: number;
  y: number;
  s: number;
  lim: number;
  lvl: number;
  flash: number;
  cd: number;
  name: string;
  parent: number | null;
};
type Particle = {
  k: "draw" | "pay" | "rej";
  a: Pt;
  b: Pt;
  t: number;
  sp: number;
  tgt: Agent;
  child?: boolean;
};
type Float = { x: number; y: number; life: number; txt: string };

const NAMES = ["monitor", "scout", "signals", "rpc-buyer"];
const LIM = [1, 0.55, 0.8, 0.65];
const MARK = [
  [
    [0, 183],
    [401, 0],
    [401, 153],
    [0, 336],
  ],
  [
    [62, 350],
    [330, 229],
    [330, 505],
  ],
];

export function PoolFlow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const hero = cv?.closest(".hero");
    if (!cv || !(hero instanceof HTMLElement)) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let pool = { x: 0, y: 0, r: 40 };
    let agents: Agent[] = [];
    let parts: Particle[] = [];
    let floats: Float[] = [];
    let running = true;
    let last = performance.now();
    let rejT = 1.6;
    let raf = 0;

    const font = () => {
      const stack = getComputedStyle(document.documentElement).getPropertyValue("--f-mono").trim();
      return stack || "ui-monospace, monospace";
    };

    const curve = (a: Pt, b: Pt) => {
      const mx = (a.x + b.x) / 2;
      return { c1: { x: mx, y: a.y }, c2: { x: mx, y: b.y } };
    };
    const bez = (a: Pt, c1: Pt, c2: Pt, b: Pt, t: number) => {
      const u = 1 - t;
      return {
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      };
    };
    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    };

    const layout = () => {
      const rect = hero.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.max(1, W * dpr);
      cv.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const space = document.getElementById("canvasSpace");
      const proof = hero.querySelector(".proof");
      let g: { x: number; y: number; w: number; h: number };
      if (W < 601 && space) {
        const s = space.getBoundingClientRect();
        g = { x: 0, y: s.top - rect.top, w: W, h: s.height };
      } else {
        const pt = proof instanceof HTMLElement ? proof.getBoundingClientRect().top - rect.top : H * 0.72;
        const x0 = Math.max(W * 0.52, (W - 1200) / 2 + 24 + 600);
        g = { x: x0, y: 96, w: W - x0 - 16, h: pt - 120 };
      }
      const s = Math.max(30, Math.min(54, g.h * 0.12));
      pool = { x: g.x + g.w * 0.2, y: g.y + g.h * 0.5, r: Math.min(g.h * 0.2, g.w * 0.17, 90) };
      const ax = g.x + g.w * 0.78;
      const ys = [0.13, 0.37, 0.63, 0.87];
      const prev = agents;
      agents = ys.map((f, i) => ({
        i,
        x: ax + (i === 1 ? s * 0.55 : 0),
        y: g.y + g.h * f,
        s: i === 1 ? s * 0.8 : s,
        lim: LIM[i],
        lvl: prev[i] ? prev[i].lvl : LIM[i] * 0.4,
        flash: 0,
        cd: Math.random() * 2,
        name: NAMES[i],
        parent: i === 1 ? 0 : null,
      }));
      if (W < 601) {
        pool.x = g.x + g.w * 0.25;
        agents.forEach((a) => {
          a.x = g.x + g.w * 0.6 + (a.i === 1 ? s * 0.4 : 0);
        });
      }
      const label = hero.querySelector<HTMLElement>(".canvas-label");
      if (label) {
        if (W < 601) {
          label.style.top = `${g.y + g.h - 6}px`;
          label.style.right = "18px";
        } else {
          label.style.top = "";
          label.style.right = "";
        }
      }
    };

    const drawMark = (cx: number, cy: number, size: number, alpha: number) => {
      const sc = size / 505;
      ctx.save();
      ctx.translate(cx - 200 * sc, cy - 252 * sc);
      ctx.scale(sc, sc);
      ctx.fillStyle = `rgba(61,116,255,${alpha})`;
      MARK.forEach((poly) => {
        ctx.beginPath();
        poly.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    };

    const spawn = (dt: number) => {
      agents.forEach((a) => {
        a.cd -= dt;
        if (a.cd > 0) return;
        a.cd = 0.35 + Math.random() * 0.5;
        if (a.lvl < a.lim - 0.05 && Math.random() < 0.7) {
          const from = a.parent != null ? agents[a.parent] : pool;
          parts.push({
            k: "draw",
            a: { x: from.x + (from === pool ? pool.r * 0.6 : 0), y: from.y },
            b: { x: a.x - a.s / 2 - 10, y: a.y },
            t: 0,
            sp: 0.55 + Math.random() * 0.3,
            tgt: a,
            child: a.parent != null,
          });
        } else if (a.lvl > 0.12) {
          parts.push({
            k: "pay",
            a: { x: a.x + a.s / 2 + 10, y: a.y },
            b: { x: a.x + a.s / 2 + 90, y: a.y + (Math.random() - 0.5) * 30 },
            t: 0,
            sp: 0.9,
            tgt: a,
          });
          a.lvl -= 0.07;
        }
      });
      rejT -= dt;
      if (rejT <= 0) {
        rejT = 2.6 + Math.random() * 1.8;
        const a = agents[Math.floor(Math.random() * agents.length)];
        parts.push({
          k: "rej",
          a: { x: a.x, y: a.y },
          b: { x: a.x + a.s * 0.6 + 14, y: a.y - a.s * 0.6 - 14 },
          t: 0,
          sp: 1.3,
          tgt: a,
        });
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) spawn(dt);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `500 10px ${font()}`;
      agents.forEach((a) => {
        const parent = a.parent != null ? agents[a.parent] : null;
        const A = parent
          ? { x: parent.x, y: parent.y + parent.s / 2 }
          : { x: pool.x + pool.r * 0.6, y: pool.y };
        const B = { x: a.x - a.s / 2 - 10, y: a.y };
        ctx.beginPath();
        if (a.parent != null) {
          ctx.setLineDash([3, 4]);
          ctx.moveTo(A.x, A.y + 8);
          ctx.lineTo(A.x, B.y);
          ctx.lineTo(B.x, B.y);
          ctx.strokeStyle = "rgba(157,181,255,.35)";
        } else {
          const c = curve(A, B);
          ctx.moveTo(A.x, A.y);
          ctx.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, B.x, B.y);
          ctx.strokeStyle = "rgba(61,116,255,.22)";
        }
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      const g = ctx.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, pool.r * 2.2);
      g.addColorStop(0, "rgba(1,76,254,.30)");
      g.addColorStop(1, "rgba(1,76,254,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r * 2.2, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r, 0, 7);
      ctx.fillStyle = "rgba(11,20,48,.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const tops = agents.filter((a) => a.parent == null);
      const tot = 3.2;
      let ang = -Math.PI / 2;
      tops.forEach((a, j) => {
        const span = (a.lim / tot) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(pool.x, pool.y, pool.r + 7, ang + 0.04, ang + span - 0.04);
        ctx.strokeStyle = ["#3D74FF", "#6E95FF", "#AFC3FF"][j];
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.stroke();
        ang += span;
      });
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r + 7, ang + 0.04, -Math.PI / 2 + Math.PI * 2 - 0.04);
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      drawMark(pool.x, pool.y, pool.r * 1.05, 0.95);
      ctx.fillStyle = "#8F98A6";
      ctx.textAlign = "center";
      ctx.fillText("POOL · Σ LIMITS ≤ LOCKED", pool.x, pool.y + pool.r + 28);
      const parent = agents[0];
      const child = agents[1];
      if (parent && child) {
        const bx = parent.x - parent.s / 2 - 16;
        const by = parent.y - parent.s / 2 - 14;
        const bw = Math.max(parent.x + parent.s / 2, child.x + child.s / 2) - bx + 16;
        const bh = child.y + child.s / 2 + 22 - by;
        rr(bx, by, bw, bh, 14);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "rgba(61,116,255,.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      agents.forEach((a) => {
        const x = a.x - a.s / 2;
        const y = a.y - a.s / 2;
        if (a.parent == null && a.i !== 0) {
          rr(x - 9, y - 9, a.s + 18, a.s + 18, 12);
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = "rgba(61,116,255,.35)";
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (a.flash > 0) {
          rr(x - 9, y - 9, a.s + 18, a.s + 18, 12);
          ctx.strokeStyle = `rgba(255,92,92,${a.flash})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
          a.flash = Math.max(0, a.flash - dt * 1.4);
        }
        rr(x, y, a.s, a.s, 9);
        ctx.fillStyle = "#121620";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.14)";
        ctx.stroke();
        const inner = a.s - 12;
        const lh = inner * Math.max(0, Math.min(1, a.lvl / 1));
        ctx.fillStyle = "rgba(255,255,255,.05)";
        rr(x + 6, y + 6, inner, inner, 5);
        ctx.fill();
        ctx.save();
        rr(x + 6, y + 6, inner, inner, 5);
        ctx.clip();
        ctx.fillStyle = a.parent != null ? "rgba(157,181,255,.75)" : "rgba(61,116,255,.85)";
        ctx.fillRect(x + 6, y + 6 + inner - lh, inner, lh);
        ctx.restore();
        const ly = y + 6 + inner - inner * a.lim;
        ctx.beginPath();
        ctx.moveTo(x + 3, ly);
        ctx.lineTo(x + a.s - 3, ly);
        ctx.strokeStyle = "#ECEFF4";
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#9AA3B2";
        ctx.textAlign = "left";
        ctx.fillText(a.name + (a.parent != null ? " · child" : ""), x + a.s + 14, a.y - 2);
        ctx.fillStyle = "#5F6876";
        ctx.fillText("limit " + (a.lim * 0.5).toFixed(2), x + a.s + 14, a.y + 11);
      });
      parts = parts.filter((pt) => {
        pt.t += dt * pt.sp;
        if (pt.k === "draw") {
          const cc = pt.child
            ? { c1: { x: pt.a.x, y: pt.b.y }, c2: { x: pt.a.x, y: pt.b.y } }
            : curve(pt.a, pt.b);
          const q = bez(pt.a, cc.c1, cc.c2, pt.b, Math.min(1, pt.t));
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.4, 0, 7);
          ctx.fillStyle = pt.child ? "#C9D7FF" : "#6E95FF";
          ctx.shadowColor = "#3D74FF";
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
          if (pt.t >= 1) {
            pt.tgt.lvl = Math.min(pt.tgt.lim, pt.tgt.lvl + 0.07);
            return false;
          }
        } else if (pt.k === "pay") {
          const q = {
            x: pt.a.x + (pt.b.x - pt.a.x) * pt.t,
            y: pt.a.y + (pt.b.y - pt.a.y) * pt.t,
          };
          ctx.globalAlpha = 1 - pt.t;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.2, 0, 7);
          ctx.fillStyle = "#2FD38A";
          ctx.fill();
          ctx.globalAlpha = 1;
          if (pt.t >= 1) return false;
        } else {
          const t = Math.min(1, pt.t);
          const q = { x: pt.a.x + (pt.b.x - pt.a.x) * t, y: pt.a.y + (pt.b.y - pt.a.y) * t };
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2.6, 0, 7);
          ctx.fillStyle = "#FF5C5C";
          ctx.shadowColor = "#FF5C5C";
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
          if (pt.t >= 1) {
            pt.tgt.flash = 1;
            floats.push({ x: q.x + 6, y: q.y, life: 1.2, txt: "✕ rejected" });
            return false;
          }
        }
        return true;
      });
      floats = floats.filter((f) => {
        f.life -= dt * 0.8;
        f.y -= dt * 14;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
        ctx.fillStyle = "#FF7A7A";
        ctx.textAlign = "left";
        ctx.fillText(f.txt, f.x, f.y);
        ctx.globalAlpha = 1;
        return f.life > 0;
      });
      if (running && !reduce) raf = requestAnimationFrame(frame);
    };

    layout();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        layout();
        if (reduce) frame(performance.now());
      }, 120);
    };
    window.addEventListener("resize", onResize);
    const io = new IntersectionObserver(([entry]) => {
      const was = running;
      running = Boolean(entry?.isIntersecting);
      if (running && !was && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(hero);
    if (reduce) {
      window.setTimeout(() => {
        layout();
        frame(performance.now());
      }, 300);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      io.disconnect();
    };
  }, []);

  return <canvas id="flow" ref={ref} aria-hidden />;
}
