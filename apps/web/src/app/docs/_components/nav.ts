export interface DocsLink {
  label: string;
  href: string;
}

export interface DocsNavItem extends DocsLink {
  /** In-page anchors listed under the page. */
  sections?: readonly DocsLink[];
}

/** The docs sidebar. Every page and every reference anchor it links to exists. */
export const docsNav: readonly DocsNavItem[] = [
  { label: "Overview", href: "/docs" },
  { label: "Quickstart", href: "/docs/quickstart" },
  { label: "Agent quickstart", href: "/docs/agent-quickstart" },
  { label: "Concepts", href: "/docs/concepts" },
  {
    label: "Reference",
    href: "/docs/reference",
    sections: [
      { label: "Facilitator", href: "/docs/reference#facilitator" },
      { label: "Resource SDK", href: "/docs/reference#resource-sdk" },
      { label: "Agent SDK", href: "/docs/reference#agent-sdk" },
      { label: "Console API", href: "/docs/reference#console-api" },
      { label: "Errors", href: "/docs/reference#errors" },
    ],
  },
];
