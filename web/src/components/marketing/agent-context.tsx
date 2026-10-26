"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, MessageSquareText } from "lucide-react";
import { SITE_URL } from "@/config/site";
import { useCopy } from "./preferences";

const AGENT_GUIDE_URL = `${SITE_URL}/agent.md`;

export function AgentContext() {
  const t = useCopy();
  const promptRef = useRef<HTMLParagraphElement>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const promptStart = t("Read ", "Lee ");
  const promptEnd = t(" and help me get started with Kovan.", " y ayúdame a empezar con Kovan.");

  useEffect(() => () => {
    if (resetRef.current) clearTimeout(resetRef.current);
  }, []);

  async function copyPrompt() {
    if (resetRef.current) clearTimeout(resetRef.current);
    try {
      await navigator.clipboard.writeText(`${promptStart}${AGENT_GUIDE_URL}${promptEnd}`);
      setStatus("copied");
      resetRef.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      const selection = window.getSelection();
      if (promptRef.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(promptRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setStatus("error");
    }
  }

  return <div className="agent-context">
    <div className="agent-context-card">
      <div className="agent-context-header">
        <span className="agent-context-title"><MessageSquareText size={17} aria-hidden="true" />{t("Start with your agent", "Empieza con tu agente")}</span>
        <button className="agent-context-copy" type="button" onClick={copyPrompt} aria-label={t("Copy prompt for your agent", "Copiar instrucción para tu agente")}>
          {status === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {status === "copied" ? t("Copied", "Copiado") : t("Copy prompt", "Copiar")}
        </button>
      </div>
      <p ref={promptRef} className="agent-context-prompt">{promptStart}<a href="/agent.md" className="agent-context-url">{AGENT_GUIDE_URL}</a>{promptEnd}</p>
    </div>
    <p className={`agent-context-feedback${status === "error" ? " is-visible" : ""}`} role="status">
      {status === "error"
        ? t("Copy was blocked. Select and copy the prompt above.", "No se pudo copiar. Selecciona y copia la instrucción de arriba.")
        : status === "copied" ? t("Prompt copied. Paste it into your AI assistant.", "Instrucción copiada. Pégala en tu asistente de IA.") : ""}
    </p>
    <div className="agent-context-footer">
      <span>{t("Paste into your AI assistant.", "Pégalo en tu asistente de IA.")}</span>
      <Link href="/docs/quickstart">{t("Setup guide", "Guía de inicio")}<ArrowRight size={14} aria-hidden="true" /></Link>
    </div>
  </div>;
}
