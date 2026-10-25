import { primaryCta } from "@/config/site";
import type { ReactNode } from "react";

export function PrimaryLink({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const cta = primaryCta();
  return (
    <a
      className={className}
      href={cta.href}
      data-todo="app-url"
      {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children ?? (
        <>
          {cta.label} <span className="arr">→</span>
        </>
      )}
    </a>
  );
}
