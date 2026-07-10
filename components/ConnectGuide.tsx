"use client";

import { useState } from "react";
import { SUPERWALL_API_KEYS_URL, SUPERWALL_DASHBOARD_URL } from "@/lib/creds";

const STEPS = [
  {
    n: 1,
    title: "Open Superwall",
    plain: "Go to superwall.com and log in.",
    img: "/guide/step-1-open-superwall.svg",
    alt: "Browser open to superwall.com",
  },
  {
    n: 2,
    title: "Settings → API Keys",
    plain: "Click Settings, then click API Keys.",
    img: "/guide/step-2-settings.svg",
    alt: "Settings menu with API Keys highlighted",
  },
  {
    n: 3,
    title: "Make a key (data:read)",
    plain: "Create a new key. Only turn on data:read.",
    img: "/guide/step-3-create-key.svg",
    alt: "Create API key with data:read permission",
  },
  {
    n: 4,
    title: "Copy & paste here",
    plain: "Copy your Organization ID and API key. Paste them below.",
    img: "/guide/step-4-copy-paste.svg",
    alt: "Copy keys from Superwall and paste into this site",
  },
] as const;

export default function ConnectGuide() {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  return (
    <section className="guide" aria-labelledby="guide-heading">
      <button
        type="button"
        className="guide-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span id="guide-heading">How do I get my Superwall keys?</span>
        <span className="guide-chevron" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="guide-body">
          <p className="guide-intro">
            Superwall does not offer one-click login for third-party tools.
            You create a <strong>read-only</strong> API key once (about 1
            minute). We never store your key on a server — only in your browser.
          </p>

          <div className="guide-actions">
            <a
              className="btn primary linkish"
              href={SUPERWALL_API_KEYS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Superwall API Keys ↗
            </a>
            <a
              className="btn ghost-light"
              href={SUPERWALL_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Superwall
            </a>
          </div>

          <ol className="guide-steps-nav" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <button
                  type="button"
                  className={`guide-step-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
                  onClick={() => setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className="guide-step-num">{s.n}</span>
                  <span className="guide-step-label">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>

          <figure className="guide-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.img}
              alt={current.alt}
              width={720}
              height={420}
              className="guide-img"
              loading={step === 0 ? "eager" : "lazy"}
              decoding="async"
            />
            <figcaption>
              <strong>
                Step {current.n}: {current.title}
              </strong>
              <span>{current.plain}</span>
            </figcaption>
          </figure>

          <div className="guide-nav-btns">
            <button
              type="button"
              className="btn ghost-light"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="btn primary linkish"
              disabled={step === STEPS.length - 1}
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            >
              Next step
            </button>
          </div>

          <ul className="guide-checklist">
            <li>Organization ID = numbers only</li>
            <li>
              Permission needed = <code>data:read</code> only
            </li>
            <li>Key is kept in your browser (localStorage), not on our servers</li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}
