/** Site wide navigation. The header, the footer and the route smoke test all read from here. */

export interface NavLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: readonly NavLink[];
}

export const siteName = "Turnstile";
export const siteDescription =
  "Turnstile lets AI agents pay per request in a stablecoin on Solana. Owners set spending limits once and the chain enforces them. Every payment leaves a receipt.";

export const primaryNav: readonly NavLink[] = [
  { label: "Product", href: "/product" },
  { label: "Solutions", href: "/solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
];

export const signInLink: NavLink = { label: "Sign in", href: "/signin" };
export const consoleLink: NavLink = { label: "Open console", href: "/console" };

export const footerColumns: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/product" },
      { label: "Solutions", href: "/solutions" },
      { label: "Pricing", href: "/pricing" },
      { label: "Live demo", href: "/demo" },
      { label: "Console", href: "/console" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Agent quickstart", href: "/docs/agent-quickstart" },
      { label: "Concepts", href: "/docs/concepts" },
      { label: "API reference", href: "/docs/reference" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of service", href: "/legal/terms" },
      { label: "Privacy policy", href: "/legal/privacy" },
    ],
  },
];

/** Every internal route a visitor can reach from the chrome. */
export function allChromeRoutes(): string[] {
  const hrefs = new Set<string>(["/", signInLink.href, consoleLink.href]);
  for (const link of primaryNav) hrefs.add(link.href);
  for (const column of footerColumns) for (const link of column.links) hrefs.add(link.href);
  return [...hrefs].sort();
}

/** True when `href` is the current page or a parent section of it. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
