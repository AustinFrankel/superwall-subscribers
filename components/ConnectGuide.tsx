"use client";

import { useState } from "react";
import { SUPERWALL_API_KEYS_URL, SUPERWALL_DASHBOARD_URL } from "@/lib/creds";

const STEPS = [
  {
    n: 1,
    title: "Open Superwall",
    plain: "Log in at superwall.com",
    img: "/guide/step-1-open-superwall.svg",
  },
  {
    n: 2,
    title: "Settings → Keys",
    plain: "Left menu: click Keys (not the public pk_ key)",
    img: "/guide/step-2-settings.svg",
  },
  {
    n: 3,
    title: "New API Key",
    plain: "Under Organization API Keys, click + New API Key",
    img: "/guide/step-3-create-key.svg",
  },
  {
    n: 4,
    title: "Paste here",
    plain: "Copy the sk_ key and paste it below",
    img: "/guide/step-4-copy-paste.svg",
  },
] as const;

export default function ConnectGuide() {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  return (
    <section className="guide">
      <button
        type="button"
        className="guide-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>How to get your key</span>
        <span className="guide-chevron" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="guide-body">
          <div className="guide-actions">
            <a
              className="btn primary linkish"
              href={SUPERWALL_API_KEYS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Keys
            </a>
            <a
              className="btn ghost-light"
              href={SUPERWALL_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Superwall
            </a>
          </div>

          <ol className="guide-steps-nav">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <button
                  type="button"
                  className={`guide-step-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
                  onClick={() => setStep(i)}
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
              alt={current.plain}
              width={720}
              height={400}
              className="guide-img"
              loading={step === 0 ? "eager" : "lazy"}
            />
            <figcaption>
              <strong>
                {current.n}. {current.title}
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
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
