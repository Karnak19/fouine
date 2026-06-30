import { defineConfig } from "vitepress";

export default defineConfig({
  title: "fouine",
  description: "Self-hosted AI code reviewer for GitHub",
  cleanUrls: true,
  head: [["link", { rel: "icon", type: "image/png", href: "/logo.png" }]],

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Architecture", link: "/architecture/" },
      { text: "API", link: "/api/" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/basilevernouillet/fouine" },
          { text: "Contributing", link: "/contributing/" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is fouine?", link: "/guide/" },
            { text: "Quick Start", link: "/guide/quickstart" },
          ],
        },
        {
          text: "Setup",
          items: [
            { text: "GitHub App", link: "/guide/github-app" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Configuration", link: "/guide/configuration" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [{ text: "Overview", link: "/architecture/" }],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [{ text: "REST API", link: "/api/" }],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [{ text: "Development Guide", link: "/contributing/" }],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/basilevernouillet/fouine" }],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/basilevernouillet/fouine/edit/docs/initial/docs/:path",
    },

    footer: {
      message: "Released under the MIT License.",
    },
  },
});
