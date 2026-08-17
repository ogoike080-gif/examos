# ExamOS 2026 — AI-Powered CBT Platform

A next-generation Computer-Based Testing platform with real-time AI proctoring, question authoring, and live monitoring.

---

## 🏗 Architecture

```
examos/
├── client/          # React + Vite frontend
├── server/          # Node.js + Express + Socket.io backend
├── electron/        # Electron desktop wrapper (kiosk mode)
└── docs/
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+ (or XAMPP with MySQL)
- Anthropic API key (for AI proctoring + question generation)

### 1. Create MySQL Database

```sql
CREATE DATABASE examos_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Configure Server

```bash
cd server
cp .env.example .env
```

Edit `.env`:
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=examos_db
ANTHROPIC_API_KEY=sk-ant-...your-key...
JWT_SECRET=your-random-secret-here
CLIENT_URL=http://localhost:3000
```

### 3. Install & Run

```bash
# Install all dependencies
cd examos
npm run install:all

# Start both server + client (development)
npm run dev
```

The server auto-creates all tables and seeds:
- Default admin: `admin@examos.ng` / `Admin@2026!`
- 10 subjects (Mathematics, English, Physics, Chemistry, Biology...)

### 4. Open the app

- **Web:** http://localhost:3000
- **Admin login:** admin@examos.ng / Admin@2026!

---

## 🖥 Desktop App (Electron)

```bash
# Development (requires client + server running)
npm run dev:desktop

# Build installer
npm run build:desktop
```

Desktop features:
- Kiosk mode (fullscreen lockdown during exam)
- Blocked keyboard shortcuts (F12, Ctrl+C, Alt+F4, etc.)
- Screenshot blocking
- Single instance enforcement
- Auto-updater

---

## 🚀 Deployment

### Web (Node.js hosting)

```bash
# Build frontend
npm run build

# Copy dist to server/public
cp -r client/dist server/public

# In server/index.js add static serving:
# app.use(express.static(path.join(__dirname, 'public')));

# Start production
NODE_ENV=production node server/index.js
```

### WizHosting / cPanel (Node.js App)
1. Upload `server/` folder
2. Set Node.js version to 18+
3. Set startup file: `index.js`
4. Add environment variables in cPanel
5. Upload built `client/dist` to `server/public/`

---

## 🔑 Roles & Access

| Role        | Access                                          |
|-------------|--------------------------------------------------|
| superadmin  | Full access — all features                      |
| admin       | Manage exams, candidates, view analytics        |
| examiner    | Create/edit questions and exams                 |
| proctor     | Live monitor only                               |
| candidate   | Take assigned exams, view own results           |

---

## 🤖 AI Features

All AI features use **Claude (claude-sonnet-4-20250514)**:

| Feature | Description |
|---------|-------------|
| AI Proctoring | Analyzes violations (face, gaze, audio, tab events) |
| Question Generation | Generates WAEC/JAMB/NECO-style questions by topic |
| Essay Grading | Marks essay responses against model answers |
| Session Analysis | Behavioral pattern analysis across full exam session |

Configure via `ANTHROPIC_API_KEY` in `.env`.

---

## 📡 Real-Time (Socket.io)

Events:
- `join-exam` — Candidate joins exam room
- `proctor-event` — Violation detected, broadcast to proctors
- `heartbeat` — Connectivity check every 10s
- `exam-submitted` — Notify proctors of submission
- `proctor-action` — Warn/pause/terminate candidate
- `broadcast-exam` — Admin broadcasts to all candidates

---

## 🗄 Database Schema

Tables:
- `users` — All users (admin, proctor, candidate)
- `subjects` — Exam subjects
- `questions` — Question bank with versions
- `exams` — Exam definitions + settings
- `exam_questions` — Junction: exam ↔ questions
- `exam_sessions` — Per-candidate session + answers
- `proctor_events` — Violation log with AI analysis
- `exam_centers` — Physical exam centers
- `audit_logs` — Full audit trail

---

## 🔒 Security Features

- JWT authentication with 24h expiry
- bcrypt password hashing (cost factor 12)
- Rate limiting: 200 req/15min (20 for auth)
- Helmet.js security headers
- CORS origin whitelist
- Electron: blocked keyboard shortcuts, kiosk mode, single instance
- Client: disabled right-click, copy/paste, context menu
- AI proctoring: face detection, gaze tracking, tab monitoring

---

## 📁 Key Files

```
server/
├── index.js              # Express + Socket.io server
├── models/db.js          # MySQL connection + schema
├── middleware/auth.js    # JWT middleware
├── routes/
│   ├── auth.js           # Login, register, profile
│   ├── exams.js          # Exam CRUD + sessions
│   ├── questions.js      # Question bank + AI generate
│   ├── proctor.js        # Violation logging + live data
│   ├── analytics.js      # Reports + dashboards
│   └── candidates.js     # Candidate management
├── socket/socketManager.js  # Real-time events
└── ai/questionGenerator.js  # Claude AI integration

client/src/
├── App.jsx               # Router + guards
├── store/index.js        # Zustand (auth, socket, exam state)
├── utils/api.js          # Axios API layer
├── pages/
│   ├── admin/            # Dashboard, Monitor, Builder, Bank, Analytics
│   └── candidate/        # Dashboard, ExamBrowser, Results
└── styles/globals.css    # Design system

electron/
├── main.js               # Electron main process
└── preload.js            # Secure IPC bridge
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Zustand, React Router 6 |
| Styling | CSS Modules, Syne + DM Sans + DM Mono |
| Real-time | Socket.io 4 |
| Backend | Node.js, Express 4 |
| Database | MySQL 8 (mysql2) |
| Auth | JWT + bcrypt |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Desktop | Electron 31 |
| Camera | react-webcam |

---

## 📞 Support

Built for Nigerian and African exam systems (WAEC, JAMB, NECO, Post-UTME).
Extendable to any CBT use case.

Default Admin: `admin@examos.ng` / `Admin@2026!`
**Change password immediately after first login.**
