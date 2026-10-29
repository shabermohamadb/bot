# Discord Raid Master Bot

A production-ready Discord bot recreating the party creation, management, and thread-based role registration workflow designed for Albion Online groups (Avalonian Dungeons / AVA, Outlands Roam/Gank, and World Bosses).

The entire player experience is native to Discord: organizers create and configure parties via an interactive wizard, an announcement embed is published with an attached dedicated thread, and members register or switch roles simply by sending a role number (e.g. `@Raid master 1`).

---

## Table of Contents

- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Number-Based Registration System](#number-based-registration-system)
- [Discord Slash Commands & Permissions](#discord-slash-commands--permissions)
- [Discord Developer Portal Setup](#discord-developer-portal-setup)
- [Quickstart (Local Development)](#quickstart-local-development)
- [PostgreSQL Production Setup & Migration](#postgresql-production-setup--migration)
- [Production Deployment (Docker & PM2)](#production-deployment-docker--pm2)
- [Architecture & Database Schema](#architecture--database-schema)
- [Automated Test Suite](#automated-test-suite)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [File Tree](#file-tree)

---

## Key Features

1. **Native Thread-Based Registration**:
   - Organizers run `/party create` to spawn an announcement message and dedicated registration thread.
   - Members register directly inside the thread by mentioning the bot followed by a role number (e.g., `@Raid master 1` or `<@!botId> 3`).
   - Members unregister using `@Raid master -`.
   - Role switching is handled atomically: members can switch to an available role without unregistering first. If the desired role is full, their current registration remains intact.
   - Exactly one active role registration per member per party (enforced via database transactions and database unique constraints).

2. **Real-Time Announcement Embed**:
   - Real-time display of party requirements (Minimum IP, Activity Type, Food Count & Scope, Duration, Tracking Toolkit, Side Tracking).
   - Live roster counters (e.g., `Tank: 1/1 (@Player)`, `DPS Cultist: 1/2 (@Player2)`).
   - Rate-limited and debounced embed updates (prevents Discord API 429 rate limit errors).

3. **Multi-Step Ephemeral Configuration Wizard**:
   - Overcomes Discord's 5-input modal limit with an interactive ephemeral control panel.
   - Includes dropdowns for Activity Type (`AVA`, `Outlands`, `Both`), Side Tracking, and Food Scope.
   - Includes modals for IP, Duration, Food Count, Min Toolkit, Custom Roles, Header, Footer, and Thread Name.

4. **Organizer Permission Enforcement**:
   - Party creators, guild administrators, and users with a designated organizer role have management rights.
   - Normal members cannot edit or close parties, nor can they unregister other players.

5. **State Recovery & Reliability**:
   - SQLite for zero-config local development and testing; PostgreSQL ready for production.
   - Preserves party history, active registrations, and audit logs across bot restarts.
   - Clean shutdown handlers (`SIGINT`/`SIGTERM`) and idempotent startup recovery.

---

## Technology Stack

- **Runtime**: Node.js v22 (LTS) with TypeScript (ES2022).
- **Discord Framework**: `discord.js` v14.
- **Database & ORM**: PostgreSQL (Production) / SQLite (Development) with Prisma ORM.
- **Validation**: Zod (Schema validation for party inputs, duration parsers, role strings, and env).
- **Logging**: Pino with `pino-pretty` for structured JSON logs.
- **Testing**: Vitest with unit, integration, and E2E thread simulation test suites.

---

## Number-Based Registration System

The core registration mechanic operates inside the party's dedicated thread:

### Default Albion Online Role Mapping
| Number | Role Name | Default Capacity |
| :---: | :--- | :---: |
| **`1`** | Tank | 1 |
| **`2`** | Heal | 1 |
| **`3`** | DPS Cultist | 2 |
| **`4`** | DPS Mana | 1 |
| **`5`** | DPS Stalker | 1 |

*Note: Role numbers, names, and capacities are fully customizable per party during creation or editing.*

### Registration Commands (Inside Party Thread)
- **Register**: Mention the bot followed by the number:
  ```
  @Raid master 1
  ```
  *Response*: `✅ @User Registered for **Role 1 (Tank)**!`

- **Switch Role**: Mention the bot with a different role number:
  ```
  @Raid master 3
  ```
  *Response*: `🔄 @User Switched from **Tank** to **Role 3 (DPS Cultist)**!`

- **Unregister**: Mention the bot with `-`:
  ```
  @Raid master -
  ```
  *Response*: `✅ @User You have unregistered from **DPS Cultist**.`

- **Role Full Handling**:
  If a player tries to register for or switch to a full role:
  *Response*: `❌ @User Role **1 (Tank)** is already full (1/1). You remain registered as **DPS Cultist**.`

- **Safety & Noise Filtering**:
  Normal conversations in the thread (e.g. *"What tier skip set should I bring?"*) are ignored. Only messages explicitly tagging the bot (or using configured prefixes) are evaluated.

---

## Discord Slash Commands & Permissions

| Command | Description | Required Permission |
| :--- | :--- | :--- |
| `/party create` | Opens the interactive party creation wizard | Organizer / Admin |
| `/party edit [party_id]` | Opens modal to edit party requirements, duration, and roles | Organizer / Admin |
| `/party close [party_id]` | Closes registration, locking slots while preserving records | Organizer / Admin |
| `/party reopen [party_id]` | Reopens a closed party for registrations | Organizer / Admin |
| `/party status [party_id]` | Displays party requirements, registered members, and slots | Everyone |
| `/party cancel [party_id]` | Cancels a party with confirmation dialog | Organizer / Admin |
| `/party help` | Explains commands and the number registration system | Everyone |

---

## Discord Developer Portal Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Navigate to **Bot**:
   - Click **Add Bot** / **Reset Token** to copy your bot token (`DISCORD_TOKEN`).
   - Under **Privileged Gateway Intents**, enable:
     - ✅ **Message Content Intent** (*Required to read `@Raid master <number>` in threads*)
     - ✅ **Server Members Intent** (*Recommended for role checking*)
3. Navigate to **OAuth2 -> URL Generator**:
   - **Scopes**: `bot`, `applications.commands`
   - **Bot Permissions**:
     - *Send Messages*
     - *Send Messages in Threads*
     - *Create Public Threads*
     - *Manage Messages*
     - *Manage Threads*
     - *Embed Links*
     - *Read Message History*
     - *Use External Emojis*
4. Copy the generated invite URL and add the bot to your Discord server.
5. Copy your Application ID (`DISCORD_CLIENT_ID`) from the **General Information** page.

---

## Quickstart (Local Development)

### Prerequisites
- Node.js v20+ or v22+
- npm v10+

### 1. Clone & Install
```bash
git clone <repo-url>
cd bot
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory (refer to `.env.example`):
```env
DISCORD_TOKEN="YOUR_BOT_TOKEN_HERE"
DISCORD_CLIENT_ID="YOUR_APPLICATION_ID_HERE"
DISCORD_GUILD_ID="YOUR_TEST_GUILD_ID_HERE"   # Optional: provides instant slash command updates in your server
DATABASE_URL="file:./dev.db"
BOT_PREFIX="!"
BOT_NAME_ALIAS="Raid master"
LOG_LEVEL="info"
```

### 3. Initialize SQLite Database
```bash
npx prisma generate
npx prisma db push
```

### 4. Run Development Server
```bash
npm run dev
```

---

## PostgreSQL Production Setup & Migration

To run with PostgreSQL in production:

1. Update `DATABASE_URL` in `.env`:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/raidmaster?schema=public"
   ```

2. Switch the provider in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

3. Generate migration and deploy schema:
   ```bash
   npx prisma migrate dev --name init_postgresql
   npx prisma migrate deploy
   ```

---

## Production Deployment (Docker & PM2)

### Option A: Docker Compose (Recommended)
This launches PostgreSQL and the Raid Master bot together:

1. Configure `.env` with your `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
2. Start the stack:
   ```bash
   docker compose up -d --build
   ```
3. Check container logs:
   ```bash
   docker compose logs -f bot
   ```

### Option B: PM2 on Linux VPS
1. Install PM2:
   ```bash
   npm install -g pm2
   ```
2. Build the project:
   ```bash
   npm run build
   ```
3. Start the process:
   ```bash
   pm2 start dist/index.js --name raid-master-bot
   pm2 save
   pm2 startup
   ```

---

## Architecture & Database Schema

The database design uses strict foreign key relationships and indexation:

```mermaid
erDiagram
    Party ||--o{ PartyRole : "has"
    Party ||--o{ PartyRegistration : "tracks"
    Party ||--o{ AuditLog : "logs"
    PartyRole ||--o{ PartyRegistration : "slots"

    Party {
        string id PK
        string guildId
        string organizerId
        string announcementChannelId
        string announcementMessageId
        string threadId
        string title
        int ipRequirement
        string activityType
        int foodCount
        string foodRequirementScope
        int durationMinutes
        int minimumTrackingToolkit
        string sideTracking
        string status
        datetime createdAt
        datetime closedAt
    }

    PartyRole {
        string id PK
        string partyId FK
        int roleNumber
        string roleName
        int capacity
    }

    PartyRegistration {
        string id PK
        string partyId FK
        string roleId FK
        string userId
        datetime registeredAt
    }

    AuditLog {
        string id PK
        string guildId
        string partyId FK
        string actorId
        string action
        string previousValue
        string newValue
        datetime createdAt
    }
```

### Unique Constraints & Concurrency
- `@@unique([partyId, userId])` on `PartyRegistration`: Guarantees a member can only occupy one slot per party at any time.
- `@@unique([partyId, roleNumber])` on `PartyRole`: Ensures role numbers are unique within each party.
- Database Transactions (`prisma.$transaction`): Every registration, unregistration, role switch, and capacity check occurs in an atomic transaction to eliminate race conditions under concurrent requests.

---

## Automated Test Suite

The test suite contains 29 automated tests covering all 16 required scenarios:

```bash
npm run test
```

### Tested Scenarios:
1. Creating a party with valid fields.
2. Rejecting invalid IP, food count, duration, and role capacities.
3. Creating the announcement message and dedicated thread in Discord.
4. Registering a member using role number 1.
5. Registering a member using role number 3.
6. Removing a registration with `-`.
7. Switching roles successfully when the target role has capacity.
8. Rejecting a role switch when the target role is full, preserving the existing role.
9. Preventing duplicate registrations.
10. Preventing normal members from removing another player's registration.
11. Rejecting invalid role numbers with a list of valid choices.
12. Rejecting registrations in closed parties.
13. Enforcing organizer-only permissions for administrative actions.
14. Handling simultaneous registrations for the final available slot without exceeding capacity.
15. Recovering active party records after a bot restart.
16. Handling Discord API errors safely without creating duplicate parties or orphaned threads.
17. End-to-end message parsing and thread interaction simulation.

---

## Troubleshooting & FAQ

#### 1. Why does the bot not respond when members send `@Raid master 1` in the thread?
- Verify that **Message Content Intent** is enabled under the Bot tab in the [Discord Developer Portal](https://discord.com/developers/applications).
- Ensure the bot has `Send Messages in Threads` and `Read Message History` permissions in the announcement channel.

#### 2. How do slash commands appear immediately?
- Global slash commands can take up to an hour to propagate across Discord's CDN. Set `DISCORD_GUILD_ID` in your `.env` during development to register guild-specific slash commands instantly.

#### 3. How are Discord rate limits handled?
- Announcements are debounced (300ms) by `threadService.ts`. If multiple players register in rapid succession, the bot updates the database immediately and coalesces Discord message edits into a single request.

---

## File Tree

```
bot/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── discord.ts
│   │   └── env.ts
│   ├── database/
│   │   └── client.ts
│   ├── validation/
│   │   ├── partySchemas.ts
│   │   └── registrationSchemas.ts
│   ├── services/
│   │   ├── auditService.ts
│   │   ├── embedService.ts
│   │   ├── partyService.ts
│   │   ├── permissionService.ts
│   │   ├── registrationService.ts
│   │   └── threadService.ts
│   ├── commands/
│   │   └── party/
│   │       ├── index.ts
│   │       ├── create.ts
│   │       ├── edit.ts
│   │       ├── close.ts
│   │       ├── reopen.ts
│   │       ├── status.ts
│   │       ├── cancel.ts
│   │       └── help.ts
│   ├── events/
│   │   ├── ready.ts
│   │   ├── interactionCreate.ts
│   │   └── messageCreate.ts
│   └── utils/
│       ├── discordErrors.ts
│       └── logger.ts
└── tests/
    ├── helpers/
    │   └── testDb.ts
    ├── party.test.ts
    ├── registration.test.ts
    ├── permissions.test.ts
    ├── messageParsing.test.ts
    └── e2eEvents.test.ts
```
