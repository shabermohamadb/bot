# Discord Raid Master Bot

A production-ready Discord bot recreating the party creation, management, and thread-based role registration workflow designed for Albion Online groups (Avalonian Dungeons / AVA, Outlands Roam/Gank, and World Bosses).

The entire player experience is native to Discord: organizers create and configure parties via an interactive wizard, an announcement embed is published with an attached dedicated thread, and members register or switch roles simply by sending a role number (e.g. `@Raid master 1`).

---

## Table of Contents

- [Key Features](#key-features)
- [Web Analytics Dashboard](#web-analytics-dashboard)
- [Technology Stack](#technology-stack)
- [Render Web Service Deployment](#render-web-service-deployment)
- [Web API Endpoints & CSV Exports](#web-api-endpoints--csv-exports)
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

6. **Web Analytics & Host Leaderboard**:
   - Single-page application built with an Albion Online dark tactical theme (`#0B0E14` charcoal, `#D4AF37` gold, `#A0A5AA` silver).
   - Real-time aggregation of Total Parties Hosted, Active Runs, Unique Hosts, and Top Hosts.
   - Weekly (Monday–Sunday) and Monthly hosting reports with week-over-week / month-over-month % diffs, busiest day identification, and activity breakdown charts.
   - Leaderboard with Discord avatars (resolved via live Discord Gateway cache with fallback to Discord default avatar algorithm), Gold/Silver/Bronze badges, and tie-breaking.
   - Individual host profiles (`#host/:userId`) displaying hosting history, favorite activity, and activity distribution.
   - Searchable, filterable, and paginated party history with instant CSV data exports (`/api/export/parties.csv`, `/api/export/leaderboard.csv`).

---

## Web Analytics Dashboard

The platform includes a built-in web analytics suite that runs alongside the Discord bot inside a single Node.js runtime.

### Views & Capabilities:
- **Overview Dashboard (`#overview`)**:
  - **Metric Cards**: Total Parties Hosted, Active Parties, Unique Organizers, Top Host.
  - **Period Selector**: Switch between `This Week`, `This Month`, and `All Time` with real-time SVG activity charts.
  - **Top Hosts Podium**: Highlights the top 5 hosts with Discord avatars and hosting stats.
  - **Recent Parties**: Scannable list of the latest tracking runs with direct status pills (`OPEN`, `CLOSED`, `CANCELLED`).
- **Weekly Hosting Reports (`#weekly`)**:
  - Monday 00:00:00 through Sunday 23:59:59.999 UTC window calculation.
  - Offset navigation (`« Previous Week`, `Next Week »`) with ISO week numbering.
  - Comparative metrics vs preceding week with positive/negative delta badges.
  - Busiest day analysis and daily bar chart.
- **Monthly Hosting Reports (`#monthly`)**:
  - Calendar month (1st through 28th/30th/31st) boundary navigation.
  - Comparative metrics vs preceding month with percentage diffs.
  - Peak activity day and week identification.
- **Host Leaderboard (`#leaderboard`)**:
  - Filterable by Weekly, Monthly, and All-Time ranges.
  - Instant live host search and pagination.
  - Gold (`#D4AF37`), Silver (`#A0A5AA`), and Bronze (`#CD7F32`) rank badges.
  - One-click CSV export of ranked hosts.
- **Host Profile (`#host/:userId`)**:
  - User avatar and Discord tag.
  - Total parties hosted, total unique runs, and favorite activity (e.g. `AVA`, `Outlands`, `Both`).
  - History table of parties hosted by this organizer.
- **Party History (`#history`)**:
  - Search by party title or host user ID.
  - Filter by activity type (`All`, `AVA`, `Outlands`, `Both`) and status (`All`, `OPEN`, `CLOSED`, `CANCELLED`).
  - One-click full CSV export of party history records.

---

## Technology Stack

- **Runtime**: Node.js v22 (LTS) with TypeScript (ES2022).
- **Discord Framework**: `discord.js` v14 (Gateway client with Message Content Intent).
- **Web Server**: Express 5 with CORS, serving static assets and JSON REST endpoints.
- **Database & ORM**: PostgreSQL (Neon Serverless Postgres in production) / SQLite (Development) with Prisma ORM.
- **Database Indexes**: Indexed `organizerId`, `createdAt`, and compound `[organizerId, createdAt]` for fast reporting aggregations.
- **Deployment**: Render Web Services (`render.yaml`) with unified single-process architecture.
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

## Render Web Service Deployment

The application is structured to run as a **single Render Web Service** that hosts both the Discord Gateway client and the Express Web Analytics Dashboard in one process.

### Architecture Highlights
- **Single Process Efficiency**: Avoids paying for multiple services or background workers. Both the Discord bot gateway and the Express web server run under `node dist/index.js`.
- **In-Memory Discord Cache Sharing**: When web visitors browse the dashboard or leaderboard, the web service resolves Discord avatars and user tags directly from Discord.js's active Gateway cache, backed by an in-memory 1-hour TTL cache with fallback to Discord's deterministic default avatar algorithm.
- **Port & Host Binding**: Express listens on `0.0.0.0:${PORT}` where `PORT` is assigned dynamically by Render (defaults to 3000 locally).
- **Health Check Path**: Exposes `GET /health` responding with `{"status": "ok", "service": "discord-raid-master", "timestamp": "..."}` for Render's zero-downtime health probes.

### Option 1: Automatic Blueprint Deployment (`render.yaml`)
A turnkey [`render.yaml`](render.yaml) is included in the root directory:

1. Push your repository to GitHub or GitLab.
2. Log in to the [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Blueprint**.
4. Select your repository. Render automatically reads `render.yaml` and configures:
   - **Service Name**: `tracking-party-web`
   - **Environment**: `node`
   - **Build Command**: `npm install && npm run prisma:generate && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
5. Supply the required environment variables under **Environment Variables** in Render.

### Option 2: Manual Render Web Service Creation
1. In the Render Dashboard, click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the following fields:
   | Setting | Value |
   | :--- | :--- |
   | **Name** | `tracking-party-web` |
   | **Runtime** | `Node` |
   | **Branch** | `main` |
   | **Build Command** | `npm install && npm run prisma:generate && npm run build` |
   | **Start Command** | `npm start` |
   | **Health Check Path** | `/health` |
   | **Auto-Deploy** | `Yes` |

4. Add the following **Environment Variables** in Render:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Enables production optimizations |
   | `DATABASE_URL` | `postgresql://...` | Connection string to your PostgreSQL / Neon database |
   | `DISCORD_TOKEN` | `...` | Bot token from Discord Developer Portal |
   | `DISCORD_CLIENT_ID` | `...` | Application ID from Discord Developer Portal |
   | `DISCORD_GUILD_ID` | `...` | (Optional) Restricts instant slash command sync to this guild |
   | `APP_BASE_URL` | `https://your-service.onrender.com` | Public URL of your deployed Render service |
   | `SERVER_TIMEZONE` | `UTC` | Timezone for reporting date boundaries (defaults to UTC) |
   | `PORT` | *(Render sets this automatically)* | Port assigned by Render runtime |

5. Click **Create Web Service**. Render builds the TypeScript project, generates the Prisma client, and launches both the Discord bot and web dashboard.

---

## Web API Endpoints & CSV Exports

All analytics endpoints return standard JSON responses and support pagination, date offsets, and filtering:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Health check for Render zero-downtime deploys and load balancers. |
| `GET` | `/api/analytics/overview?period=week\|month\|all` | 4 metric cards, activity timeline, top hosts podium, and recent parties. |
| `GET` | `/api/reports/weekly?offset=0` | Monday–Sunday weekly summary, % diff vs previous week, and daily activity chart. |
| `GET` | `/api/reports/monthly?offset=0` | Calendar month summary, % diff vs previous month, and peak activity analysis. |
| `GET` | `/api/leaderboard?period=week\|month\|all&page=1&limit=20&search=` | Ranked hosts with avatar URLs, party counts, and tie-breaking. |
| `GET` | `/api/hosts/:userId` | Individual host stats, favorite activity type, and party history. |
| `GET` | `/api/parties?search=&activity=&status=&page=1&limit=15` | Searchable & filterable party history with status filters. |
| `GET` | `/api/export/parties.csv` | Download complete party history in CSV format. |
| `GET` | `/api/export/leaderboard.csv?period=week\|month\|all` | Download ranked leaderboard data in CSV format. |

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

