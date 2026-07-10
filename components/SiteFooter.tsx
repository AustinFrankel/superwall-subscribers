import { GITHUB_REPO_URL } from "@/lib/creds";

export default function SiteFooter({ dark = false }: { dark?: boolean }) {
  return (
    <footer className={`site-footer ${dark ? "dark" : ""}`}>
      <p>
        Built by{" "}
        <a
          href="https://github.com/AustinFrankel"
          target="_blank"
          rel="noopener noreferrer"
        >
          Austin Frankel
        </a>
        {" · "}
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </p>
    </footer>
  );
}
