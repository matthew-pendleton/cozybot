# Cozybot

Cozybot is a warm, Sims-inspired relationship Discord bot for casual social servers. It’s built with **Discord.js v14** and uses **SQLite** (via `better-sqlite3`) for persistence.

Cozybot is designed around a **single relationship score per pair** that rises and falls based on social interactions, with certain actions gated behind thresholds.

## What Cozybot tracks

- **Users**
  - `user_id`, `username`
  - `marriage_count` (used to enforce a server-wide marriage cap)
- **Relationships**
  - One integer `score` per user pair
  - Stored once per pair using a normalized key (`user_a < user_b`)
  - Score is clamped between **-20 and 100**
- **Marriages**
  - Marriage history per pair with timestamp
  - Used by `/cozybot status` (profile view) and `/cozybot divorce`

## Commands

All commands live under the `/cozybot` slash command.

### `/cozybot flirt @user`

- **Flow**: posts a public embed + **Accept / Reject** buttons (only the target can press them)
- **Timeout**: 60 seconds (no score change)
- **Score**
  - Accept: **+12 to +18**
  - Reject: **-5**

### `/cozybot compliment @user`

- **Flow**: instant public embed
- **Score**: **+5 to +8**

### `/cozybot insult @user`

- **Flow**: instant public embed
- **Score**: **-8 to -12**

### `/cozybot status @user`

Shows a “profile” embed:

- current spouses (with marriage dates)
- a cozy quip

### `/cozybot status @user1 @user2`

Shows the relationship score between two users with a 10-block bar:

- filled blocks: `█`
- empty blocks: `░`

### `/cozybot date @user`

- **Requires**: relationship score **>= 30**
- **Invite flow**: public embed + **Accept / Decline** buttons (invitee-only), 60s timeout
- **Live date event** (edits one embed in place)
  - 3 rounds (each round is 50/50 positive/negative)
  - Then a kiss prompt (**Kiss / No Kiss**) for the invitee, 30s timeout
- **Score**
  - Each positive round: **+8**
  - Each negative round: **-6**
  - Kiss: **+10**

### `/cozybot propose @user`

- **Requires**: relationship score **>= 80**
- **Requires**: both users have fewer than **3 marriages** (see “Marriage limit” below)
- **Flow**: proposal embed + **Accept / Decline** buttons (target-only), 60s timeout
- **Score**
  - Accept: **+15** (applied at the end of the ceremony)
  - Decline: **-15**
- **On accept**: runs a live ceremony
  - lobby: server members can claim roles for 60s
    - 📖 Officiant (1)
    - 💐 Flower Girl (1)
  - ceremony plays out by editing a single embed
  - on completion: marriage is written to the DB

### `/cozybot divorce @user`

- Unilateral (no approval required)
- **Requires**: an existing marriage between the two users
- Removes the marriage record and decrements `marriage_count` for both users
- **Score**: **-20**

## Marriage limit

Cozybot enforces a hard cap of **3 marriages per user** (`MAX_MARRIAGES = 3`).

When someone tries to propose and either user is at the cap, Cozybot responds with a private (ephemeral) 💌 message pulled from `dialogue.marriageLimitLines`.

## Private (ephemeral) bot messages

Any message the bot sends that only one person can see is intentionally styled as a “little private note” and starts with **💌**.

## Setup (server owners)

### Requirements

- Node.js (recommended: current LTS)
- A Discord application + bot token

### Install

1. Create a `.env` file (see `.env.example`):

```bash
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
```

2. Install dependencies:

```bash
npm install
```

3. Start the bot:

```bash
node index.js
```

On first run, `cozybot.db` is created automatically in the project directory.

### Permissions

Cozybot uses slash commands and message components (buttons). Ensure the bot has permission to:

- View channels
- Send messages
- Embed links

## About the earlier Sims-style draft

Your earlier requirements described two meters (friendship + romance) with many commands and level names.

Cozybot’s current implementation deliberately keeps it simpler:

- **One score** per pair (range **-20..100**)
- **Gates** at **30** (date) and **80** (propose)
- Focus on button-driven flows + live-updating embeds

If you want to evolve toward the two-axis model later, the safest path is:

- add columns (or a second table) for `friendship` and `romance`
- keep the current score as a “legacy/combined” view until commands are migrated

