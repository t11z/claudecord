import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://t11z.github.io",
  base: "/claudecord",
  integrations: [
    starlight({
      title: "claudecord",
      description:
        "Self-hosted @claude for Discord — mention the bot, get Claude. Powered by your Claude Code OAuth token.",
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/t11z/claudecord" }],
      editLink: {
        baseUrl: "https://github.com/t11z/claudecord/edit/main/docs/",
      },
      sidebar: [
        {
          label: "User Guide",
          items: [
            { label: "Getting started", slug: "guide/getting-started" },
            { label: "Discord app setup", slug: "guide/discord-app-setup" },
            { label: "Configuration", slug: "guide/configuration" },
            { label: "Talking to Claude", slug: "guide/usage" },
            { label: "Access control & agentic mode", slug: "guide/access-control" },
            { label: "GitHub integration", slug: "guide/github-integration" },
            { label: "Deployment", slug: "guide/deployment" },
            { label: "Troubleshooting", slug: "guide/troubleshooting" },
          ],
        },
        {
          label: "Maintainer Guide",
          items: [
            { label: "Architecture", slug: "maintainer/architecture" },
            { label: "Agent SDK integration", slug: "maintainer/agent-sdk" },
            { label: "Database", slug: "maintainer/database" },
            { label: "Dashboard", slug: "maintainer/dashboard" },
            { label: "Contributing", slug: "maintainer/contributing" },
            { label: "Releasing", slug: "maintainer/releasing" },
          ],
        },
      ],
    }),
  ],
});
