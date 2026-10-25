import { ViewTransition, type ReactNode } from "react";
import "./route-transition.css";

/**
 * React 19.3 coordinates snapshots with the App Router's own transition.
 * Keeping this boundary mounted preserves Next's route cache, history and
 * scroll restoration; only its changing page content receives an animation.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition name="kovan-page" update="kovan-route" default="none">
      <div className="route-transition">{children}</div>
    </ViewTransition>
  );
}
