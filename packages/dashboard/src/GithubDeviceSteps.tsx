/**
 * The two steps a member follows on github.com while `useGithubDeviceFlow` polls.
 *
 * Its own component because Welcome and Account both show it: the hook already
 * deduplicated the polling logic, but each page still carried its own copy of
 * this markup, so the wording could drift between the two places a member meets
 * it.
 */
export function GithubDeviceSteps(props: { userCode: string; verificationUri: string }) {
  return (
    <>
      <p>
        1. Open{" "}
        <a href={props.verificationUri} target="_blank" rel="noreferrer">
          {props.verificationUri}
        </a>
      </p>
      <p>
        2. Enter this code: <code>{props.userCode}</code>
      </p>
      <p class="muted">Waiting for you to authorize…</p>
    </>
  );
}
