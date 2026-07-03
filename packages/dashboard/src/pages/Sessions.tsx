import { useEffect, useState } from "preact/hooks";
import { api, type SessionDto } from "../api.ts";
import { Badge, Card } from "../components.tsx";

export function Sessions() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);

  const load = () =>
    api
      .sessions()
      .then(setSessions)
      .catch(() => {});

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const reset = async (threadId: string) => {
    await api.deleteSession(threadId).catch(() => {});
    await load();
  };

  const abort = async (threadId: string) => {
    await api.abortSession(threadId).catch(() => {});
    await load();
  };

  return (
    <>
      <h1>Sessions</h1>
      <Card>
        <p class="muted">
          Every Discord thread maps to one Claude session. Resetting deletes the mapping — the
          thread keeps working but Claude forgets its history.
        </p>
        {!sessions ? (
          "Loading…"
        ) : sessions.length === 0 ? (
          "No conversations yet. Mention the bot in a channel to start one."
        ) : (
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Thread</th>
                  <th>Mode</th>
                  <th>Model</th>
                  <th>Turns</th>
                  <th>Last active</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.threadId}>
                    <td>{s.threadName ?? s.threadId}</td>
                    <td>
                      {s.mode === "agentic" ? (
                        <Badge kind="warn">agentic</Badge>
                      ) : (
                        <Badge kind="info">chat</Badge>
                      )}
                    </td>
                    <td>
                      <code>{s.model}</code>
                    </td>
                    <td>{s.turnCount}</td>
                    <td>{new Date(s.lastActiveAt).toLocaleString()}</td>
                    <td>
                      {s.running ? (
                        <Badge kind="ok">running</Badge>
                      ) : (
                        <span class="muted">idle</span>
                      )}
                    </td>
                    <td style="white-space:nowrap">
                      {s.running ? (
                        <button type="button" class="danger" onClick={() => void abort(s.threadId)}>
                          Abort
                        </button>
                      ) : (
                        <button
                          type="button"
                          class="secondary"
                          onClick={() => void reset(s.threadId)}
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
