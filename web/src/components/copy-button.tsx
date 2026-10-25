"use client";

import { useState } from "react";
import { toast } from "sonner";

export function CopyButton({ value }: { value: string }) {
  const [label, setLabel] = useState("Copy");

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setLabel("Copied");
          toast.success("Copied");
        } catch {
          setLabel("Select");
          toast.error("Select the ID to copy it");
        }
        window.setTimeout(() => setLabel("Copy"), 1400);
      }}
    >
      {label}
    </button>
  );
}
