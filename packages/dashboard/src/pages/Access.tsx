import { useEffect, useState } from "preact/hooks";
import { api, type GuildConfigResponseDto, type GuildSummaryDto } from "../api.ts";
import { Card } from "../components.tsx";

export function Access() {
  const [guilds, setGuilds] = useState<GuildSummaryDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<GuildConfigResponseDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .guilds()
      .then((gs) => {
        setGuilds(gs);
        if (gs.length > 0 && !selected) setSelected(gs[0]!.id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setData(null);
    api
      .guildConfig(selected)
      .then(setData)
      .catch(() => {});
  }, [selected]);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const save = async () => {
    if (!data || !selected) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.saveGuildConfig(selected, data.config);
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (guilds.length === 0) {
    return (
      <>
        <h1>Access control</h1>
        <Card>The bot isn't in any server yet — invite it from the overview page first.</Card>
      </>
    );
  }

  return (
    <>
      <h1>Access control</h1>
      <Card>
        <label class="field">
          <span>Server</span>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
          >
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {data ? (
        <>
          <Card title="Bot enabled">
            <label>
              <input
                type="checkbox"
                checked={data.config.enabled}
                onChange={() =>
                  setData({
                    ...data,
                    config: { ...data.config, enabled: !data.config.enabled },
                  })
                }
              />{" "}
              Respond to messages in this server
            </label>
          </Card>
          <Card title="Allowed channels">
            <p class="muted">
              No selection = the bot answers in <strong>every</strong> channel. Threads inherit
              their parent channel's permission.
            </p>
            <div class="checkbox-list">
              {data.channels.map((ch) => (
                <label key={ch.id}>
                  <input
                    type="checkbox"
                    checked={data.config.allowedChannelIds.includes(ch.id)}
                    onChange={() =>
                      setData({
                        ...data,
                        config: {
                          ...data.config,
                          allowedChannelIds: toggle(data.config.allowedChannelIds, ch.id),
                        },
                      })
                    }
                  />
                  #{ch.name}
                </label>
              ))}
            </div>
          </Card>
          <Card title="Allowed roles">
            <p class="muted">No selection = everyone may talk to the bot.</p>
            <div class="checkbox-list">
              {data.roles.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={data.config.allowedRoleIds.includes(r.id)}
                    onChange={() =>
                      setData({
                        ...data,
                        config: {
                          ...data.config,
                          allowedRoleIds: toggle(data.config.allowedRoleIds, r.id),
                        },
                      })
                    }
                  />
                  @{r.name}
                </label>
              ))}
            </div>
          </Card>
          <Card title="GitHub roles (per-user GitHub)">
            <p class="muted">
              Members with one of these roles can run <code>/link-github</code> to connect their own
              GitHub account; agentic runs they start then act in <em>their</em> namespace. While
              any role is selected, the shared GitHub token is not used on this server. No selection
              = per-user gating off. Requires a GitHub App configured under Setup.
            </p>
            <div class="checkbox-list">
              {data.roles.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={data.config.githubRoleIds.includes(r.id)}
                    onChange={() =>
                      setData({
                        ...data,
                        config: {
                          ...data.config,
                          githubRoleIds: toggle(data.config.githubRoleIds, r.id),
                        },
                      })
                    }
                  />
                  @{r.name}
                </label>
              ))}
            </div>
          </Card>
          <Card title="Agentic mode">
            <div class="callout">
              ⚠️ Agentic mode gives Claude file and shell tools inside a sandbox workspace. Anyone
              allowed to talk to the bot can <em>indirectly execute commands</em> via prompt
              injection. Only enable this on servers where you trust every allowed role, and run the
              bot in Docker. Read the security docs first.
            </div>
            <label>
              <input
                type="checkbox"
                checked={data.config.agenticEnabled}
                onChange={() =>
                  setData({
                    ...data,
                    config: { ...data.config, agenticEnabled: !data.config.agenticEnabled },
                  })
                }
              />{" "}
              Enable agentic mode for new threads
            </label>
          </Card>
          <Card title="Extra system prompt">
            <p class="muted">Appended to Claude's instructions for this server. Optional.</p>
            <textarea
              rows={3}
              value={data.config.systemPromptExtra ?? ""}
              onInput={(e) =>
                setData({
                  ...data,
                  config: {
                    ...data.config,
                    systemPromptExtra: (e.target as HTMLTextAreaElement).value || null,
                  },
                })
              }
            />
          </Card>
          <button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save changes"}
          </button>{" "}
          {message ? <span class="muted">{message}</span> : null}
        </>
      ) : (
        <Card>Loading…</Card>
      )}
    </>
  );
}
