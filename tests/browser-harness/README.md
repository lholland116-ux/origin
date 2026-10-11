# Local synthetic workflow UI harness

This standalone Vite page imports the production `WorkflowProgressPanel` and the production workflow tracking, selection, validation, and cleanup helpers. It does not start Next.js, load `.env.local`, authenticate, connect to a database, or execute a workflow. The only workflow requests are handled by an in-memory mock; unrecognized fetch targets are rejected without a proxy or fallback.

## Start and stop

From the repository root, start the loopback-only harness in one terminal:

```sh
env -i HOME=/tmp/lvtchat-er-ui-cs2-home PATH="$(dirname "$(command -v node)"):/usr/bin:/bin" NODE_ENV=development ./node_modules/.bin/vite --config tests/browser-harness/vite.config.mts
```

Open `http://127.0.0.1:4173/` in Chrome. The Vite config binds strictly to `127.0.0.1`, refuses to choose another port, disables env-file loading, and uses a temporary Vite cache. Stop the harness with **Ctrl+C** in its terminal. Do not use `npm run dev` or `next dev` for this test.

For a separate browser profile, launch Chrome with a disposable profile and extensions/background networking disabled. The harness itself uses a restrictive Content Security Policy and replaces page `fetch` with a same-origin-only in-memory handler before rendering React.

## Manual acceptance

1. Confirm the banner says **LOCAL SYNTHETIC UI TEST** and **Local synthetic data. No real AI execution.**
2. In **Accepted / pending assistant destination**, confirm the pending assistant placeholder is not shown, one workflow panel is present, and the request counter/log show a synthetic GET.
3. Choose **Workflow progress**, confirm the step order and completion count, then use **Advance synthetic progress**. Use **Refresh conversation messages** and confirm the panel count remains one.
4. Choose **Prepared controls**. Pause, then resume. Confirm the panel status changes. Stop prompts for confirmation; accept it and confirm **Stop requested**. The harness never continues a worker.
5. Choose **Approval checkpoint (synthetic only)**. Try **Return for changes** with an empty reason and confirm validation blocks the request. Enter a reason, accept the confirmation, and verify the synthetic return. Reload the approval scenario and try **Approve checkpoint**. No production checkpoint is created.
6. Use **Simulate stale revision** before a control. Confirm the revision-conflict message and unchanged synthetic state. Use **Simulate ambiguous action result** before a control; confirm the event log shows one POST, then an authoritative GET updates the state without retrying the POST.
7. Try **Failed workflow**, **Recovery required**, **Status returns HTTP 401**, **Status returns HTTP 404**, and **Status network failure**. Confirm the panel's user-facing explanation for each.
8. Switch between **Conversation A** and **Conversation B**. Confirm each has only its own workflow. Reload the tab and use **Restore session tracking** to verify same-tab sessionStorage restoration.
9. Choose **Completed workflow**, then **Show finalized assistant message**. Confirm one assistant message remains with the original synthetic assistant ID and the duplicate panel is removed.
10. Switch **Theme** between dark and light. In Chrome DevTools responsive mode inspect widths 1280, 768, 375, and 320 pixels. Confirm no horizontal overflow, controls wrap, the rationale field fits, and keyboard focus remains visible.
11. In DevTools Network, confirm page requests use only `127.0.0.1:4173`; workflow API entries appear in the harness event log because they are intercepted in memory. Check the Console for errors.

These are synthetic frontend checks. They do not qualify Supabase integration, authentication, backend authorization, durable workflow recovery, or Android WebView behavior.
