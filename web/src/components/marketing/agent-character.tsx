"use client";

import { useEffect, useRef } from "react";

const SPRITE_SRC = "/media/kovan-agent-wave.png";
const CELL = 256;
const COLUMNS = 6;
const DRAW_SIZE = 240;
const DRAW_INSET = (CELL - DRAW_SIZE) / 2;
const REST_FRAME = 0;
const REST_DURATION = 7_200;
const FLOAT_DURATION = 4_400;

// A quiet rest, one wave and blink, then a smooth arm return.
// The final rest is the same cell as the first, so the loop has no pose jump.
const sequence = [
  { frame: REST_FRAME, duration: REST_DURATION },
  { frame: 1, duration: 90 },
  { frame: 2, duration: 85 }, { frame: 3, duration: 85 },
  { frame: 4, duration: 85 }, { frame: 5, duration: 85 },
  { frame: 6, duration: 85 }, { frame: 7, duration: 85 },
  { frame: 8, duration: 90 }, { frame: 9, duration: 90 },
  { frame: 10, duration: 55 }, { frame: 11, duration: 50 },
  { frame: 12, duration: 70 }, { frame: 13, duration: 80 },
  { frame: 14, duration: 85 }, { frame: 15, duration: 85 },
  { frame: 16, duration: 90 }, { frame: 17, duration: 90 },
  { frame: 19, duration: 85 }, { frame: 20, duration: 85 },
  { frame: 18, duration: 90 }, { frame: 21, duration: 90 },
  { frame: 22, duration: 100 }, { frame: 23, duration: 220 },
  { frame: REST_FRAME, duration: 100 },
] as const;

// Keep the head/torso registered to one point instead of centering each pose
// by its changing silhouette. Padding leaves room for both extended arms.
const xOffset = [
  0, 0, 2, 4, 6, 7,
  0, 1, 2, 4, 5, 6,
  0, 1, 3, 4, 5, 6,
  0, 1, 2, 4, 5, 7,
] as const;
const yOffset = [
  0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2, 2,
] as const;

let imagePromise: Promise<HTMLImageElement> | undefined;

function loadImage() {
  imagePromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      try {
        await image.decode();
        resolve(image);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("Could not load the agent character sprite"));
    image.src = SPRITE_SRC;
  });
  return imagePromise;
}

function drawFrame(context: CanvasRenderingContext2D, image: HTMLImageElement, frame: number) {
  const column = frame % COLUMNS;
  const row = Math.floor(frame / COLUMNS);
  context.drawImage(
    image,
    column * CELL, row * CELL, CELL, CELL,
    DRAW_INSET + xOffset[frame], DRAW_INSET + yOffset[frame], DRAW_SIZE, DRAW_SIZE,
  );
}

/** A separate, visibility-aware clock; it never touches the product film timeline. */
export function AgentCharacter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let disposed = false;
    let sprite: HTMLImageElement | null = null;
    let current = 0;
    let remaining: number = sequence[0].duration;
    let deadline = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let inView = false;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const float = canvas.animate([
      { transform: "translate3d(0, 0, 0)" },
      { transform: "translate3d(0, -4px, 0)" },
      { transform: "translate3d(0, 0, 0)" },
    ], { duration: FLOAT_DURATION, iterations: Infinity, easing: "ease-in-out" });
    float.pause();

    const mayAnimate = () => Boolean(sprite) && inView && document.visibilityState === "visible"
      && !motionQuery.matches && document.documentElement.dataset.motion !== "paused";

    const paint = () => {
      if (!sprite) return;
      context.setTransform(canvas.width / CELL, 0, 0, canvas.height / CELL, 0, 0);
      context.clearRect(0, 0, CELL, CELL);
      drawFrame(context, sprite, sequence[current].frame);
      canvas.dataset.spriteFrame = String(sequence[current].frame);
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      paint();
    };

    const stop = () => {
      if (timeout === undefined) return;
      clearTimeout(timeout);
      timeout = undefined;
      remaining = Math.max(0, deadline - performance.now());
    };

    const sync = () => {
      if (motionQuery.matches) {
        stop();
        float.pause();
        float.currentTime = 0;
        current = 0;
        remaining = sequence[0].duration;
        paint();
        return;
      }
      if (!mayAnimate()) {
        stop();
        float.pause();
        return;
      }
      if (sequence[current].frame === REST_FRAME || sequence[current].frame === 23) {
        if (float.playState !== "running") float.play();
      } else if (float.playState === "running") {
        float.pause();
      }
      if (timeout !== undefined) return;
      deadline = performance.now() + remaining;
      timeout = setTimeout(() => {
        timeout = undefined;
        current = (current + 1) % sequence.length;
        remaining = sequence[current].duration;
        paint();
        sync();
      }, remaining);
    };

    const replay = () => {
      stop();
      float.pause();
      float.currentTime = 0;
      current = 0;
      remaining = sequence[0].duration;
      paint();
      sync();
    };

    const bounds = canvas.getBoundingClientRect();
    inView = bounds.bottom > 0 && bounds.top < window.innerHeight;
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: 0.05 });
    intersection.observe(canvas);
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const motionObserver = new MutationObserver(sync);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    const film = canvas.closest(".kf-film");
    film?.addEventListener("kovan-character-replay", replay);
    motionQuery.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", resize);

    loadImage().then((image) => {
      if (disposed) return;
      sprite = image;
      resize();
      sync();
    }).catch(() => {
      // The identity label remains visible if the static image cannot load.
    });

    return () => {
      disposed = true;
      stop();
      float.cancel();
      intersection.disconnect();
      sizeObserver.disconnect();
      motionObserver.disconnect();
      film?.removeEventListener("kovan-character-replay", replay);
      motionQuery.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
      delete canvas.dataset.spriteFrame;
    };
  }, []);

  return <canvas ref={canvasRef} className="kf-agent-canvas" aria-hidden="true" />;
}
