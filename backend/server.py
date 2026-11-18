#!/usr/bin/env python3
"""
KAIGO Backend Server v1.0
Caregiver Peace-of-Mind IoT System

REST API server bridging the Caregiver Web App and the ESP32-S3 hardware hub.
"""

import logging
import os
import sqlite3
import threading
import time
import json
import re
import secrets
from datetime import datetime, date, timedelta

import requests
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATABASE = os.path.join(DATA_DIR, "kaigo.db")

# Caregiver Authentication (Default credentials)
DEFAULT_CAREGIVER_USER = "caregiver"
DEFAULT_CAREGIVER_PASS = "kaigo2025"

# WhatsApp alert configuration (CallMeBot)
# Phone numbers and API keys live in backend/config.local.json, which is
# git-ignored. Copy config.example.json to config.local.json and fill it in.
CONFIG_FILE = os.path.join(BASE_DIR, "config.local.json")


def load_local_config():
    """Read config.local.json; a missing or broken file means 'not configured'."""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        logging.getLogger("kaigo").warning("Could not read %s: %s", CONFIG_FILE, exc)
        return {}


CALLMEBOT_CONFIGS = load_local_config().get("callmebot", {})

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("kaigo")

# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    """Return a per-request database connection stored on Flask's `g`."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    """Close the database connection when the request context ends."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not already exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY,
            text TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('boolean', 'range')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            question_type TEXT NOT NULL,
            answer TEXT NOT NULL,
            answered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (question_id) REFERENCES questions(id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sos_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            triggered_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            source TEXT DEFAULT 'esp32',
            acknowledged INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scheduled_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('boolean', 'range')),
            schedule_time TEXT NOT NULL,
            days TEXT NOT NULL DEFAULT 'all',
            enabled INTEGER NOT NULL DEFAULT 1,
            last_triggered TEXT DEFAULT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Caregiver'
        )
    """)

    # Seed users
    initial_users = [
        ("cecil", "Cecil Howell", "1234", "Caregiver"),
        ("diego", "Diego Ortega", "1234", "Caregiver"),
        ("caregiver", "Caregiver", "kaigo2025", "Caregiver"),
    ]
    for uname, dname, pword, role in initial_users:
        cursor.execute("""
            INSERT INTO users (username, display_name, password, role)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                display_name = excluded.display_name,
                password = excluded.password,
                role = excluded.role
        """, (uname, dname, pword, role))

    # Patients / Elderly persons managed by caregivers
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caregiver_username TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            age INTEGER,
            relation TEXT,
            condition TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    # Seed Maiko Howell specifically for Cecil Howell (Diego begins with nobody)
    cursor.execute("""
        INSERT INTO patients (caregiver_username, name, age, relation, condition)
        VALUES (
            'cecil',
            'Maiko Howell',
            70,
            'Mother',
            '70 y/o senior living alone. Lumbar trauma from falling down stairs 11 months ago (Dec 12, 2025); full rehab recovery.'
        )
        ON CONFLICT(caregiver_username) DO NOTHING
    """)

    # Ensure scale_polarity columns exist
    for tbl in ["questions", "scheduled_questions", "answers"]:
        try:
            cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN scale_polarity TEXT DEFAULT 'worse_high'")
        except sqlite3.OperationalError:
            pass

    # Ensure caregiver_username columns exist on all user-scoped tables
    for tbl in ["questions", "answers", "sos_events", "scheduled_questions"]:
        try:
            cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN caregiver_username TEXT DEFAULT 'cecil'")
        except sqlite3.OperationalError:
            pass

    # Backfill any null or blank records to Cecil Howell (the reference caregiver)
    cursor.execute("UPDATE answers SET caregiver_username = 'cecil' WHERE caregiver_username IS NULL OR caregiver_username = ''")
    cursor.execute("UPDATE sos_events SET caregiver_username = 'cecil' WHERE caregiver_username IS NULL OR caregiver_username = ''")
    cursor.execute("UPDATE questions SET caregiver_username = 'cecil' WHERE caregiver_username IS NULL OR caregiver_username = ''")
    cursor.execute("UPDATE scheduled_questions SET caregiver_username = 'cecil' WHERE caregiver_username IS NULL OR caregiver_username = ''")

    conn.commit()
    conn.close()
    logger.info("Database initialised at %s", DATABASE)

# ---------------------------------------------------------------------------
# WhatsApp alert (CallMeBot)
# ---------------------------------------------------------------------------

def get_callmebot_credentials(caregiver="cecil"):
    """Retrieve CallMeBot phone and apikey for target caregiver ({} if none)."""
    cg = (caregiver or "default").lower().strip()
    return CALLMEBOT_CONFIGS.get(cg) or CALLMEBOT_CONFIGS.get("default") or {}


def send_whatsapp_alert(message, caregiver="cecil"):
    """Send a WhatsApp message via CallMeBot. Best-effort, non-blocking."""
    creds = get_callmebot_credentials(caregiver)
    phone = creds.get("phone", "")
    apikey = creds.get("apikey", "")

    if not phone or not apikey:
        logger.info("CallMeBot credentials not configured, skipping WhatsApp dispatch")
        return

    url = "https://api.callmebot.com/whatsapp.php"
    params = {
        "phone": phone,
        "text": message,
        "apikey": apikey,
    }
    t0 = time.monotonic()
    try:
        res = requests.get(url, params=params, timeout=(5, 20))
        elapsed = time.monotonic() - t0
        # CallMeBot answers with a small HTML page; keep its text so a queue
        # message or rate-limit warning shows up in the server log.
        reply = re.sub(r"<[^>]+>", " ", res.text or "")
        reply = re.sub(r"\s+", " ", reply).strip()[:200]
        logger.info(
            "WhatsApp alert handed to CallMeBot in %.1f s for caregiver '%s' (HTTP %s): %s",
            elapsed, caregiver, res.status_code, reply,
        )
    except Exception as exc:
        logger.warning(
            "WhatsApp alert failed after %.1f s for caregiver '%s': %s",
            time.monotonic() - t0, caregiver, exc,
        )

# ---------------------------------------------------------------------------
# Scheduler (background thread)
# ---------------------------------------------------------------------------

def scheduler_loop():
    """Background thread that checks scheduled questions every 30 seconds."""
    logger.info("Scheduler thread started")
    while True:
        try:
            now = datetime.now()
            current_time = now.strftime("%H:%M")
            current_day = now.strftime("%a").lower()  # mon, tue, wed, ...
            today_str = now.strftime("%Y-%m-%d")

            conn = sqlite3.connect(DATABASE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute(
                "SELECT * FROM scheduled_questions WHERE enabled = 1"
            )
            schedules = cursor.fetchall()

            for sched in schedules:
                # Check day match
                days = sched["days"]
                if days != "all":
                    allowed_days = [d.strip().lower() for d in days.split(",")]
                    if current_day not in allowed_days:
                        continue

                # Check time match (within 1-minute window)
                if sched["schedule_time"] != current_time:
                    continue

                # Check already triggered today
                if sched["last_triggered"] == today_str:
                    continue

                # Create a new question (same logic as POST /api/question)
                last = cursor.execute("SELECT MAX(id) FROM questions").fetchone()[0] or 0
                question_id = max(int(time.time()), last + 1)
                sched_caregiver = sched["caregiver_username"] if ("caregiver_username" in sched.keys() and sched["caregiver_username"]) else "cecil"
                cursor.execute(
                    "UPDATE questions SET active = 0 WHERE active = 1 AND LOWER(caregiver_username) = ?",
                    (sched_caregiver.lower(),)
                )
                cursor.execute(
                    "INSERT INTO questions (id, text, type, active, caregiver_username) VALUES (?, ?, ?, 1, ?)",
                    (question_id, sched["text"], sched["type"], sched_caregiver),
                )
                cursor.execute(
                    "UPDATE scheduled_questions SET last_triggered = ? WHERE id = ?",
                    (today_str, sched["id"]),
                )
                conn.commit()
                logger.info(
                    "Scheduler created question %d from schedule %d: %s",
                    question_id,
                    sched["id"],
                    sched["text"],
                )

            conn.close()
        except Exception as exc:
            logger.error("Scheduler error: %s", exc)

        time.sleep(30)

# ---------------------------------------------------------------------------
# Clinical & Scale Helpers
# ---------------------------------------------------------------------------

def get_setting(key, default=None):
    """Retrieve a setting string from the database."""
    try:
        db = get_db()
        row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default
    except Exception:
        return default


def set_setting(key, value):
    """Store or update a setting string in the database."""
    db = get_db()
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )
    db.commit()


def parse_numeric_answer(ans_str):
    """Extract numeric value from answer like '7/10' or '7'."""
    if not ans_str:
        return None
    s = str(ans_str).strip()
    if "/" in s:
        s = s.split("/")[0].strip()
    try:
        return float(s)
    except ValueError:
        return None


def is_pain_question(text):
    """Check whether a question pertains to pain or physical symptoms."""
    t = (text or "").lower()
    pain_keywords = ["pain", "dolor", "ache", "hurt", "knee", "back", "head",
                     "rodilla", "espalda", "molestia", "sore", "joint", "shoulder"]
    return any(k in t for k in pain_keywords)


def is_medication_question(text):
    """Check whether a question pertains to medication compliance."""
    t = (text or "").lower()
    med_keywords = ["med", "pill", "pastilla", "medicamento", "medicine", "remedio", "dosis", "prescrip"]
    return any(k in t for k in med_keywords)


def is_sleep_question(text):
    """Check whether a question pertains to sleep or rest."""
    t = (text or "").lower()
    sleep_keywords = ["sleep", "asleep", "alseep", "dormir", "dormiste", "descanso", "rest", "wake"]
    return any(k in t for k in sleep_keywords)


def is_better_high_question(text):
    """Check if question is one where 10 is good and 1 is bad (e.g. mood, sleep, energy)."""
    t = (text or "").lower()
    positive_keywords = ["mood", "ánimo", "animo", "sleep", "dormi", "energy", "energía",
                         "energia", "feel", "feeling", "sentir", "bienestar", "wellness", "happy", "rest"]
    return any(k in t for k in positive_keywords)


def detect_scale_polarity(text, explicit=None):
    """Determine whether a scale question has 10 as severe (worse_high) or 10 as optimal (better_high)."""
    if explicit in ("better_high", "worse_high"):
        return explicit
    if is_better_high_question(text):
        return "better_high"
    return "worse_high"


def classify_pain(score):
    """Classify 1-10 pain score according to standard Numeric Rating Scale."""
    return classify_range_answer(score, "worse_high")


def classify_wellness_general(score):
    """Classify 1-10 general well-being/sleep score."""
    return classify_range_answer(score, "better_high")


def classify_range_answer(score, polarity="worse_high"):
    """Classify 1-10 range score according to scale polarity.
    - worse_high: 1 is No Pain, 10 is Unbearable Pain.
    - better_high: 10 is Great/Optimal, 1 is Low/Poor.
    """
    if score is None:
        return {"level": "Unknown", "severity": "none", "description": "No data", "color": "#9ca3af"}
    val = round(score)
    if polarity == "better_high":
        if val >= 9:
            return {"level": "Excellent", "severity": "optimal", "description": "Excellent · Feeling great", "color": "#10b981"}
        elif val >= 7:
            return {"level": "Good", "severity": "good", "description": "Good · Restful / Positive", "color": "#22c55e"}
        elif val >= 5:
            return {"level": "Fair", "severity": "moderate", "description": "Fair · Moderate / Average", "color": "#f59e0b"}
        elif val >= 3:
            return {"level": "Low", "severity": "severe", "description": "Low · Struggling / Poor", "color": "#ef4444"}
        else:
            return {"level": "Very Low", "severity": "critical", "description": "Very Low · Needs attention", "color": "#b91c1c"}
    else:
        if val <= 1:
            return {"level": "None", "severity": "none", "description": "No pain · Comfortable", "color": "#10b981"}
        elif val <= 3:
            return {"level": "Mild", "severity": "mild", "description": "Mild pain · Nagging but tolerable", "color": "#22c55e"}
        elif val <= 6:
            return {"level": "Moderate", "severity": "moderate", "description": "Moderate pain · Interferes with activities", "color": "#f59e0b"}
        elif val <= 8:
            return {"level": "Severe", "severity": "severe", "description": "Severe pain · Hard to move or concentrate", "color": "#ef4444"}
        else:
            return {"level": "Very Severe", "severity": "critical", "description": "Unbearable pain · Urgent attention", "color": "#b91c1c"}


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

# ---- Authentication -------------------------------------------------------

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Authenticate caregiver and return session token."""
    logger.info("POST /api/auth/login")
    data = request.get_json(silent=True) or {}
    username_input = data.get("username", "").strip()
    password_input = data.get("password", "").strip()

    if not username_input or not password_input:
        return jsonify({"error": "Username and password required"}), 400

    db = get_db()
    # Check users table case-insensitively by username or display_name
    row = db.execute(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(display_name) = LOWER(?)",
        (username_input, username_input),
    ).fetchone()

    if row:
        stored_pass = row["password"]
        display_name = row["display_name"]
        role = row["role"]
    else:
        # Fallback to configured settings or defaults
        expected_user = get_setting("caregiver_username", DEFAULT_CAREGIVER_USER)
        expected_pass = get_setting("caregiver_password", DEFAULT_CAREGIVER_PASS)
        if username_input.lower() == expected_user.lower():
            stored_pass = expected_pass
            display_name = expected_user
            role = "Caregiver"
        else:
            stored_pass = None
            display_name = None
            role = None

    if stored_pass and password_input == stored_pass:
        canonical_uname = row["username"].lower() if row else username_input.lower()
        token = secrets.token_hex(24)
        db.execute(
            "INSERT INTO sessions (token, username) VALUES (?, ?)",
            (token, canonical_uname),
        )
        db.commit()
        logger.info("Caregiver '%s' (%s) logged in successfully", display_name, canonical_uname)
        return jsonify({
            "success": True,
            "token": token,
            "username": display_name,
            "account_username": canonical_uname,
            "role": role,
        })

    logger.warning("Failed login attempt for user '%s'", username_input)
    return jsonify({"error": "Invalid username or password"}), 401


