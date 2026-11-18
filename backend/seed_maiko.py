#!/usr/bin/env python3
"""
Seed realistic 14-month simulation data for Maiko Howell (70 y/o, mom of Cecil Howell,
living alone, chronic back pain from falling down the stairs 11 months ago).
Simulates a realistic ~98% response rate with occasional whole missed days and skipped questions.
"""

import os
import sqlite3
import random
from datetime import datetime, date, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATABASE = os.path.join(DATA_DIR, "kaigo.db")


def seed_maiko_dataset():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    # 1. Ensure scale_polarity columns exist
    for tbl in ["questions", "scheduled_questions", "answers"]:
        try:
            cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN scale_polarity TEXT DEFAULT 'worse_high'")
        except sqlite3.OperationalError:
            pass

    # 2. Configure Patient Profile in settings
    settings_to_set = [
        ("patient_name", "Maiko Howell"),
        ("patient_age", "70"),
        ("patient_relation", "Mother"),
        ("caregiver_name", "Cecil Howell"),
        ("patient_health_summary", (
            "70 y/o senior living alone. Suffered acute lumbar spine trauma from falling down "
            "the stairs 11 months ago (Dec 12, 2025; emergency SOS triggered). Over 14 months "
            "of daily scheduled check-ins, medication adherence, and home stretching routines, "
            "she has achieved remarkable functional recovery with current mild pain (2/10) and high vitality."
        )),
    ]
    for k, v in settings_to_set:
        cursor.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (k, v),
        )

    # 3. Clean past history & schedules to populate fresh simulation
    cursor.execute("DELETE FROM answers")
    cursor.execute("DELETE FROM scheduled_questions")
    cursor.execute("DELETE FROM sos_events")
    cursor.execute("DELETE FROM questions")

    # 4. Insert 5 realistic Daily Schedules for Maiko
    schedules = [
        ("Did you take your morning medication?", "boolean", "08:30", "all", "worse_high"),
        ("How is your back pain this morning?", "range", "09:15", "all", "worse_high"),
        ("Did you get up and stretch your back today?", "boolean", "14:00", "all", "worse_high"),
        ("How was your mood and energy today?", "range", "18:30", "all", "better_high"),
        ("How well did you sleep last night?", "range", "21:45", "all", "better_high"),
    ]

    schedule_ids = []
    for text, q_type, s_time, days, polarity in schedules:
        cursor.execute(
            "INSERT INTO scheduled_questions (text, type, schedule_time, days, enabled, scale_polarity) "
            "VALUES (?, ?, ?, ?, 1, ?)",
            (text, q_type, s_time, days, polarity),
        )
        schedule_ids.append(cursor.lastrowid)

    # 5. Generate 14 months of realistic history (Sep 12, 2025 to Nov 12, 2026)
    end_date = date(2026, 11, 12)
    start_date = date(2025, 9, 12)  # Exactly 14 months

    rng = random.Random(42)
    answers_inserted = 0
    total_scheduled_instances = 0

    # Specific whole missed days (hospitalization after fall, out of town, family visits)
    whole_missed_days = {
        date(2025, 12, 13),  # Hospital ER observation right after Dec 12 stair fall
        date(2025, 12, 14),  # Hospital ER bedrest
        date(2026, 2, 14),   # Valentine's family visit with granddaughter
        date(2026, 4, 5),    # Easter family holiday out of house
        date(2026, 6, 21),   # Summer solstice day trip
        date(2026, 8, 18),   # Seasonal cold / sleeping all day
        date(2026, 10, 8),   # Outpatient annual checkup away all day
    }

    cur_date = start_date

    while cur_date <= end_date:
        d_str = cur_date.strftime("%Y-%m-%d")

        # Clinical progression across 14 months:
        # Phase 1: Pre-Fall Baseline (Sep 12, 2025 to Dec 11, 2025) - Normal aches, good mood
        # Phase 2: The Stair Fall Incident (Dec 12, 2025 - exactly 11 months ago!) - SOS, severe pain 9-10
        # Phase 3: Acute Post-Fall Immobility (Dec 15, 2025 to Jan 15, 2026) - Pain 8-9, mood 2-3
        # Phase 4: Early Rehabilitation (Jan 16, 2026 to Mar 31, 2026) - Pain 7-8, second SOS on Jan 20
        # Phase 5: Physical Therapy & Walker (Apr 01, 2026 to Jun 30, 2026) - Pain 5-6, mood 6
        # Phase 6: Independent Mobility Strengthening (Jul 01, 2026 to Sep 30, 2026) - Pain 3.8-4.5, mood 7.5
        # Phase 7: The Breakthrough Month & Present (Oct 01, 2026 to Nov 12, 2026) - Pain 1.8-2.2, mood 8.8, sleep 8.5

        if cur_date < date(2025, 12, 12):
            base_pain = 2.4
            base_mood = 7.5
            base_sleep = 7.3
            med_miss_prob = 0.04
            stretch_prob = 0.45
        elif cur_date == date(2025, 12, 12):
            # Stair fall incident (11 months ago)!
            base_pain = 9.6
            base_mood = 1.7
            base_sleep = 2.0
            med_miss_prob = 0.20
            stretch_prob = 0.0
        elif cur_date <= date(2026, 1, 15):
            # Acute post-fall recovery
            base_pain = 8.5
            base_mood = 2.8
            base_sleep = 2.6
            med_miss_prob = 0.10
            stretch_prob = 0.10
        elif cur_date <= date(2026, 3, 31):
            # Early rehabilitation
            base_pain = 7.1
            base_mood = 4.4
            base_sleep = 4.2
            med_miss_prob = 0.06
            stretch_prob = 0.38
        elif cur_date <= date(2026, 6, 30):
            # Moderate physical therapy & walker
            base_pain = 5.2
            base_mood = 6.4
            base_sleep = 6.2
            med_miss_prob = 0.03
            stretch_prob = 0.72
        elif cur_date <= date(2026, 9, 30):
            # Independent walking & strengthening
            base_pain = 3.8
            base_mood = 7.5
            base_sleep = 7.3
            med_miss_prob = 0.02
            stretch_prob = 0.86
        else:
            # Breakthrough Month & Current Peak (Oct 1 - Nov 12, 2026)
            base_pain = 2.1
            base_mood = 8.8
            base_sleep = 8.6
            med_miss_prob = 0.01
            stretch_prob = 0.94

        # Check if today is a whole missed day (grandma away, in hospital, or asleep)
        if cur_date in whole_missed_days:
            # All 5 questions missed on this day
            total_scheduled_instances += 5
            cur_date += timedelta(days=1)
            continue

        # Individual Question Skip Probabilities (~1.2% chance of skipping an individual question)
        skip_prob = 0.012

        # Question 1: 08:30 Medication
        total_scheduled_instances += 1
        if rng.random() > skip_prob:
            m_min = rng.randint(28, 48)
            m_time = f"{d_str} 08:{m_min:02d}:14"
            med_taken = rng.random() > med_miss_prob
            cursor.execute(
                "INSERT INTO answers (question_id, question_text, question_type, answer, answered_at, scale_polarity) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (schedule_ids[0], "Did you take your morning medication?", "boolean", "YES" if med_taken else "NO", m_time, "worse_high")
            )
            answers_inserted += 1

        # Question 2: 09:15 Back Pain (1-10, worse_high)
        total_scheduled_instances += 1
        if rng.random() > skip_prob:
            p_min = rng.randint(12, 35)
            p_time = f"{d_str} 09:{p_min:02d}:42"
            p_val = max(1, min(10, round(base_pain + rng.uniform(-0.8, 0.8))))
            cursor.execute(
                "INSERT INTO answers (question_id, question_text, question_type, answer, answered_at, scale_polarity) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (schedule_ids[1], "How is your back pain this morning?", "range", f"{p_val}/10", p_time, "worse_high")
            )
            answers_inserted += 1

        # Question 3: 14:00 Back Stretching
        if cur_date < end_date:
            total_scheduled_instances += 1
            if rng.random() > (skip_prob * 1.5):  # slightly more prone to skip afternoon stretch if napping
                s_min = rng.randint(0, 40)
                s_time = f"{d_str} 14:{s_min:02d}:19"
                stretched = rng.random() < stretch_prob
                cursor.execute(
                    "INSERT INTO answers (question_id, question_text, question_type, answer, answered_at, scale_polarity) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (schedule_ids[2], "Did you get up and stretch your back today?", "boolean", "YES" if stretched else "NO", s_time, "worse_high")
                )
                answers_inserted += 1

        # Question 4: 18:30 Mood & Energy (1-10, better_high)
        if cur_date < end_date:
            total_scheduled_instances += 1
            if rng.random() > skip_prob:
                mo_min = rng.randint(25, 55)
                mo_time = f"{d_str} 18:{mo_min:02d}:05"
                mo_val = max(1, min(10, round(base_mood + rng.uniform(-0.7, 0.7))))
                cursor.execute(
                    "INSERT INTO answers (question_id, question_text, question_type, answer, answered_at, scale_polarity) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (schedule_ids[3], "How was your mood and energy today?", "range", f"{mo_val}/10", mo_time, "better_high")
                )
                answers_inserted += 1

        # Question 5: 21:45 Sleep Quality (1-10, better_high)
        if cur_date < end_date:
            total_scheduled_instances += 1
            if rng.random() > (skip_prob * 1.8):  # occasionally falls asleep early
                sl_min = rng.randint(35, 59)
                sl_time = f"{d_str} 21:{sl_min:02d}:38"
                sl_val = max(1, min(10, round(base_sleep + rng.uniform(-0.8, 0.8))))
                cursor.execute(
                    "INSERT INTO answers (question_id, question_text, question_type, answer, answered_at, scale_polarity) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (schedule_ids[4], "How well did you sleep last night?", "range", f"{sl_val}/10", sl_time, "better_high")
                )
                answers_inserted += 1

        cur_date += timedelta(days=1)

    # 6. Seed Realistic SOS Events
    # Event 1: The major Stair Fall Incident exactly 11 months ago (Dec 12, 2025)!
    cursor.execute(
        "INSERT INTO sos_events (triggered_at, source, acknowledged) "
        "VALUES (?, ?, 1)",
        ("2025-12-12 14:22:08", "esp32")
    )

    # Event 2: Nighttime recovery struggle (reach walker) 10 months ago
    cursor.execute(
        "INSERT INTO sos_events (triggered_at, source, acknowledged) "
        "VALUES (?, ?, 1)",
        ("2026-01-20 03:15:40", "esp32")
    )

    # 7. Set Active Question on Hub
    cursor.execute(
        "INSERT INTO questions (id, text, type, active, scale_polarity) "
        "VALUES (?, ?, ?, 1, ?)",
        (9001, "Did you get up and stretch your back today?", "boolean", "worse_high")
    )

    conn.commit()
    conn.close()

    response_rate = (answers_inserted / max(1, total_scheduled_instances)) * 100
    print(f"Successfully generated 14 months of simulation data for Maiko Howell:")
    print(f"- Total answers recorded: {answers_inserted} / {total_scheduled_instances} ({response_rate:.1f}% response rate)")
    print(f"- Time span: {start_date} to {end_date} (426 days)")
    print(f"- Whole missed days: {len(whole_missed_days)} days (hospitalization, holidays, visits)")
    print(f"- Stair fall SOS recorded: 2025-12-12 14:22:08 (exactly 11 months ago)")
    print(f"- Hub active question set.")


if __name__ == "__main__":
    seed_maiko_dataset()
