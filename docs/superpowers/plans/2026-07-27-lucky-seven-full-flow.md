# Lucky Seven Full Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Lucky Seven into a complete server-authoritative table game with the original 94-card distribution, a rotating player dealer, action cards, discard visibility, round summaries, final rankings, and lightweight client animations.

**Architecture:** The shared protocol describes a public table snapshot while the shuffled draw pile remains a non-enumerable server-only property. Lucky Seven becomes a small turn state machine: the active player requests hit/stay, the rotating dealer confirms the action, the server resolves cards and effects, and play advances clockwise. Godot renders the public snapshot and animates new server events without deciding card outcomes or scores.

**Tech Stack:** TypeScript, Node test runner, Godot 4 GDScript, Web export.

## Global Constraints

- Preserve Button Race, Act Natural, Loot & Leave, and Silent Witness.
- Keep the server authoritative for deck order, turns, effects, scores, rounds, and winners.
- Support 2-8 players.
- Do not add accounts, persistence, matchmaking, chat, cosmetics, analytics, or a board wrapper.
- Do not push unless asked.

---

### Task 1: Authoritative card and dealer model

**Files:**
- Modify: `shared/message-types/protocol.ts`
- Modify: `server/src/minigames/LuckySeven.test.ts`
- Modify: `server/src/minigames/LuckySeven.ts`

**Interfaces:**
- Consumes: `LuckySevenInput` received through the existing `PLAYER_INPUT` route.
- Produces: public `LuckySevenState` containing `dealerId`, `activePlayerId`, `turnState`, `discardPile`, player card/effect state, and event sequence.

- [ ] **Step 1: Write failing tests**

Add assertions for the exact 94-card composition, hidden deck serialization, clockwise dealer rotation, active-player decision validation, and dealer-only confirmation.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm.cmd test -- --test-name-pattern="Lucky Seven|deck|dealer|modifier|Second Chance|Freeze|Flip Three|summary"`

Expected: failures because the protocol and turn state do not exist yet.

- [ ] **Step 3: Implement shared types and server state machine**

Use input actions `request_hit`, `request_stay`, `dealer_deal`, `dealer_confirm_stay`, and `continue`. Build the deck as 79 number cards, 7 modifier cards, and 9 action cards. Restrict requests to the active player and confirmations to the dealer.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `npm.cmd test`

Expected: all server tests pass.

### Task 2: Card effects, scoring, summaries, and results

**Files:**
- Modify: `server/src/minigames/LuckySeven.test.ts`
- Modify: `server/src/minigames/LuckySeven.ts`

**Interfaces:**
- Consumes: server-only draw pile and public player hands.
- Produces: deterministic modifier scoring, Second Chance protection, Freeze banking, Flip Three draws, `roundSummary`, and ranked `finalResults`.

- [ ] **Step 1: Write failing effect tests**

Cover +2/+4/+6/+8/+8/+10, x2 applying only to number totals, Second Chance consuming itself on a duplicate, Freeze banking its receiver, Flip Three resolving three server draws, seven-number bonus, discard tracking, summary pause, and game completion at 200 after a round.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `npm.cmd test -- --test-name-pattern="modifier|Second Chance|Freeze|Flip Three|summary|results"`

Expected: behavior assertions fail before implementation.

- [ ] **Step 3: Implement minimal effect resolution**

Resolve cards through one server function, update discards whenever a card leaves play, calculate score as `(number total * x2) + modifiers + Lucky Seven bonus`, and rank final scores descending.

- [ ] **Step 4: Run full server verification**

Run: `npm.cmd test`

Expected: all tests pass.

### Task 3: Godot table controls and information panels

**Files:**
- Modify: `client-godot/scripts/NetworkManager.gd`
- Modify: `client-godot/scripts/LuckySeven.gd`

**Interfaces:**
- Consumes: `LuckySevenState` and sends the new action strings.
- Produces: role-aware controls, table highlights, discard viewer, round summary, and final result ranking.

- [ ] **Step 1: Update action transport**

Keep `send_lucky_seven_input(action)` and permit the new server action names without adding client-side outcomes.

- [ ] **Step 2: Build role-aware controls**

Show `Hit Me` and `Stay` only to the active player; show `Deal` or `Confirm Stay` to the dealer when confirmation is pending. Disable controls in summary and complete states.

- [ ] **Step 3: Add table information**

Mark the dealer and active player, show all hands and scores, add a toggleable discard panel with card counts and remaining deck count, and display Second Chance status.

- [ ] **Step 4: Add summary and final panels**

Render per-player round gains after each round, let the dealer continue, and show a ranked final scoreboard with the winner emphasized.

- [ ] **Step 5: Add restrained animations**

Animate card draw position from the deck toward the recipient, pulse the active seat, flash bust/freeze events, and fade summary/results panels in using Godot tweens.

### Task 4: Export and end-to-end verification

**Files:**
- Modify generated export: `client-godot/builds/web/index.pck`

**Interfaces:**
- Consumes: verified TypeScript server and Godot project.
- Produces: deployable browser build containing the updated Lucky Seven UI.

- [ ] **Step 1: Run server tests and builds**

Run: `npm.cmd test`, `npm.cmd run build`, and root `npm.cmd run vercel-build`.

- [ ] **Step 2: Load Godot headlessly**

Run Godot 4 with `--headless --path client-godot --editor --quit`.

- [ ] **Step 3: Refresh Web export**

Run Godot 4 with `--headless --path client-godot --export-release Web client-godot/builds/web/index.html`.

- [ ] **Step 4: Re-run deployment verification**

Run: `npm.cmd run vercel-build`

Expected: the static Godot Web build is copied successfully.

- [ ] **Step 5: Commit locally**

Stage only Lucky Seven protocol, server, tests, Godot UI, plan, and refreshed Web export. Commit with `feat: complete lucky seven table flow`. Do not push.