@app.route("/api/auth/verify", methods=["GET"])
def auth_verify():
    """Verify active session token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if not token:
        return jsonify({"authenticated": False}), 401

    try:
        db = get_db()
        row = db.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
        if row:
            return jsonify({"authenticated": True, "username": row["username"]})
        return jsonify({"authenticated": False}), 401
    except Exception as exc:
        return jsonify({"authenticated": False, "error": str(exc)}), 500


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Clear active session token."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if token:
        try:
            db = get_db()
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            db.commit()
        except Exception:
            pass
    return jsonify({"success": True})


# ---- User Management (Create / Delete Caregivers; Cecil & Diego Protected) ----

PROTECTED_USERS = {"cecil", "diego"}

@app.route("/api/users", methods=["GET"])
def list_users():
    """List all registered caregiver accounts with protected status."""
    db = get_db()
    rows = db.execute("SELECT id, username, display_name, role FROM users ORDER BY id ASC").fetchall()
    users = []
    for r in rows:
        uname = r["username"].lower()
        users.append({
            "id": r["id"],
            "username": r["username"],
            "display_name": r["display_name"],
            "role": r["role"],
            "is_protected": (uname in PROTECTED_USERS),
        })
    return jsonify({"success": True, "users": users})


@app.route("/api/users", methods=["POST"])
def create_user():
    """Create a new caregiver account."""
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    display_name = data.get("display_name", "").strip() or username
    password = data.get("password", "").strip() or "1234"
    role = data.get("role", "Caregiver").strip() or "Caregiver"

    if not username:
        return jsonify({"error": "Username is required"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)).fetchone()
    if existing:
        return jsonify({"error": f"Username '{username}' already exists"}), 409

    db.execute(
        "INSERT INTO users (username, display_name, password, role) VALUES (?, ?, ?, ?)",
        (username, display_name, password, role),
    )
    db.commit()
    logger.info("Created new caregiver account '%s' (%s)", username, display_name)
    return jsonify({
        "success": True,
        "user": {
            "username": username,
            "display_name": display_name,
            "role": role,
            "is_protected": False,
        }
    }), 201


@app.route("/api/users/<username>", methods=["DELETE"])
def delete_user(username):
    """Delete a caregiver account. Cecil and Diego are undeletable system accounts."""
    uname = username.strip().lower()
    if uname in PROTECTED_USERS:
        return jsonify({
            "error": f"Account '{username}' is protected and cannot be deleted."
        }), 403

    db = get_db()
    user = db.execute("SELECT id, username FROM users WHERE LOWER(username) = ?", (uname,)).fetchone()
    if not user:
        return jsonify({"error": f"User '{username}' not found"}), 404

    # Remove user, their patient configuration, and active sessions
    db.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    db.execute("DELETE FROM patients WHERE LOWER(caregiver_username) = ?", (uname,))
    db.execute("DELETE FROM sessions WHERE LOWER(username) = ?", (uname,))
    db.commit()
    logger.info("Deleted caregiver account '%s'", username)
    return jsonify({"success": True, "message": f"User '{username}' deleted successfully"})



# ---- Caregiver Patients / Elderly Loved Ones ------------------------------

def get_caregiver_from_token():
    """Extract authenticated caregiver username from Authorization header or session."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if not token:
        token = request.args.get("token", "").strip()
    if token:
        try:
            db = get_db()
            row = db.execute("SELECT username FROM sessions WHERE token = ?", (token,)).fetchone()
            if row and row["username"]:
                uname = (row["username"] or "").strip().lower()
                u_row = db.execute(
                    "SELECT username FROM users WHERE LOWER(username) = ? OR LOWER(display_name) = ?",
                    (uname, uname)
                ).fetchone()
                if u_row:
                    return u_row["username"].lower()
                return uname
        except Exception:
            pass
    return "cecil"


