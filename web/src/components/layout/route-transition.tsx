import { ViewTransition, type ReactNode } from "react";
import "./route-transition.css";

function BrandBackdrop() {
  return <div className="brand-backdrop" aria-hidden="true">
    <div className="brand-backdrop-track">
      {[0, 1].map((copy) => <div className="brand-backdrop-set" key={copy}>
        {Array.from({ length: 7 }, (_, index) => <svg className="brand-backdrop-mark" viewBox="0 0 401 505" key={index} focusable="false">
          <polygon points="0,183 401,0 401,153 0,336" />
          <polygon points="62,350 330,229 330,505" />
        </svg>)}
      </div>)}
    </div>
  </div>;
}

/**
 * React 19.3 coordinates snapshots with the App Router's own transition.
 * Keeping this boundary mounted preserves Next's route cache, history and
 * scroll restoration; only its changing page content receives an animation.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-stage">
      <BrandBackdrop />
      <ViewTransition name="kovan-page" update="kovan-route" default="none">
        <div className="route-transition">{children}</div>
      </ViewTransition>
    </div>
  );
}
