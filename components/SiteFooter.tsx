import { GITHUB_REPO_URL } from "@/lib/creds";

export default function SiteFooter({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={`site-footer ${dark ? "dark" : ""}`}>
      <p className="site-footer-built">
        Built by{" "}
        <a
          href="https://github.com/AustinFrankel"
          target="_blank"
          rel="noopener noreferrer"
        >
          Austin Frankel
        </a>
      </p>
      <p className="site-footer-links">
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <span aria-hidden="true"> · </span>
        <a
          href="https://superwall.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Superwall
        </a>
      </p>
    </footer>
  );
}