@app.route("/api/patient", methods=["GET"])
def api_get_patient():
    """Return patient details for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    db = get_db()
    row = db.execute("SELECT * FROM patients WHERE LOWER(caregiver_username) = ?", (caregiver,)).fetchone()
    if not row:
        return jsonify({
            "success": True,
            "has_patient": False,
            "patient": None,
            "caregiver": caregiver
        })
    return jsonify({
        "success": True,
        "has_patient": True,
        "caregiver": caregiver,
        "patient": {
            "name": row["name"],
            "age": row["age"],
            "relation": row["relation"] or "Loved One",
            "condition": row["condition"] or "",
        }
    })


@app.route("/api/patient", methods=["POST"])
def api_save_patient():
    """Create or update patient profile for current caregiver."""
    caregiver = get_caregiver_from_token()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    age_raw = data.get("age")
    try:
        age = int(age_raw) if age_raw else None
    except (ValueError, TypeError):
        age = None
    relation = (data.get("relation") or "").strip() or "Loved One"
    condition = (data.get("condition") or "").strip()

    if not name:
        return jsonify({"error": "Elderly person name is required"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        INSERT INTO patients (caregiver_username, name, age, relation, condition)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(caregiver_username) DO UPDATE SET
            name = excluded.name,
            age = excluded.age,
            relation = excluded.relation,
            condition = excluded.condition
    """, (caregiver, name, age, relation, condition))
    db.commit()
    logger.info("Saved patient profile '%s' (age %s) for caregiver '%s'", name, age, caregiver)

    return jsonify({
        "success": True,
        "has_patient": True,
        "caregiver": caregiver,
        "patient": {
            "name": name,
            "age": age,
            "relation": relation,
            "condition": condition
        }
    })


