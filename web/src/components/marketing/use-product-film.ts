"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import gsap from "gsap";

const FILM_DURATION = 24;
const ACT_DURATION = 6;
const SETTLED_OFFSET = 4.75;
const MOTION_EVENT = "kovan-motion";

function subscribeMotionPreference(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  window.addEventListener(MOTION_EVENT, notify);
  return () => {
    observer.disconnect();
    window.removeEventListener(MOTION_EVENT, notify);
  };
}

function motionPaused() {
  return document.documentElement.dataset.motion === "paused";
}

function subscribeReducedMotion(notify: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const serverPaused = () => false;
const serverReducedMotion = () => true;
const clampPhase = (phase: number) => Number.isFinite(phase) ? Math.max(0, Math.min(3, Math.round(phase))) : 0;

type PlaybackState = {
  inView: boolean;
  documentVisible: boolean;
  userPaused: boolean;
  reduced: boolean;
  controlled: boolean;
  seeking: boolean;
};

/**
 * A scoped, reversible four-act film. The containing component owns the
 * artboard scale; only the camera, account node and scene contents move here.
 */
export function useProductFilm(root: RefObject<HTMLElement | null>, options: { activeStep?: number } = {}) {
  const { activeStep } = options;
  const controlled = activeStep !== undefined;
  const paused = useSyncExternalStore(subscribeMotionPreference, motionPaused, serverPaused);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverReducedMotion);
  const [frame, setFrame] = useState({ phase: 0, progress: 0 });
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const navigation = useRef<gsap.core.Timeline | null>(null);
  const cameraElement = useRef<HTMLElement | null>(null);
  const publish = useRef<((force?: boolean) => void) | null>(null);
  const activeStepRef = useRef(activeStep);
  const playback = useRef<PlaybackState>({
    inView: false,
    documentVisible: false,
    userPaused: false,
    reduced: true,
    controlled,
    seeking: false,
  });

  const syncPlayback = useCallback(() => {
    const state = playback.current;
    const canMove = state.inView && state.documentVisible && !state.userPaused && !state.reduced;
    if (state.seeking && navigation.current) {
      timeline.current?.pause();
      if (canMove) navigation.current.play();
      else navigation.current.pause();
      return;
    }
    if (canMove && !state.controlled) timeline.current?.play();
    else timeline.current?.pause();
  }, []);

  useLayoutEffect(() => {
    activeStepRef.current = activeStep;
    playback.current.controlled = controlled;
    playback.current.userPaused = paused;
    playback.current.reduced = reducedMotion;
    syncPlayback();
  }, [activeStep, controlled, paused, reducedMotion, syncPlayback]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const playbackState = playback.current;
    let lastPublish = -Infinity;
    let lastPhase = -1;
    let refreshGeometry = () => {};
    const counterOriginals: Array<{ element: HTMLElement; text: string | null }> = [];

    const context = gsap.context(() => {
      const select = <T extends Element = HTMLElement>(selector: string) => Array.from(element.querySelectorAll<T>(selector));
      const camera = select(".kf-camera");
      cameraElement.current = camera[0] ?? null;
      const core = select(".kf-core");
      const sheen = select(".kf-node-sheen");
      const acts = [0, 1, 2, 3].map((index) => select(`.kf-act-${index}`)[0]);
      const coreFinalX = () => -60;

      gsap.set(camera, { scale: 1, opacity: 1, transformOrigin: "50% 50%", force3D: true });
      gsap.set(core, { transformPerspective: 1200, transformOrigin: "50% 50%", transformStyle: "preserve-3d", force3D: true, x: 0, y: 0, rotationX: 10, rotationY: -16, rotationZ: -8, scale: 1, autoAlpha: 1 });
      gsap.set(sheen, { xPercent: -140, opacity: 0 });
      acts.forEach((act) => { if (act) gsap.set(act, { autoAlpha: 0 }); });

      const film = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: "power3.out" } });
      timeline.current = film;

      publish.current = (force = false) => {
        const now = performance.now();
        const time = film.time();
        const phase = Math.min(3, Math.floor(time / ACT_DURATION));
        if (phase !== lastPhase) {
          element.dataset.filmPhase = String(phase);
          lastPhase = phase;
        }
        if (!force && now - lastPublish < 125) return;
        lastPublish = now;
        setFrame({ phase, progress: Math.min(1, time / FILM_DURATION) });
      };
      film.eventCallback("onUpdate", () => {
        if (film.iteration() > 1) {
          element.querySelectorAll<HTMLElement>(".kf-counter[data-value]").forEach((counter) => {
            if (counter.dataset.value) counter.textContent = counter.dataset.value;
          });
          element.querySelectorAll<HTMLElement>(".kf-meter-fill").forEach((meter) => {
            gsap.set(meter, meter.closest(".kf-dashboard-chart") ? { scaleY: 1 } : { scaleX: 1 });
          });
        }
        publish.current?.();
      });

      // Camera breathing is deliberately slower than the UI choreography.
      film.to(camera, { scale: 1.025, duration: 5.3, ease: "sine.inOut" }, 0);
      film.to(camera, { scale: 1.012, duration: 5.3, ease: "sine.inOut" }, 6);
      film.to(camera, { scale: 1.035, duration: 5.3, ease: "sine.inOut" }, 12);
      film.to(camera, { scale: 1, duration: 5.3, ease: "sine.inOut" }, 18);

      film.to(core, { x: -20, y: -10, rotationX: 5, rotationY: 12, rotationZ: 6, scale: .88, duration: 1.65, ease: "power3.inOut" }, 5.4);
      film.to(core, { x: -20, y: 14, rotationX: 0, rotationY: 0, rotationZ: 0, scale: .78, duration: 1.65, ease: "power3.inOut" }, 11.4);
      const finalCorePose = { x: coreFinalX, y: 58, rotationX: 5, rotationY: -13, rotationZ: -8, scale: .72 };
      film.fromTo(core,
        { x: 0, y: -20, rotationX: 0, rotationY: 0, rotationZ: 0, scale: .78 },
        { ...finalCorePose, duration: 1.75, ease: "power3.inOut", immediateRender: false },
        17.4,
      );
      const enterFinalPose = film.recent() as gsap.core.Tween;
      film.fromTo(core,
        finalCorePose,
        { x: 0, y: 0, rotationX: 10, rotationY: -16, rotationZ: -8, scale: 1, duration: .8, ease: "power3.inOut", immediateRender: false },
        23.2,
      );
      const leaveFinalPose = film.recent() as gsap.core.Tween;
      refreshGeometry = () => {
        // Function-based GSAP values are cached after their first render.
        // Refresh only the two width-dependent poses and retain film time.
        enterFinalPose.invalidate();
        leaveFinalPose.invalidate();
        film.render(film.totalTime(), true, true);
      };

      acts.forEach((act, index) => {
        if (!act) return;
        const start = index * ACT_DURATION;
        const find = <T extends Element = HTMLElement>(selector: string) => Array.from(act.querySelectorAll<T>(selector));
        const panels = find(".kf-panel");
        const cues = new Map(panels.map((panel, panelIndex) => {
          const declared = Number(panel.getAttribute("data-enter"));
          const cue = panel.hasAttribute("data-enter") && Number.isFinite(declared)
            ? Math.max(0, Math.min(4.1, declared))
            : .12 + panelIndex * .1;
          return [panel, cue] as const;
        }));
        const cueFor = (target: Element) => {
          const panel = target.closest<HTMLElement>(".kf-panel");
          return panel ? cues.get(panel) ?? .12 : .12;
        };
        const staggerFor = (target: Element, selector: string) => {
          const panel = target.closest(".kf-panel") ?? act;
          const peers = Array.from(panel.querySelectorAll(selector));
          return Math.min(Math.max(0, peers.indexOf(target)) * .08, .24);
        };

        film.addLabel(`act-${index}`, start);
        film.set(act, { autoAlpha: 1 }, start);
        // Reset at the act boundary, not at each later entrance: otherwise a
        // delayed panel or check can flash in its completed state on repeat.
        if (panels.length) film.set(panels, { autoAlpha: 0 }, start);
        panels.forEach((panel, panelIndex) => {
          film.fromTo(panel,
            { autoAlpha: 0, x: panelIndex % 2 ? 38 : -38, y: 46, scale: .84, rotationX: 10, rotationY: panelIndex % 2 ? -12 : 12, transformPerspective: 1100, transformOrigin: "50% 50%" },
            { autoAlpha: 1, x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, duration: 1.1, ease: "power4.out", immediateRender: false },
            start + (cues.get(panel) ?? .12),
          );
        });
        const leaving = panels.filter((panel) => !panel.classList.contains("kf-blocked"));
        const blocked = panels.filter((panel) => panel.classList.contains("kf-blocked"));
        if (leaving.length) {
          film.to(leaving, { autoAlpha: 0, y: -24, scale: .96, rotationX: -3, duration: .48, stagger: { amount: .1 }, ease: "power2.in" }, start + 5.35);
        }
        if (blocked.length) {
          film.to(blocked, { autoAlpha: 0, y: -24, scale: .96, rotationX: -3, duration: .48, ease: "power2.in" }, start + 5.85);
        }

        find(".kf-meter-fill").forEach((meter) => {
          const chart = Boolean(meter.closest(".kf-dashboard-chart"));
          film.set(meter, chart ? { scaleY: 0, transformOrigin: "50% 100%" } : { scaleX: 0, transformOrigin: "0% 50%" }, start);
          film.fromTo(meter,
            chart ? { scaleY: 0, transformOrigin: "50% 100%" } : { scaleX: 0, transformOrigin: "0% 50%" },
            chart
              ? { scaleY: 1, duration: 1.05, ease: "power2.inOut", immediateRender: false }
              : { scaleX: 1, duration: 1.05, ease: "power2.inOut", immediateRender: false },
            start + cueFor(meter) + .65 + staggerFor(meter, ".kf-meter-fill"),
          );
        });
        find(".kf-check").forEach((check) => {
          const cue = check.closest(".kf-owner-return") ? 4.05 : cueFor(check) + .8 + staggerFor(check, ".kf-check");
          film.set(check, { autoAlpha: 0, scale: .65, y: 7 }, start);
          film.fromTo(check, { autoAlpha: 0, scale: .65, y: 7 }, { autoAlpha: 1, scale: 1, y: 0, duration: .48, ease: "power3.out", immediateRender: false }, start + cue);
        });
        find(".kf-transaction").forEach((row) => {
          if (row.matches(".kf-owner-return")) return;
          film.set(row, { autoAlpha: 0, x: 22, y: 9 }, start);
          film.fromTo(row, { autoAlpha: 0, x: 22, y: 9 }, { autoAlpha: 1, x: 0, y: 0, duration: .55, ease: "power3.out", immediateRender: false }, start + cueFor(row) + .85 + staggerFor(row, ".kf-transaction"));
        });
        find(".kf-scan").forEach((scan) => {
          const cue = cueFor(scan) + .45;
          film.set(scan, { y: 0, opacity: 0 }, start);
          film.fromTo(scan, { y: 0, opacity: 0 }, { y: 120, opacity: .7, duration: 1.1, ease: "power2.inOut", immediateRender: false }, start + cue);
          film.to(scan, { opacity: 0, duration: .3 }, start + cue + 1.1);
        });

        find<SVGGeometryElement>(".kf-trace").forEach((trace) => {
          if (typeof trace.getTotalLength !== "function") return;
          const normalizedLength = Number(trace.getAttribute("pathLength"));
          const length = normalizedLength > 0 ? normalizedLength : trace.getTotalLength();
          if (!Number.isFinite(length) || length <= 0) return;
          film.set(trace, { strokeDasharray: length, strokeDashoffset: length, opacity: .25 }, start);
          film.fromTo(trace, { strokeDasharray: length, strokeDashoffset: length, opacity: .25 }, { strokeDashoffset: 0, opacity: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false }, start + cueFor(trace) + .55);
        });

        find<HTMLElement>(".kf-counter[data-value]").forEach((counter) => {
          const raw = counter.dataset.value ?? "";
          const value = Number(raw);
          if (!raw || !Number.isFinite(value)) return;
          const decimals = Math.min(6, raw.split(".")[1]?.length ?? 0);
          const count = { value: 0 };
          counterOriginals.push({ element: counter, text: counter.textContent });
          const paintCounter = () => {
            counter.textContent = film.iteration() > 1 ? raw : count.value.toFixed(decimals);
          };
          film.set(count, { value: 0, onUpdate: paintCounter }, start);
          film.fromTo(count, { value: 0 }, {
            value,
            duration: 1.1,
            ease: "power2.out",
            immediateRender: false,
            onUpdate: paintCounter,
          }, start + cueFor(counter) + .65);
        });

        const ownerThumb = find(".kf-owner-toggle > i > span");
        const ownerTrack = find(".kf-owner-toggle > i");
        const ownerReturn = find(".kf-owner-return");
        if (ownerThumb.length) {
          film.set(ownerThumb, { x: 13 }, start);
          film.to(ownerThumb, { x: 0, duration: .52, ease: "power3.inOut" }, start + 2.7);
        }
        if (ownerTrack.length) {
          film.set(ownerTrack, { backgroundColor: "var(--blue, #014cfe)" }, start);
          film.to(ownerTrack, { backgroundColor: "#8f98a7", duration: .52, ease: "power2.inOut" }, start + 2.7);
        }
        if (ownerReturn.length) {
          film.set(ownerReturn, { autoAlpha: 0, y: 12 }, start);
          film.fromTo(ownerReturn, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: .65, ease: "power3.out", immediateRender: false }, start + 3.4);
        }

        if (sheen.length) {
          film.fromTo(sheen, { xPercent: -140, opacity: 0 }, { xPercent: 140, opacity: .45, duration: 1.6, ease: "power2.inOut", immediateRender: false }, start + .45);
          film.to(sheen, { opacity: 0, duration: .3 }, start + 1.85);
        }
        film.set(act, { autoAlpha: 0 }, start + 5.98);
      });

      // Explicit final duration keeps progress and repeat boundaries deterministic.
      film.set(camera, { scale: 1 }, FILM_DURATION);
      const initialPhase = activeStepRef.current ?? (reducedMotion ? 2 : undefined);
      film.pause(initialPhase === undefined ? 0 : clampPhase(initialPhase) * ACT_DURATION + SETTLED_OFFSET);
      publish.current(true);
    }, element);

    const rect = element.getBoundingClientRect();
    playback.current.inView = rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0;
    playback.current.documentVisible = document.visibilityState === "visible";
    playback.current.seeking = false;
    const observer = new IntersectionObserver(([entry]) => {
      playback.current.inView = entry.isIntersecting;
      syncPlayback();
    }, { threshold: .12 });
    observer.observe(element);
    const artboard = element.querySelector<HTMLElement>(".kf-artboard");
    let artboardWidth = artboard?.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      const width = artboard?.clientWidth;
      if (width === artboardWidth) return;
      artboardWidth = width;
      refreshGeometry();
    });
    if (artboard) resizeObserver.observe(artboard);
    const onVisibility = () => {
      playback.current.documentVisible = document.visibilityState === "visible";
      syncPlayback();
    };
    document.addEventListener("visibilitychange", onVisibility);
    syncPlayback();

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      navigation.current?.kill();
      navigation.current = null;
      playbackState.seeking = false;
      timeline.current?.kill();
      timeline.current = null;
      cameraElement.current = null;
      publish.current = null;
      context.revert();
      counterOriginals.forEach(({ element: counter, text }) => { counter.textContent = text; });
      delete element.dataset.filmPhase;
    };
  }, [root, reducedMotion, syncPlayback]);

  const seek = useCallback((requestedPhase: number) => {
    const film = timeline.current;
    if (!film) return;
    navigation.current?.kill();
    navigation.current = null;
    film.pause();
    const state = playback.current;
    const target = clampPhase(requestedPhase) * ACT_DURATION + SETTLED_OFFSET;
    const camera = cameraElement.current;
    const animate = Boolean(camera) && !state.reduced && !state.userPaused && state.inView && state.documentVisible && Math.abs(film.time() - target) >= .04;
    const hold = !state.controlled && !state.reduced;
    const showTarget = () => {
      film.pause(target);
      publish.current?.(true);
    };
    if (!animate) {
      if (camera) gsap.set(camera, { opacity: 1 });
      showTarget();
    }
    if (!animate && !hold) {
      state.seeking = false;
      syncPlayback();
      return;
    }
    state.seeking = true;
    const transition = gsap.timeline({
      paused: true,
      onComplete: () => {
        navigation.current = null;
        playback.current.seeking = false;
        publish.current?.(true);
        syncPlayback();
      },
    });
    navigation.current = transition;
    if (animate && camera) {
      // Dissolve straight to the requested act; never fast-forward through
      // unrelated scenes on a chapter click or controlled step change.
      transition.to(camera, { opacity: 0, duration: .16, ease: "power2.in" });
      transition.call(showTarget);
      transition.to(camera, { opacity: 1, duration: .35, ease: "power2.out" });
    }
    // The selected settled frame needs time to be read before its exit.
    // Keeping the hold in this timeline makes pause/visibility/cancellation
    // apply to the entire navigation operation without separate timers.
    if (hold) transition.to({}, { duration: 2.5 });
    syncPlayback();
  }, [syncPlayback]);

  useLayoutEffect(() => {
    if (activeStep !== undefined) seek(activeStep);
  }, [activeStep, reducedMotion, seek]);

  const toggle = useCallback(() => {
    const nextPaused = !motionPaused();
    document.documentElement.dataset.motion = nextPaused ? "paused" : "running";
    window.dispatchEvent(new CustomEvent(MOTION_EVENT, { detail: { paused: nextPaused } }));
  }, []);

  const replay = useCallback(() => {
    const film = timeline.current;
    if (!film) return;
    if (playback.current.userPaused && !playback.current.reduced) {
      seek(0);
      return;
    }
    navigation.current?.kill();
    navigation.current = null;
    playback.current.seeking = false;
    const camera = cameraElement.current;
    if (camera) gsap.set(camera, { opacity: 1 });
    const state = playback.current;
    const at = state.reduced ? 2 * ACT_DURATION + SETTLED_OFFSET : state.userPaused ? SETTLED_OFFSET : 0;
    if (!state.reduced && !state.userPaused) film.restart();
    else {
      film.totalTime(at);
      film.pause();
    }
    publish.current?.(true);
    syncPlayback();
  }, [seek, syncPlayback]);

  return { paused, reducedMotion, phase: frame.phase, progress: frame.progress, toggle, replay, seek };
}
