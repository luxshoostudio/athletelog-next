# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory.

It runs locally as a stdio process spawned by the LLM client, adds no new container, and
requires no extra authentication. The LLM never sees passkeys, VAPID keys, or session secrets.
Reads come from the same `state-<uid>.json` the api writes. The Livy tools below append to a
separate inbox file; they do not edit or delete what is already logged.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

There is no MCP URL. The client spawns this process. Auth is the data directory: whoever can
read `OPENGYM_DATA` can call the tools, and the Livy write tools can append there. See **Livy**
below for the two write tools and the same calls over the sync API.

## Quick start

### 1. Install

```bash
cd mcp
npm install
```

### 2. Point it at your data

The MCP server reads the same `./data` directory `docker compose up` creates. Pick the profile
to answer for — its user id is in `./data/db.json` under `users[].id`:

```bash
# single-user instance (the common self-hosted case) — auto-detected:
node src/index.js

# multi-user instance, or just to be explicit:
OPENGYM_UID=<your-uid> OPENGYM_DATA=/path/to/openGym/data node src/index.js
```

### 3. Register with your LLM client

Add the server to your LLM client's MCP config. For Claude Desktop, edit
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-uid>"   // optional — auto-detected if you have one profile
      }
    }
  }
}
```

For Cursor and other MCP-compatible clients, see the client's MCP docs — the same `command` +
`args` + `env` shape is what every stdio MCP server expects.

Restart the client; you should see the openGym tools appear with "serving profile \<name\>" on
the server's stderr.

## Tools

Read tools, plus two Livy writes (see below):

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight and rest per exercise) |
| `preview_session` | What will the app actually put on screen when I start this routine — after the progression policy and my history have overridden the plan? |
| `get_week_plan` | What's planned when: the next seven days with their routines and how each was decided (coach week, a pinned session, an override, the weekday plan), the current coach week when one is running, and the weekday table. |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. Pass `days` for the last N days (ending today, or ending at `to`). |
| `list_food_logs` | Food entries in a window (default the last 7 days): name, amount, unit, calories, protein, fat, carbs, fiber, date, time, source. Includes Livy inbox rows not copied into the log yet. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. |
| `get_bodyweight` | Weigh-ins with the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |

`get_routine` and `preview_session` answer two different questions, and confusing them is the
easiest way for a coach to give wrong advice. `get_routine` reports what the routine *stores*.
`preview_session` reports what the athlete will actually *see*: a routine holding "squat 3×8 @
60 kg" opens at 75 kg if the policy progressed or deloaded from that routine's last logged
session. The routine's own weight is the last fallback the session builder consults, not the
first; its reps hold unless a policy that moves reps moved them, or the profile starts planned
sessions from the last session (`starts_from`). Ask `preview_session` before naming a weight.

Each tool returns JSON the LLM can format as it likes; structured fields (sets, dates, levels)
are pre-formatted into human-readable labels in `src/labels.js` so the LLM doesn't need to
re-interpret them.

## Livy

Livy (or any other agent) uses this same stdio server. No extra process, and no GitHub Gist.
Point `OPENGYM_DATA` at the server's `./data` (the folder `docker compose` uses) and `OPENGYM_UID`
at the profile id in `./data/db.json` under `users[].id`. The config block in **Quick start** is
the whole connection. The session cookie is not involved.

Food and workouts logged in the app already sync on their own: every save goes through the
store, which pushes the whole profile about 1.5 seconds later. That push includes
`foodEntries`, `foodItems`, and `nutritionTargets`. These tools are how Livy adds a row without
opening the app, and how she reads the log.

| Tool | Arguments |
|---|---|
| `add_food_entry` | `id` (required, stable, reuse on retry), `name`, and optionally `amount`, `unit`, `calories`, `protein`, `fat`, `carbs`, `fiber`, `date` (`YYYY-MM-DD`), `time` (`HH:MM`), `barcode`. Macros are the totals for `amount`. |
| `add_workout_entry` | `id` (required), `exercises` (required): each has `exercise_id` or `exercise_name` (exact catalogue name, one match) and `sets` of `weight` and `reps`. Optionally `date`, `name`. |
| `list_food_logs` | `days` (default 7), or `from` / `to`. |
| `list_workouts` | `days`, or `from` / `to`, plus `limit`. `get_workout` still returns one session. |

Both writes set `source` to `livy` and refuse a second copy of the same `id`. They append to
`livy-inbox-<uid>.json`. They never change an entry the athlete logged. The app, next time it
opens or its sync poll sees the inbox, copies the new rows in and shows "3 entries added by
Livy" with Undo. Undo removes only those rows.

The same inbox is on the sync API, for a caller that already has a session cookie (the web app,
or a script holding one). `POST /api/livy/inbox` with `Content-Type: application/json`. A missing
session is 401. There is still no token minted for an agent; an agent on another machine should
run this MCP server where `./data` lives.

One food entry:

```json
{
  "id": "livy-2026-10-10-eggs",
  "name": "eggs",
  "amount": 2,
  "unit": "egg",
  "calories": 140,
  "protein": 12,
  "date": "2026-10-10",
  "time": "08:10"
}
```

Call `add_food_entry` with those fields. The HTTP body is the same object plus `"kind": "food"`.

One workout entry:

```json
{
  "id": "livy-2026-10-10-push",
  "date": "2026-10-10",
  "name": "Push",
  "exercises": [
    { "exercise_name": "barbell bench press", "sets": [{ "weight": 40, "reps": 8 }] }
  ]
}
```

`exercise_id` (from `list_routines`, `get_workout`, or the catalogue) works in place of
`exercise_name`. The HTTP body is that object plus `"kind": "workout"`.

Stored, the food row uses the food log's fields (`amount`, `unit`, `calories`, `protein`,
`date`, `time`, `source`). The workout uses a finished session's fields (`d`, `entries[].id`,
`entries[].sets[].w`, `entries[].sets[].r`, `source`).

## How it reuses the training logic

The MCP server imports the training helpers under `frontend/src/lib/` directly as Node ESM
and calls the same functions the React UI does (`history.js`, `onerm.js`, `muscles.js`,
`exercises.js`). The numbers it returns match what the Stats screen shows, because they are
the same code.

The one lib file that wasn't Node-safe was `i18n.js` (Vite's `import.meta.glob` at module
top level) — split into `i18n-core.js` (pure, Node-safe) + `i18n.js` (Vite/React bits,
re-exports from core). `exercises.js` got a one-line `import.meta.env || {}` guard. No new
dependencies landed in `frontend/`, no public exports changed.

## Design constraints honoured

- **One runtime dependency beyond the MCP SDK:** none. No database driver, no HTTP framework.
- **No new container.** stdio transport is spawned by the LLM client; nothing to add to
  `docker-compose.yml`.
- **No new auth.** The filesystem is the boundary — same as `docker compose` running on the
  user's box. No passkey material, VAPID keys, or session secrets ever cross it.
- **No telemetry, no network.** Reads `./data/*.json` and exits when the LLM client
  disconnects.

## Tests

```bash
cd mcp && npm test
```

58 cases seeding state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio, 8 tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done (Livy inbox):** `add_food_entry` and `add_workout_entry` append to `livy-inbox-<uid>.json`.
  They do not take a new token and they do not edit the profile file. The wider write tools below
  are still not shipped.
- **Phase 2:** read+write over stdio for the rest of the profile. Requires a long-lived token auth
  path minted from the admin dashboard (new `./data/tokens.json`) and a write-lock against the web
  UI's read-modify-write of `state-<uid>.json`. Tools: `log_workout`, `add_bodyweight`,
  `edit_routine`, `assign_weekday`, `override_day`.
- **Phase 3:** Streamable HTTP transport, opt-in 4th container in `docker-compose.yml`. Same
  tool implementations, second transport — the MCP SDK supports both behind one tool registration.

## License

AGPL-3.0-or-later, same as openGym.