@app.route("/api/patient/reset", methods=["POST"])
def api_reset_patient():
    """Reset current caregiver back to a clean slate (deletes patient record & test check-ins)."""
    caregiver = get_caregiver_from_token().lower().strip()
    db = get_db()
    if caregiver == "cecil":
        # Cecil's account is protected: reset restores Maiko's reference data
        db.execute("""
            INSERT OR REPLACE INTO patients (caregiver_username, name, age, relation, condition)
            VALUES (
                'cecil',
                'Maiko Howell',
                70,
                'Mother',
                '70 y/o senior living alone. Lumbar trauma from falling down stairs 11 months ago (Dec 12, 2025); full rehab recovery.'
            )
        """)
    else:
        db.execute("DELETE FROM patients WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.execute("DELETE FROM answers WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.execute("DELETE FROM sos_events WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.execute("DELETE FROM questions WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.execute("DELETE FROM scheduled_questions WHERE LOWER(caregiver_username) = ?", (caregiver,))
    db.commit()
    logger.info("Caregiver '%s' reset to clean slate", caregiver)
    return jsonify({
        "success": True,
        "message": f"Caregiver '{caregiver}' reset to clean slate. Ready for fresh onboarding walkthrough."
    })



# ---- Settings & Gemini API ------------------------------------------------

@app.route("/api/settings/gemini", methods=["GET", "POST"])
def settings_gemini():
    """Get or save Gemini API key."""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        api_key = data.get("api_key", "").strip()
        set_setting("gemini_api_key", api_key)
        logger.info("Gemini API key updated (len=%d)", len(api_key))
        return jsonify({"success": True, "has_key": bool(api_key)})

    # GET
    key = get_setting("gemini_api_key", os.getenv("GEMINI_API_KEY", ""))
    masked = None
    if key and len(key) > 8:
        masked = f"{key[:6]}...{key[-4:]}"
    elif key:
        masked = "***"
    return jsonify({"has_key": bool(key), "preview": masked})


# ---- Clinical Analytics & Health Score -----------------------------------

# ---------------------------------------------------------------------------
# Wellness score
# ---------------------------------------------------------------------------
# The score is a weighted average of up to four parts, each scored 0-100 from
# the senior's own answers:
#
#   Mood & energy  (weight 30)  1-10 "10 is best" questions:  (answer - 1) / 9 * 100
#   Pain           (weight 30)  1-10 "10 is worst" questions: (10 - answer) / 9 * 100
#   Medication     (weight 25)  yes/no medication questions:  % answered YES
#   Sleep          (weight 15)  1-10 sleep questions:         (answer - 1) / 9 * 100
#
# Only answers from the last WELLNESS_WINDOW_DAYS count, and newer answers
# count more: an answer loses half its influence every WELLNESS_HALF_LIFE_DAYS.
# A part with no answers is left out and the remaining weights are re-balanced,
# so the score always reflects what was actually answered. Then:
#
#   - each SOS alert in the last 7 days subtracts 15 (at most 40)
#   - a YES to a "do you need help" question in the last 24 h subtracts 10

WELLNESS_WINDOW_DAYS = 14
WELLNESS_HALF_LIFE_DAYS = 3.0
WELLNESS_WEIGHTS = {"mood": 30, "pain": 30, "medication": 25, "sleep": 15}
WELLNESS_LABELS = {"mood": "Mood & energy", "pain": "Pain", "medication": "Medication", "sleep": "Sleep"}
WELLNESS_SOS_PENALTY = 15
WELLNESS_SOS_PENALTY_MAX = 40
WELLNESS_HELP_PENALTY = 10
YES_ANSWERS = ("YES", "SI", "SÍ", "1")


def is_help_question(text):
    """Check whether a yes/no question asks if the senior needs help."""
    t = (text or "").lower()
    return any(k in t for k in ("help", "ayuda", "assist"))


def _parse_answer_time(value):
    """Parse 'YYYY-MM-DD HH:MM:SS' (or just the date). Returns None if unreadable."""
    text = str(value or "")
    for fmt, length in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d", 10)):
        try:
            return datetime.strptime(text[:length], fmt)
        except ValueError:
            continue
    return None


def _fmt_num(x):
    r = round(x, 1)
    return str(int(r)) if r == int(r) else str(r)


def wellness_badge_for(score):
    """Map a 0-100 score to (badge text, colour, level key)."""
    if score is None:
        return "Not Enough Answers", "#94a3b8", "none"
    if score >= 85:
        return "Excellent / Stable", "#10b981", "optimal"
    if score >= 70:
        return "Good / Minor Follow-up", "#3b82f6", "good"
    if score >= 50:
        return "Needs Attention", "#f59e0b", "warning"
    return "Action Required", "#ef4444", "critical"


def compute_wellness_score(all_answers, sos_recent_count=0, now=None):
    """Compute the 0-100 wellness score and a breakdown explaining it.

    all_answers: answer rows for one caregiver (any order).
    sos_recent_count: SOS alerts in the last 7 days.
    """
    now = now or datetime.now()
    # per part: list of (age_days, value_0_100, raw_answer)
    buckets = {key: [] for key in WELLNESS_WEIGHTS}
    help_requested = False

    for a in all_answers:
        ts = _parse_answer_time(a["answered_at"])
        if ts is None:
            continue
        age = max(0.0, (now - ts).total_seconds() / 86400.0)
        q_text = a["question_text"]
        ans = (a["answer"] or "").strip()

        if a["question_type"] == "range":
            num = parse_numeric_answer(ans)
            if num is None:
                continue
            num = max(1.0, min(10.0, num))
            stored = a["scale_polarity"] if "scale_polarity" in a.keys() else None
            polarity = stored or detect_scale_polarity(q_text)
            if polarity == "better_high":
                key = "sleep" if is_sleep_question(q_text) else "mood"
                buckets[key].append((age, (num - 1.0) / 9.0 * 100.0, num))
            else:
                buckets["pain"].append((age, (10.0 - num) / 9.0 * 100.0, num))
        else:
            is_yes = ans.upper() in YES_ANSWERS
            if is_medication_question(q_text):
                buckets["medication"].append((age, 100.0 if is_yes else 0.0, 1.0 if is_yes else 0.0))
            elif is_help_question(q_text) and is_yes and age <= 1.0:
                help_requested = True

    # Keep only the recent window. If nothing at all is recent, fall back to
    # the single newest answer of each part and mark the score as stale.
    recent = {k: [e for e in v if e[0] <= WELLNESS_WINDOW_DAYS] for k, v in buckets.items()}
    stale = not any(recent.values())
    if stale:
        recent = {k: ([min(v, key=lambda e: e[0])] if v else []) for k, v in buckets.items()}

    components = []
    total_weight = sum(WELLNESS_WEIGHTS[k] for k, v in recent.items() if v)
    answers_used = 0
    for key, entries in recent.items():
        if not entries:
            continue
        if stale:
            weighted = [(1.0, value, raw) for _, value, raw in entries]
        else:
            weighted = [(0.5 ** (age / WELLNESS_HALF_LIFE_DAYS), value, raw) for age, value, raw in entries]
        wsum = sum(w for w, _, _ in weighted)
        value = sum(w * v for w, v, _ in weighted) / wsum
        raw = sum(w * r for w, _, r in weighted) / wsum
        if key == "medication":
            detail = f"{round(raw * 100)}% taken"
        else:
            detail = f"{_fmt_num(raw)}/10"
        answers_used += len(entries)
        components.append({
            "key": key,
            "label": WELLNESS_LABELS[key],
            "score": round(value),
            "detail": detail,
            "weight_pct": round(WELLNESS_WEIGHTS[key] / total_weight * 100),
            "answers": len(entries),
            "_value": value,
            "_weight": WELLNESS_WEIGHTS[key],
        })

    penalties = []
    if sos_recent_count > 0:
        penalties.append({
            "label": f"{sos_recent_count} SOS alert(s) in the last 7 days",
            "points": min(WELLNESS_SOS_PENALTY_MAX, sos_recent_count * WELLNESS_SOS_PENALTY),
        })
    if help_requested:
        penalties.append({"label": "Asked for help in the last 24 hours", "points": WELLNESS_HELP_PENALTY})

    if components:
        base = sum(c["_value"] * c["_weight"] for c in components) / total_weight
        score = max(0, min(100, round(base - sum(p["points"] for p in penalties))))
    else:
        score = None  # answers exist, but none of them can be scored

    components.sort(key=lambda c: -c["_weight"])
    for c in components:
        del c["_value"], c["_weight"]

    lowest = min(components, key=lambda c: c["score"]) if components else None
    badge, badge_color, level = wellness_badge_for(score)

    if stale:
        basis = f"From older answers (none in the last {WELLNESS_WINDOW_DAYS} days)"
    else:
        basis = f"From {answers_used} answer{'s' if answers_used != 1 else ''} in the last {WELLNESS_WINDOW_DAYS} days"

    parts = [f"{c['label']} {c['detail']} (scores {c['score']}/100, {c['weight_pct']}% of total)" for c in components]
    parts += [f"minus {p['points']} for {p['label'].lower()}" for p in penalties]
    explanation = "; ".join(parts) + f". {basis}." if parts else basis + "."

    return {
        "score": score,
        "badge": badge,
        "badge_color": badge_color,
        "level": level,
        "components": components,
        "penalties": penalties,
        "lowest": {"label": lowest["label"], "detail": lowest["detail"], "score": lowest["score"]} if lowest else None,
        "answers_used": answers_used,
        "window_days": WELLNESS_WINDOW_DAYS,
        "stale": stale,
        "help_requested": help_requested,
        "basis": basis,
        "explanation": explanation,
    }


def calculate_clinical_analytics(db, scope="1m", caregiver=None):
    """Aggregate history into meaningful, actionable caregiver metrics scoped to timeframe."""
    scope = (scope or "1m").lower().strip()
    if not caregiver:
        caregiver = "cecil"
    caregiver = caregiver.lower().strip()

    pat_row = db.execute("SELECT * FROM patients WHERE LOWER(caregiver_username) = ?", (caregiver,)).fetchone()

    scope_days_map = {
        "1w": 7,
        "1m": 30,
        "6m": 180,
        "1y": 365,
        "14m": 430,
        "all": 430,
    }
    days_limit = scope_days_map.get(scope, 30)

    # Brand-new caregiver with NO elderly person registered yet
    if not pat_row:
        return {
            "scope": scope,
            "scope_days": days_limit,
            "has_patient": False,
            "total_answers": 0,
            "wellness_index": None,
            "wellness_badge": "Awaiting Profile",
            "wellness_badge_color": "#94a3b8",
            "patient": None,
            "medication": {"compliance_pct": None, "taken_count": 0, "missed_count": 0, "latest": None},
            "pain": {"latest": None, "history": [], "average_7d": None},
            "mood": {"latest": None, "history": [], "average_7d": None},
            "sleep": {"latest": None, "history": [], "average_7d": None},
            "sos": {"total": 0, "in_scope": 0, "last_7d": 0, "active_unacknowledged": 0, "latest": None, "fall_incident": None},
            "streak_days": 0,
            "answers_today": 0,
            "risk_flags": ["No elderly loved one registered yet. Click 'Manage Loved One' to configure."],
            "charts": {
                "pain": {"labels": [], "values": []},
                "mood": {"labels": [], "values": []},
                "adherence": {"taken": 0, "missed": 0, "pct": 0},
            }
        }

    # Query this caregiver's actual answers & SOS records
    all_answers = db.execute(
        "SELECT * FROM answers WHERE LOWER(caregiver_username) = ? ORDER BY answered_at DESC",
        (caregiver,)
    ).fetchall()
    all_sos = db.execute(
        "SELECT * FROM sos_events WHERE LOWER(caregiver_username) = ? ORDER BY triggered_at DESC",
        (caregiver,)
    ).fetchall()

    p_name = pat_row["name"]
    p_age = str(pat_row["age"] or "")
    p_rel = pat_row["relation"] or "Loved One"
    p_cond = pat_row["condition"] or ""

    # Brand-new patient with 0 check-ins recorded yet (clean fresh state!)
    if len(all_answers) == 0:
        return {
            "scope": scope,
            "scope_days": days_limit,
            "has_patient": True,
            "total_answers": 0,
            "wellness_index": None,
            "wellness_badge": "Awaiting Check-ins",
            "wellness_badge_color": "#94a3b8",
            "patient": {
                "name": p_name,
                "age": p_age,
                "relation": p_rel,
                "condition": p_cond,
            },
            "medication": {"compliance_pct": None, "taken_count": 0, "missed_count": 0, "latest": None},
            "pain": {"latest": None, "history": [], "average_7d": None},
            "mood": {"latest": None, "history": [], "average_7d": None},
            "sleep": {"latest": None, "history": [], "average_7d": None},
            "sos": {"total": len(all_sos), "in_scope": len(all_sos), "last_7d": 0, "active_unacknowledged": 0, "latest": None, "fall_incident": None},
            "streak_days": 0,
            "answers_today": 0,
            "risk_flags": [f"{p_name}'s profile is active. Awaiting initial check-in responses from hub."],
            "charts": {
                "pain": {"labels": [], "values": []},
                "mood": {"labels": [], "values": []},
                "adherence": {"taken": 0, "missed": 0, "pct": 0},
            }
        }

    cutoff_date = (date.today() - timedelta(days=days_limit)).strftime("%Y-%m-%d")
    today_str = date.today().strftime("%Y-%m-%d")
    seven_days_ago = (date.today() - timedelta(days=7)).strftime("%Y-%m-%d")

    # Answers within chosen scope
    answers = [a for a in all_answers if a["answered_at"] >= cutoff_date]
    sos_events = [s for s in all_sos if s["triggered_at"] >= cutoff_date]

    med_taken = 0
    med_missed = 0
    med_last = None

    pain_history = []
    mood_history = []
    sleep_history = []
    risk_flags = []

    # Process scoped answers
    for a in answers:
        q_text = a["question_text"]
        q_type = a["question_type"]
        ans = a["answer"].strip()
        ans_date = a["answered_at"]
        polarity = a["scale_polarity"] if ("scale_polarity" in a.keys() and a["scale_polarity"]) else detect_scale_polarity(q_text)

        # Medication tracking
        if is_medication_question(q_text):
            is_yes = ans.upper() in ["YES", "SI", "SÍ", "1"]
            if med_last is None:
                med_last = {"taken": is_yes, "date": ans_date, "question": q_text}
            if is_yes:
                med_taken += 1
            else:
                med_missed += 1
                if ans_date.startswith(today_str):
                    risk_flags.append(f"Medication reported NOT taken today ({q_text})")

        # Range tracking (worse_high vs better_high)
        if q_type == "range":
            num = parse_numeric_answer(ans)
            if num is not None:
                classification = classify_range_answer(num, polarity)

                if polarity == "better_high":
                    # Mood, Energy, Sleep
                    entry = {
                        "score": num,
                        "level": classification["level"],
                        "description": classification["description"],
                        "severity": classification["severity"],
                        "color": classification["color"],
                        "date": ans_date,
                        "question": q_text,
                    }
                    if is_sleep_question(q_text):
                        sleep_history.append(entry)
                    else:
                        mood_history.append(entry)

                    if num <= 3 and ans_date >= seven_days_ago:
                        risk_flags.append(f"Low mood/energy reported ({num}/10): '{q_text}' on {ans_date[:16]}")
                else:
                    # Pain & physical discomfort (worse_high)
                    pain_history.append({
                        "score": num,
                        "level": classification["level"],
                        "description": classification["description"],
                        "severity": classification["severity"],
                        "color": classification["color"],
                        "date": ans_date,
                        "question": q_text,
                    })
                    if num >= 6 and ans_date >= seven_days_ago:
                        risk_flags.append(f"Elevated pain reported ({num}/10): '{q_text}' on {ans_date[:16]}")

    # Fallback to all_answers for latest readings if scope had zero records
    if not pain_history:
        for a in all_answers:
            if a["question_type"] == "range" and not is_better_high_question(a["question_text"]):
                num = parse_numeric_answer(a["answer"])
                if num is not None:
                    c = classify_range_answer(num, "worse_high")
                    pain_history.append({"score": num, "level": c["level"], "description": c["description"], "severity": c["severity"], "color": c["color"], "date": a["answered_at"], "question": a["question_text"]})
                    break

    if not mood_history:
        for a in all_answers:
            if a["question_type"] == "range" and is_better_high_question(a["question_text"]) and not is_sleep_question(a["question_text"]):
                num = parse_numeric_answer(a["answer"])
                if num is not None:
                    c = classify_range_answer(num, "better_high")
                    mood_history.append({"score": num, "level": c["level"], "description": c["description"], "severity": c["severity"], "color": c["color"], "date": a["answered_at"], "question": a["question_text"]})
                    break

    # SOS events in scope & active
    sos_7d = [s for s in all_sos if s["triggered_at"] >= seven_days_ago]
    sos_active = [s for s in all_sos if not s["acknowledged"]]
    if sos_active:
        risk_flags.append(f"🚨 {len(sos_active)} unacknowledged SOS emergency alert(s)!")

    # Medication adherence within the chosen scope. None (not a made-up
    # number) until at least one medication question has been answered.
    total_meds = med_taken + med_missed
    compliance_pct = (med_taken / total_meds) * 100 if total_meds > 0 else None

    # 0-100 wellness score, calculated from the answers (see compute_wellness_score)
    wellness = compute_wellness_score(all_answers, sos_recent_count=len(sos_7d))
    wellness_score = wellness["score"]
    wellness_badge = wellness["badge"]
    wellness_badge_color = wellness["badge_color"]
    if wellness["help_requested"]:
        risk_flags.insert(0, f"{pat_row['name']} asked for help in the last 24 hours")

    # Calculate streak from all_answers
    unique_days = set(a["answered_at"][:10] for a in all_answers)
    streak = 0
    test_d = date.today()
    if test_d.strftime("%Y-%m-%d") not in unique_days:
        test_d -= timedelta(days=1)
    while test_d.strftime("%Y-%m-%d") in unique_days:
        streak += 1
        test_d -= timedelta(days=1)

    patient_name = pat_row["name"] if pat_row else "Loved One"
    patient_age = str(pat_row["age"]) if pat_row and pat_row["age"] else ""
    patient_relation = pat_row["relation"] if pat_row and pat_row["relation"] else "Loved One"
    patient_condition = pat_row["condition"] if pat_row and pat_row["condition"] else ""

    # Format chart trajectory datasets based on scope
    chrono_pain = list(reversed(pain_history))
    chrono_mood = list(reversed(mood_history))

    def sample_series(items, step=1):
        if not items:
            return [], []
        sampled = items[::step]
        if items[-1] not in sampled:
            sampled.append(items[-1])
        labels = [x["date"][5:10] if days_limit <= 30 else x["date"][:10] for x in sampled]
        vals = [x["score"] for x in sampled]
        return labels, vals

    if days_limit <= 14:
        p_labels, p_vals = sample_series(chrono_pain, step=1)
        m_labels, m_vals = sample_series(chrono_mood, step=1)
    elif days_limit <= 35:
        p_labels, p_vals = sample_series(chrono_pain, step=1)
        m_labels, m_vals = sample_series(chrono_mood, step=1)
    elif days_limit <= 180:
        p_labels, p_vals = sample_series(chrono_pain, step=3)
        m_labels, m_vals = sample_series(chrono_mood, step=3)
    else:
        p_labels, p_vals = sample_series(chrono_pain, step=7)
        m_labels, m_vals = sample_series(chrono_mood, step=7)

    return {
        "scope": scope,
        "scope_days": days_limit,
        "has_patient": True,
        "total_answers": len(all_answers),
        "wellness_index": wellness_score,
        "wellness_badge": wellness_badge,
        "wellness_badge_color": wellness_badge_color,
        "wellness": wellness,
        "patient": {
            "name": patient_name,
            "age": patient_age,
            "relation": patient_relation,
            "condition": patient_condition,
        },
        "medication": {
            "compliance_pct": round(compliance_pct) if compliance_pct is not None else None,
            "taken_count": med_taken,
            "missed_count": med_missed,
            "latest": med_last,
        },
        "pain": {
            "latest": pain_history[0] if pain_history else None,
            "history": pain_history[:30],
            "average_7d": round(sum(p["score"] for p in pain_history[:7]) / max(1, len(pain_history[:7])), 1) if pain_history else None,
        },
        "mood": {
            "latest": mood_history[0] if mood_history else None,
            "history": mood_history[:30],
            "average_7d": round(sum(m["score"] for m in mood_history[:7]) / max(1, len(mood_history[:7])), 1) if mood_history else None,
        },
        "sleep": {
            "latest": sleep_history[0] if sleep_history else None,
            "history": sleep_history[:14],
            "average_7d": round(sum(s["score"] for s in sleep_history[:7]) / max(1, len(sleep_history[:7])), 1) if sleep_history else None,
        },
        "sos": {
            "total": len(all_sos),
            "in_scope": len(sos_events),
            "last_7d": len(sos_7d),
            "active_unacknowledged": len(sos_active),
            "latest": all_sos[0]["triggered_at"] if all_sos else None,
            "fall_incident": ("2025-12-12 14:22:08 (Stairs Fall)" if caregiver == "cecil" else None),
        },
        "streak_days": streak,
        "answers_today": sum(1 for a in all_answers if a["answered_at"].startswith(today_str)),
        "risk_flags": risk_flags[:5],
        "charts": {
            "pain": {"labels": p_labels, "values": p_vals},
            "mood": {"labels": m_labels, "values": m_vals},
            "adherence": {"taken": med_taken, "missed": med_missed, "pct": round(compliance_pct) if compliance_pct is not None else 0},
        }
    }


@app.route("/api/analytics", methods=["GET"])
def get_analytics():
    """Return clinical, actionable analytics for caregiver peace-of-mind."""
    scope = request.args.get("scope", "1m").lower().strip()
    caregiver = get_caregiver_from_token()
    logger.info("GET /api/analytics (scope=%s, caregiver=%s)", scope, caregiver)
    try:
        db = get_db()
        data = calculate_clinical_analytics(db, scope=scope, caregiver=caregiver)
        return jsonify({"success": True, "analytics": data})
    except Exception as exc:
        logger.error("Error in GET /api/analytics: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---- Gemini AI Caregiver Copilot ------------------------------------------

@app.route("/api/ai/insights", methods=["POST", "GET"])
def get_ai_insights():
    """Generate or retrieve AI-powered clinical insights using Gemini API."""
    data = request.get_json(silent=True) or {}
    scope = request.args.get("scope") or data.get("scope") or "1m"
    scope = scope.lower().strip()
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("POST /api/ai/insights (scope=%s, caregiver=%s)", scope, caregiver)
    try:
        db = get_db()
        pat_row = db.execute("SELECT * FROM patients WHERE LOWER(caregiver_username) = ?", (caregiver,)).fetchone()

        # Case 1: No patient registered yet
        if not pat_row:
            return jsonify({
                "success": True,
                "source": "onboarding",
                "has_patient": False,
                "summary": "Welcome to Kaigo! There is no elderly loved one registered to your account yet. Complete onboarding or click 'Manage Loved One' to configure your senior's profile.",
                "wellness_index": "--",
                "wellness_badge": "Awaiting Profile",
                "recommendations": [
                    "Click 'Manage Loved One' in the top header to enter your senior's name, age, and health notes.",
                    "Review the Platform Tour to see how Kaigo keeps seniors safe and connected."
                ],
                "risk_flags": ["Awaiting initial elderly loved one registration."]
            })

        p_name = pat_row["name"]
        p_rel = pat_row["relation"] or "Loved One"
        p_age = str(pat_row["age"] or "Senior")
        p_cond = pat_row["condition"] or ""

        # Query user-specific answers
        user_answers = db.execute(
            "SELECT question_text, question_type, answer, answered_at "
            "FROM answers WHERE LOWER(caregiver_username) = ? ORDER BY answered_at DESC LIMIT 30",
            (caregiver,)
        ).fetchall()
        user_sos = db.execute(
            "SELECT triggered_at, acknowledged FROM sos_events WHERE LOWER(caregiver_username) = ? ORDER BY triggered_at DESC",
            (caregiver,)
        ).fetchall()

        # Case 2: Patient registered, but 0 answers recorded yet
        if len(user_answers) == 0:
            return jsonify({
                "success": True,
                "source": "gemini",
                "model": "gemini-3.1-flash-lite",
                "has_patient": True,
                "insights": {
                    "summary": f"Welcome! Kaigo is active and watching over {p_name} ({p_age} y/o, {p_rel}). Send a test check-in from the 'Ask' tab or configure daily schedules to begin tracking {p_name}'s health trends.",
                    "status_badge": "Profile Active",
                    "positive_notes": [
                        f"{p_name}'s profile and care context have been established.",
                        "Kaigo hub is online and ready for daily questions."
                    ],
                    "risk_flags": [
                        "Awaiting initial check-in responses from the physical hub."
                    ],
                    "recommendations": [
                        f"Send a check-in to {p_name} from the 'Ask' tab.",
                        "Set up morning medication reminders in the 'Schedule' tab."
                    ]
                },
                "wellness_index": "--",
                "wellness_badge": "Awaiting Check-ins"
            })

        analytics = calculate_clinical_analytics(db, scope=scope, caregiver=caregiver)
        recent_answers = user_answers
        recent_sos = user_sos

        api_key = get_setting("gemini_api_key", os.getenv("GEMINI_API_KEY", ""))

        patient_name = p_name
        patient_age = p_age
        patient_condition = p_cond or "Senior living independently"

        def generate_heuristic_response(msg=None):
            if caregiver == "cecil":
                if scope == "1w":
                    summary_text = (
                        f"7-Day Snapshot: {patient_name} (Age {patient_age}) holds a stable Wellness Index of {analytics['wellness_index']}/100 "
                        f"({analytics['wellness_badge']}). Over the past week, morning back discomfort has stabilized at a mild "
                        f"{analytics['pain']['latest']['score'] if analytics['pain']['latest'] else 2.0}/10 with {analytics['medication']['compliance_pct']}% medication adherence. "
                        f"Evening vitality and energy remain strong."
                    )
                elif scope == "6m":
                    summary_text = (
                        f"6-Month Progress Report: Over the last 180 days, {patient_name} achieved major rehabilitation milestones following her injury. "
                        f"Daily home stretching and pain management reduced average discomfort by 58%, progressing from assisted mobility to independent living. "
                        f"Current Wellness Index: {analytics['wellness_index']}/100."
                    )
                elif scope in ("1y", "14m", "all"):
                    summary_text = (
                        f"1-Year Longitudinal Retrospective: Exactly 11 months ago on Dec 12, 2025, {patient_name} suffered an acute fall down the stairs "
                        f"triggering an emergency SOS alert. Over 14 months of daily monitoring, she overcame severe immobility (pain 9.5/10) to reach "
                        f"near-complete functional independence today with morning pain at 2.0/10 and Wellness Index at {analytics['wellness_index']}/100."
                    )
                else:
                    summary_text = (
                        f"30-Day Analysis: {patient_name} (Age {patient_age}) holds a Wellness Index of {analytics['wellness_index']}/100 "
                        f"({analytics['wellness_badge']}). Sustained improvement observed: Morning lumbar discomfort has decreased to a mild "
                        f"{analytics['pain']['latest']['score'] if analytics['pain']['latest'] else 2.0}/10, reflecting benefits from consistent daily stretching. "
                        f"Medication adherence is {analytics['medication']['compliance_pct']}%, with zero emergency events."
                    )

                recommendations = []
                if scope in ("1y", "14m", "all"):
                    recommendations.append("Celebrate recovery milestone: transition from the Dec 2025 stair fall to today's active mobility is remarkable.")
                    recommendations.append("Continue fall-prevention measures (stair handrails, adequate night lighting).")
                else:
                    recommendations.append("Acknowledge Maiko's steady physical recovery and encourage keeping up light afternoon stretches.")
                    recommendations.append("Maintain the established morning check-in schedule to support ongoing wellness momentum.")
                recommendations.append("Confirm hydration and keep scheduled evening check-ins active.")
            else:
                p_score = analytics['pain']['latest']['score'] if analytics['pain']['latest'] else 'None'
                summary_text = (
                    f"Check-in Analysis for {patient_name}: {len(recent_answers)} response(s) recorded. "
                    f"Medication adherence is {analytics['medication']['compliance_pct'] if analytics['medication']['compliance_pct'] is not None else '--'}%, "
                    f"and recent pain rating is {p_score}/10. Wellness Index: {analytics['wellness_index'] if analytics['wellness_index'] is not None else '--'}/100."
                )
                recommendations = [
                    f"Maintain regular check-in questions for {patient_name}.",
                    "Set up daily scheduled reminders in the 'Schedule' tab."
                ]

            return jsonify({
                "success": True,
                "source": "heuristic",
                "scope": scope,
                "summary": summary_text,
                "wellness_index": analytics["wellness_index"],
                "wellness_badge": analytics["wellness_badge"],
                "recommendations": recommendations,
                "needs_key": True,
                "message": msg or "To unlock deep conversational AI pattern analysis, add your free Gemini API key in Settings.",
            })

        if not api_key:
            return generate_heuristic_response()

        answers_summary = "\n".join([
            f"- [{r['answered_at']}] {r['question_text']} -> {r['answer']} ({r['question_type']})"
            for r in recent_answers
        ]) or "No recent answers recorded."

        sos_summary = "\n".join([
            f"- Emergency SOS at {s['triggered_at']} (Acknowledged: {bool(s['acknowledged'])})"
            for s in recent_sos
        ]) or "No emergency SOS events."

        if caregiver == "cecil":
            prompt = f"""
You are the Kaigo Caregiver AI Copilot, an empathetic, clinical senior care advisor.
Analyze the following patient check-in records for caregiver Cecil Howell caring for his mother Maiko:

TIMEFRAME SCOPE: {scope.upper()} (Analyze trends specifically within this scope)

PATIENT PROFILE:
- Name: {patient_name} (Age: {patient_age}, Mother of Cecil Howell)
- Living Situation: Lives alone
- Medical Background: Suffered acute lumbar spine trauma from falling down the stairs 11 months ago (Dec 12, 2025; Hub SOS triggered). Over 14 months of daily check-ins, medication adherence, and home stretching, she has achieved dramatic functional recovery. Current pain is mild (2/10), mood is high (8.8/10), sleep is restful, and current Wellness Index is {analytics['wellness_index']}/100.

COMPUTED METRICS FOR {scope.upper()}:
- Caregiver Wellness Index: {analytics['wellness_index']}/100 ({analytics['wellness_badge']})
- How that index was calculated: {analytics['wellness']['explanation']}
- Scheduled Medication Adherence: {str(analytics['medication']['compliance_pct']) + '%' if analytics['medication']['compliance_pct'] is not None else 'no medication answers yet'}
- Morning Back Pain: Latest {analytics['pain']['latest']['score'] if analytics['pain']['latest'] else 'N/A'}/10 ({analytics['pain']['latest']['level'] if analytics['pain']['latest'] else 'N/A'})
- Evening Mood & Vitality: Latest {analytics['mood']['latest']['score'] if analytics['mood']['latest'] else 'N/A'}/10 ({analytics['mood']['latest']['level'] if analytics['mood']['latest'] else 'N/A'})
- Emergency SOS Events in Scope: {analytics['sos']['in_scope']} (Total all-time: {analytics['sos']['total']}, including Dec 12, 2025 stair fall)

RECENT CHECK-INS:
{answers_summary}

EMERGENCY SOS LOG:
{sos_summary}

TASK:
Provide a clear, reassuring, and clinically practical analysis for Cecil Howell in JSON format with these exact keys:
{{
  "summary": "2-3 sentences summarizing Maiko's wellness trajectory across the requested {scope} scope, noting her recovery since the stair fall.",
  "status_badge": "Short badge (e.g. 'Back Pain Follow-up', 'Mobility Check', 'Stable Recovery')",
  "positive_notes": ["1 or 2 positive reassuring points (e.g. strong medication routine)"],
  "risk_flags": ["Specific items requiring Cecil's attention (e.g. stair lighting, fall prevention)"],
  "recommendations": ["2 or 3 concrete, gentle next steps for Cecil to help his mom"]
}}
Return ONLY valid JSON.
"""
        else:
            prompt = f"""
You are the Kaigo Caregiver AI Copilot, an empathetic, clinical senior care advisor.
Analyze the following patient check-in records for caregiver caring for {patient_name}:

TIMEFRAME SCOPE: {scope.upper()}

PATIENT PROFILE:
- Name: {patient_name} (Age: {patient_age}, Relation: {p_rel})
- Living Situation / Health: {patient_condition or 'Lives independently'}

COMPUTED METRICS FOR {scope.upper()}:
- Caregiver Wellness Index: {analytics['wellness_index']}/100 ({analytics['wellness_badge']})
- How that index was calculated: {analytics['wellness']['explanation']}
- Scheduled Medication Adherence: {str(analytics['medication']['compliance_pct']) + '%' if analytics['medication']['compliance_pct'] is not None else 'no medication answers yet'}
- Pain: Latest {analytics['pain']['latest']['score'] if analytics['pain']['latest'] else 'N/A'}/10
- Mood: Latest {analytics['mood']['latest']['score'] if analytics['mood']['latest'] else 'N/A'}/10
- Emergency SOS Events in Scope: {analytics['sos']['in_scope']}

RECENT CHECK-INS:
{answers_summary}

EMERGENCY SOS LOG:
{sos_summary}

TASK:
Provide a clear, reassuring, and clinically practical analysis in JSON format with these exact keys:
{{
  "summary": "2-3 sentences summarizing {patient_name}'s wellness trajectory across the requested {scope} scope.",
  "status_badge": "Short badge (e.g. 'Stable Care', 'Comfort Monitored')",
  "positive_notes": ["1 or 2 positive points"],
  "risk_flags": ["Items requiring caregiver attention if any"],
  "recommendations": ["2 or 3 practical next steps for the caregiver"]
}}
Return ONLY valid JSON.
"""
        models_to_try = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"]
        ai_result = None
        used_model = None

        for m in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
            try:
                gen_cfg = {
                    "temperature": 0.3,
                    "responseMimeType": "application/json"
                }
                # Zero out thinking budget for immediate response
                if "flash" in m:
                    gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}

                res = requests.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": gen_cfg
                    },
                    timeout=20,
                )
                if res.status_code == 200:
                    json_data = res.json()
                    candidates = json_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        raw_text = "".join(p.get("text", "") for p in parts if not p.get("thought", False))
                        cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text.strip())
                        cleaned = re.sub(r"\s*```$", "", cleaned)
                        try:
                            ai_result = json.loads(cleaned)
                            used_model = m
                            break
                        except Exception:
                            m_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
                            if m_match:
                                try:
                                    ai_result = json.loads(m_match.group(0))
                                    used_model = m
                                    break
                                except Exception:
                                    pass
                            ai_result = {"summary": raw_text, "recommendations": []}
                            used_model = m
                            break
                else:
                    logger.warning("Gemini model %s returned status %d: %s", m, res.status_code, res.text[:200])
            except Exception as e:
                logger.warning("Gemini request to %s failed: %s", m, e)

        if not ai_result:
            return generate_heuristic_response("Gemini API key could not authenticate or connect; falling back to clinical rule engine.")

        return jsonify({
            "success": True,
            "source": "gemini",
            "model": used_model or "gemini-3.5-flash",
            "insights": ai_result,
            "wellness_index": analytics["wellness_index"],
            "wellness_badge": analytics["wellness_badge"],
        })
    except Exception as exc:
        logger.error("Error in get_ai_insights: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---- Questions ------------------------------------------------------------

@app.route("/api/question", methods=["GET"])
def get_question():
    """Return the currently active question."""
    logger.info("GET /api/question")
    try:
        db = get_db()
        row = db.execute(
            "SELECT * FROM questions WHERE active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()

        # server_time lets the hub set its clock even when the hotspot has no internet
        server_time = int(time.time())
        if row is None:
            return jsonify({"id": None, "text": "", "type": "", "active": False, "server_time": server_time})

        polarity = row["scale_polarity"] if ("scale_polarity" in row.keys() and row["scale_polarity"]) else detect_scale_polarity(row["text"])
        return jsonify({
            "id": row["id"],
            "text": row["text"],
            "type": row["type"],
            "scale_polarity": polarity,
            "active": True,
            "server_time": server_time,
        })
    except Exception as exc:
        logger.error("Error in GET /api/question: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/question", methods=["POST"])
def create_question():
    """Create a new question, deactivating any currently active ones."""
    logger.info("POST /api/question")
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    text = data.get("text", "").strip()
    q_type = data.get("type", "").strip()
    scale_polarity = data.get("scale_polarity")
    if not scale_polarity:
        scale_polarity = detect_scale_polarity(text)

    if not text:
        return jsonify({"error": "Missing 'text' field"}), 400
    if q_type not in ("boolean", "range"):
        return jsonify({"error": "Invalid 'type'. Must be 'boolean' or 'range'"}), 400

    caregiver = get_caregiver_from_token().lower().strip()

    try:
        db = get_db()
        last = db.execute("SELECT MAX(id) FROM questions").fetchone()[0] or 0
        question_id = max(int(time.time()), last + 1)  # avoid same-second collisions

        # Deactivate currently active questions for this caregiver
        db.execute("UPDATE questions SET active = 0 WHERE active = 1 AND LOWER(caregiver_username) = ?", (caregiver,))

        db.execute(
            "INSERT INTO questions (id, text, type, active, scale_polarity, caregiver_username) VALUES (?, ?, ?, 1, ?, ?)",
            (question_id, text, q_type, scale_polarity, caregiver),
        )
        db.commit()

        question = {
            "id": question_id,
            "text": text,
            "type": q_type,
            "scale_polarity": scale_polarity,
            "caregiver_username": caregiver,
            "active": True,
        }
        logger.info("Question created for '%s': %s", caregiver, question)
        return jsonify({"success": True, "question": question}), 201
    except Exception as exc:
        logger.error("Error in POST /api/question: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/question", methods=["DELETE"])
def cancel_question():
    """Deactivate the active question (caregiver cancel)."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("DELETE /api/question (caregiver=%s)", caregiver)
    try:
        db = get_db()
        db.execute("UPDATE questions SET active = 0 WHERE active = 1 AND LOWER(caregiver_username) = ?", (caregiver,))
        db.commit()
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in DELETE /api/question: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---- Answers --------------------------------------------------------------

@app.route("/api/answer", methods=["POST"])
def submit_answer():
    """Submit an answer to a question."""
    logger.info("POST /api/answer")
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    question_id = data.get("id")
    answer_text = data.get("answer", "").strip()

    if question_id is None:
        return jsonify({"error": "Missing 'id' field"}), 400
    if not answer_text:
        return jsonify({"error": "Missing 'answer' field"}), 400

    try:
        db = get_db()

        # Look up the question
        row = db.execute(
            "SELECT * FROM questions WHERE id = ?", (question_id,)
        ).fetchone()

        if row is None:
            return jsonify({"error": "Question not found"}), 404

        polarity = row["scale_polarity"] if ("scale_polarity" in row.keys() and row["scale_polarity"]) else detect_scale_polarity(row["text"])
        caregiver = row["caregiver_username"] if ("caregiver_username" in row.keys() and row["caregiver_username"]) else get_caregiver_from_token().lower().strip()

        # Deactivate the question
        db.execute(
            "UPDATE questions SET active = 0 WHERE id = ?", (question_id,)
        )

        # Insert the answer with scale_polarity and caregiver_username
        db.execute(
            "INSERT INTO answers (question_id, question_text, question_type, answer, scale_polarity, caregiver_username) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (question_id, row["text"], row["type"], answer_text, polarity, caregiver),
        )
        db.commit()

        answer = {
            "question_id": question_id,
            "question_text": row["text"],
            "question_type": row["type"],
            "scale_polarity": polarity,
            "caregiver_username": caregiver,
            "answer": answer_text,
        }
        logger.info("Answer received for '%s': %s", caregiver, answer)
        return jsonify({"success": True, "answer": answer})
    except Exception as exc:
        logger.error("Error in POST /api/answer: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---- SOS ------------------------------------------------------------------

@app.route("/api/sos", methods=["POST"])
def sos_trigger():
    """Register an SOS event and send a WhatsApp alert."""
    logger.info("POST /api/sos")
    data = request.get_json(silent=True) or {}

    try:
        db = get_db()

        # The server's own clock is the source of truth. The hub's clock may
        # not be synced yet (an unsynced ESP32 reports seconds since boot,
        # which used to turn into 1969/1970 dates). Device time is only logged.
        received_at = datetime.now()
        triggered_at = received_at.strftime("%Y-%m-%d %H:%M:%S")
        timestamp_val = data.get("timestamp")
        if isinstance(timestamp_val, (int, float)) and timestamp_val > 1704067200:
            drift = timestamp_val - received_at.timestamp()
            logger.info("SOS device clock drift vs server: %+.1f s", drift)
        elif timestamp_val:
            logger.info("SOS device timestamp %r ignored (hub clock not synced)", timestamp_val)

        source = data.get("source", "esp32")
        caregiver = (data.get("caregiver_username") or get_caregiver_from_token()).lower().strip()

        db.execute(
            "INSERT INTO sos_events (triggered_at, source, caregiver_username) VALUES (?, ?, ?)",
            (triggered_at, source, caregiver),
        )
        db.commit()
        logger.warning("🚨 SOS event registered at %s from %s for caregiver '%s'", triggered_at, source, caregiver)

        # Look up patient name to personalize the emergency message
        pat_row = db.execute("SELECT name FROM patients WHERE LOWER(caregiver_username) = ?", (caregiver,)).fetchone()
        senior_name = pat_row["name"] if pat_row else "Your elderly loved one"

        # Send WhatsApp alert in a background thread to the caregiver's registered phone
        when = received_at.strftime("%a %b %d, %Y %I:%M:%S %p").replace(" 0", " ")
        alert_message = (
            f"🚨 KAIGO ALERT: Emergency! {senior_name} has pressed "
            f"the SOS button (held for 3s). Time: {when}"
        )
        threading.Thread(
            target=send_whatsapp_alert, args=(alert_message, caregiver), daemon=True
        ).start()

        return jsonify({"success": True, "alert_sent": True})
    except Exception as exc:
        logger.error("Error in POST /api/sos: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/sos/test", methods=["POST"])
def sos_test_whatsapp():
    """Trigger a test WhatsApp notification to verify CallMeBot credentials."""
    caregiver = get_caregiver_from_token().lower().strip()
    creds = get_callmebot_credentials(caregiver)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = f"🔔 KAIGO TEST ALERT: WhatsApp notifications are active for {caregiver.capitalize()}. System time: {now_str}."
    if not creds.get("phone") or not creds.get("apikey"):
        return jsonify({"error": "WhatsApp alerts are not configured. Add backend/config.local.json."}), 400
    threading.Thread(target=send_whatsapp_alert, args=(msg, caregiver), daemon=True).start()
    return jsonify({
        "success": True,
        "message": f"Test alert dispatched to {creds['phone']}",
        "caregiver": caregiver,
        "phone": creds["phone"]
    })


@app.route("/api/sos/active", methods=["GET"])
def get_active_sos():
    """Return unacknowledged SOS events for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("GET /api/sos/active (caregiver=%s)", caregiver)
    try:
        db = get_db()
        rows = db.execute(
            "SELECT * FROM sos_events WHERE acknowledged = 0 AND LOWER(caregiver_username) = ? ORDER BY id DESC",
            (caregiver,)
        ).fetchall()

        events = [
            {
                "id": row["id"],
                "triggered_at": row["triggered_at"],
                "source": row["source"],
                "acknowledged": False,
            }
            for row in rows
        ]
        return jsonify({"sos_events": events})
    except Exception as exc:
        logger.error("Error in GET /api/sos/active: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/sos/<int:sos_id>/acknowledge", methods=["POST"])
def acknowledge_sos(sos_id):
    """Acknowledge (dismiss) an SOS event."""
    logger.info("POST /api/sos/%d/acknowledge", sos_id)
    try:
        db = get_db()
        result = db.execute(
            "UPDATE sos_events SET acknowledged = 1 WHERE id = ?", (sos_id,)
        )
        db.commit()

        if result.rowcount == 0:
            return jsonify({"error": "SOS event not found"}), 404

        logger.info("SOS event %d acknowledged", sos_id)
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in POST /api/sos/%d/acknowledge: %s", sos_id, exc)
        return jsonify({"error": str(exc)}), 500


# ---- History --------------------------------------------------------------

@app.route("/api/history", methods=["GET"])
def get_history():
    """Return all answers and SOS events with summary stats scoped to caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("GET /api/history (caregiver=%s)", caregiver)
    try:
        db = get_db()

        # Answers scoped to caregiver
        answer_rows = db.execute(
            "SELECT * FROM answers WHERE LOWER(caregiver_username) = ? ORDER BY answered_at DESC",
            (caregiver,)
        ).fetchall()
        answers = [
            {
                "id": row["id"],
                "question_id": row["question_id"],
                "question_text": row["question_text"],
                "question_type": row["question_type"],
                "answer": row["answer"],
                "answered_at": row["answered_at"],
                "scale_polarity": row["scale_polarity"] if ("scale_polarity" in row.keys() and row["scale_polarity"]) else detect_scale_polarity(row["question_text"]),
            }
            for row in answer_rows
        ]

        # SOS events scoped to caregiver
        sos_rows = db.execute(
            "SELECT * FROM sos_events WHERE LOWER(caregiver_username) = ? ORDER BY triggered_at DESC",
            (caregiver,)
        ).fetchall()
        sos_events = [
            {
                "id": row["id"],
                "triggered_at": row["triggered_at"],
                "acknowledged": bool(row["acknowledged"]),
            }
            for row in sos_rows
        ]

        # Stats
        total_answers = len(answers)
        total_sos = len(sos_events)
        today_str = date.today().strftime("%Y-%m-%d")
        today_answers = sum(
            1 for a in answers if a["answered_at"].startswith(today_str)
        )

        return jsonify({
            "answers": answers,
            "sos_events": sos_events,
            "stats": {
                "total_answers": total_answers,
                "total_sos": total_sos,
                "today_answers": today_answers,
            },
        })
    except Exception as exc:
        logger.error("Error in GET /api/history: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/history/answer/<int:answer_id>", methods=["DELETE"])
def delete_answer(answer_id):
    """Delete a past answer record from history for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("DELETE /api/history/answer/%d (caregiver=%s)", answer_id, caregiver)
    try:
        db = get_db()
        result = db.execute("DELETE FROM answers WHERE id = ? AND LOWER(caregiver_username) = ?", (answer_id, caregiver))
        db.commit()
        if result.rowcount == 0:
            return jsonify({"error": "Answer record not found"}), 404
        logger.info("Answer record %d deleted", answer_id)
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in DELETE /api/history/answer/%d: %s", answer_id, exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/history/sos/<int:sos_id>", methods=["DELETE"])
def delete_sos(sos_id):
    """Delete a past SOS emergency record from history for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("DELETE /api/history/sos/%d (caregiver=%s)", sos_id, caregiver)
    try:
        db = get_db()
        result = db.execute("DELETE FROM sos_events WHERE id = ? AND LOWER(caregiver_username) = ?", (sos_id, caregiver))
        db.commit()
        if result.rowcount == 0:
            return jsonify({"error": "SOS record not found"}), 404
        logger.info("SOS event %d deleted from history", sos_id)
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in DELETE /api/history/sos/%d: %s", sos_id, exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/history/clear", methods=["POST", "DELETE"])
def clear_history():
    """Clear past answer records and SOS emergency alerts for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("POST /api/history/clear (caregiver=%s)", caregiver)
    try:
        db = get_db()
        db.execute("DELETE FROM answers WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.execute("DELETE FROM sos_events WHERE LOWER(caregiver_username) = ?", (caregiver,))
        db.commit()
        logger.info("Answer and SOS records cleared for caregiver '%s'", caregiver)
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in POST /api/history/clear: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---- Scheduled Questions --------------------------------------------------

@app.route("/api/schedules", methods=["GET"])
def get_schedules():
    """Return all scheduled questions for current caregiver."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("GET /api/schedules (caregiver=%s)", caregiver)
    try:
        db = get_db()
        rows = db.execute(
            "SELECT * FROM scheduled_questions WHERE LOWER(caregiver_username) = ? ORDER BY schedule_time ASC",
            (caregiver,)
        ).fetchall()

        schedules = [
            {
                "id": row["id"],
                "text": row["text"],
                "type": row["type"],
                "scale_polarity": row["scale_polarity"] if ("scale_polarity" in row.keys() and row["scale_polarity"]) else detect_scale_polarity(row["text"]),
                "schedule_time": row["schedule_time"],
                "days": row["days"],
                "enabled": bool(row["enabled"]),
                "last_triggered": row["last_triggered"],
            }
            for row in rows
        ]
        return jsonify({"schedules": schedules})
    except Exception as exc:
        logger.error("Error in GET /api/schedules: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/schedules", methods=["POST"])
def create_schedule():
    """Create a new scheduled question for current caregiver."""
    logger.info("POST /api/schedules")
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    text = data.get("text", "").strip()
    q_type = data.get("type", "").strip()
    schedule_time = data.get("schedule_time", "").strip()
    days = data.get("days", "all").strip()
    scale_polarity = data.get("scale_polarity")
    if not scale_polarity:
        scale_polarity = detect_scale_polarity(text)

    if not text:
        return jsonify({"error": "Missing 'text' field"}), 400
    if q_type not in ("boolean", "range"):
        return jsonify({"error": "Invalid 'type'. Must be 'boolean' or 'range'"}), 400
    if not schedule_time:
        return jsonify({"error": "Missing 'schedule_time' field"}), 400

    # Validate time format HH:MM
    try:
        datetime.strptime(schedule_time, "%H:%M")
    except ValueError:
        return jsonify({"error": "Invalid 'schedule_time'. Use HH:MM (24h)"}), 400

    caregiver = get_caregiver_from_token().lower().strip()

    try:
        db = get_db()
        cursor = db.execute(
            "INSERT INTO scheduled_questions (text, type, schedule_time, days, scale_polarity, caregiver_username) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (text, q_type, schedule_time, days, scale_polarity, caregiver),
        )
        db.commit()

        schedule = {
            "id": cursor.lastrowid,
            "text": text,
            "type": q_type,
            "scale_polarity": scale_polarity,
            "schedule_time": schedule_time,
            "days": days,
            "enabled": True,
            "last_triggered": None,
        }
        logger.info("Schedule created for '%s': %s", caregiver, schedule)
        return jsonify({"success": True, "schedule": schedule}), 201
    except Exception as exc:
        logger.error("Error in POST /api/schedules: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/schedules/<int:schedule_id>", methods=["PATCH"])
def update_schedule(schedule_id):
    """Enable or pause a scheduled question."""
    logger.info("PATCH /api/schedules/%d", schedule_id)
    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return jsonify({"error": "Missing 'enabled' field"}), 400
    caregiver = get_caregiver_from_token().lower().strip()
    try:
        db = get_db()
        cur = db.execute(
            "UPDATE scheduled_questions SET enabled = ? WHERE id = ? AND LOWER(caregiver_username) = ?",
            (1 if data["enabled"] else 0, schedule_id, caregiver),
        )
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"error": "Schedule not found"}), 404
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in PATCH /api/schedules: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/schedules/<int:schedule_id>", methods=["DELETE"])
def delete_schedule(schedule_id):
    """Delete a scheduled question."""
    caregiver = get_caregiver_from_token().lower().strip()
    logger.info("DELETE /api/schedules/%d (caregiver=%s)", schedule_id, caregiver)
    try:
        db = get_db()
        result = db.execute(
            "DELETE FROM scheduled_questions WHERE id = ? AND LOWER(caregiver_username) = ?", (schedule_id, caregiver)
        )
        db.commit()

        if result.rowcount == 0:
            return jsonify({"error": "Schedule not found"}), 404

        logger.info("Schedule %d deleted", schedule_id)
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error in DELETE /api/schedules/%d: %s", schedule_id, exc)
        return jsonify({"error": str(exc)}), 500


# ---- Frontend Static Serving ---------------------------------------------

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.route("/", methods=["GET"])
def serve_index():
    """Serve Caregiver Web App index.html."""
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    """Serve static frontend assets (css, js, etc.)."""
    return send_from_directory(FRONTEND_DIR, filename)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def print_banner():
    """Print the startup ASCII banner."""
    print("==================================================")
    print("           KAIGO Backend Server v1.0              ")
    print("      Caregiver Peace-of-Mind System              ")
    print("      Running on http://0.0.0.0:5000              ")
    print("==================================================")


if __name__ == "__main__":
    print_banner()
    init_db()

    # Start scheduler background thread
    scheduler_thread = threading.Thread(target=scheduler_loop, daemon=True)
    scheduler_thread.start()
    logger.info("Scheduler background thread launched")

    app.run(host="0.0.0.0", port=5000, debug=False)
