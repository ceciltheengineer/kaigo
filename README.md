# KAIGO — Zero-Screen-Complexity Caregiver Peace-of-Mind System
### IoT Prototype for "Premio FRISA" (Care Economy Track — distritotec, Monterrey)

KAIGO is an IoT technology solution designed to provide family caregivers with peace of mind without burdening elderly relatives with complex touchscreens, smartphones, or confusing user interfaces.

---

## System Architecture

```
                      +-----------------------------------+
                      |   Caregiver Web App (Laptop)      |
                      |   - Dashboard with Metrics/Charts |
                      |   - Check-in Question Scheduling  |
                      |   - Audio TTS (en-US) Bluetooth   |
                      |   - Optional Gemini AI summaries  |
                      +-----------------+-----------------+
                                        | HTTP REST (port 5000)
                                        v
                      +-----------------+-----------------+
                      |     Python Flask Backend Server   |
                      |   - SQLite Database (kaigo.db)    |
                      |   - Background Scheduler (30s)    |
                      |   - CallMeBot WhatsApp Alerts     |
                      |   - Serves the web app on :5000   |
                      +-----------------+-----------------+
                                        ^
                                        | Polling GET/POST (1.5s)
                                        | over the laptop's Wi-Fi hotspot
                      +-----------------+-----------------+
                      |    ESP32-S3 Hardware Hub (Senior) |
                      |   - 320x480 portrait SPI LCD      |
                      |   - NO Button (Red, GPIO 18)      |
                      |   - YES Button (Green, GPIO 6)    |
                      |   - Dial Potentiometer (GPIO 7)   |
                      |   - SOS Emergency Button (GPIO 41)|
                      +-----------------------------------+
```

The hub joins a Windows Mobile Hotspot running on the caregiver laptop. The laptop's hotspot address, `192.168.137.1`, is where the hub finds the backend.

---

## Repository Structure

Not in the repository, by design: `backend/config.local.json` (WhatsApp numbers and keys), `firmware/KAIGO/sdkconfig` (Wi-Fi password), the SQLite database, and build output. Each is recreated by the setup steps below.

* `firmware/KAIGO/`: the ESP-IDF project for the hub (build from this folder).
  * `main/main.c`: complete ESP-IDF v6.1 C firmware. Batched SPI DMA driver for the 320x480 LCD, an 8x8 font engine, potentiometer filtering with hysteresis, button debouncing, an HTTP REST client with a self-contained JSON parser, and real-time clock sync.
  * `main/Kconfig.projbuild`: the "KAIGO Hub Configuration" menu (Wi-Fi, server URL, time, display and radio options). See [Hub configuration](#hub-configuration).
  * `main/CMakeLists.txt`: component registration (`esp_wifi`, `esp_http_client`, `esp_adc`, `esp_timer`, SPI and GPIO drivers, etc.).
  * `sdkconfig.defaults`: project defaults: 16 MB flash, the custom partition table, and the default server URL. Wi-Fi credentials are deliberately not here.
  * `partitions.csv`: NVS, PHY data, and a 4 MB factory app partition, leaving about 12 MB free for a future OTA slot or storage.
  * `sdkconfig`: generated configuration. It holds your Wi-Fi password, so it is git-ignored.
* `firmware/CMakeLists.txt`, `firmware/partitions.csv`, `firmware/sdkconfig.defaults`: leftovers from an older 4 MB layout. They are not used by the build.
* `backend/`
  * `server.py`: Flask REST API on port 5000 with CORS, an auto-initialised SQLite database (`data/kaigo.db`), a scheduler thread for recurring check-ins, CallMeBot WhatsApp SOS alerts, and static serving of the web app.
  * `seed_maiko.py`: fills the database with 14 months of realistic demo data for the Cecil account.
  * `requirements.txt`: `Flask`, `flask-cors`, `requests`.
  * `config.example.json`: template for `config.local.json`, which holds the CallMeBot phone numbers and API keys and is git-ignored.
* `frontend/`
  * `index.html`: the caregiver single-page app. Tabs: Today, Ask, Schedule, History, Insights.
  * `css/style.css`: high-contrast dashboard styling, responsive layout, and the pulsing SOS overlay.
  * `js/app.js`: client logic, `window.speechSynthesis` TTS for a paired Bluetooth speaker, polling, Chart.js charts, Web Audio alarms, and the guided dashboard tour.
* `physical/`: SolidWorks enclosure parts and assembly.

---

## Setup & Execution

The commands below are for PowerShell on the caregiver laptop. Each block starts with a full `cd`, so they work from any folder. If the project lives somewhere other than `Desktop\KAIGO` in OneDrive, change that path.

### 1. Start the Laptop Hotspot
Turn on Windows **Mobile hotspot** with the SSID and password you will give the hub. The hub expects the backend at `http://192.168.137.1:5000`, which is the laptop's address on its own hotspot. If the laptop also has internet, the hub sets its clock from internet time. Otherwise it takes the time from the backend.

### 2. Start the Backend Server (Laptop)
```powershell
cd "$HOME\OneDrive\Desktop\KAIGO\backend"
pip install -r requirements.txt   # first time only
python server.py
```
* The server listens on `http://0.0.0.0:5000`. Leave this window open; closing it stops the server.
* Optional: run `python seed_maiko.py` once, from the same `backend` folder, to load the demo dataset.
* WhatsApp SOS alerts use [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/). Copy `backend/config.example.json` to `backend/config.local.json` and fill in a phone number and API key per caregiver username. The `default` entry is used for any caregiver without their own entry. Each phone must first be registered with CallMeBot to receive an API key. `config.local.json` is git-ignored, so the numbers and keys never reach the repository. Without it the server runs normally and skips WhatsApp.

### 3. Open the Caregiver Web App
The backend serves the app itself, so with the server running just open:
```
http://localhost:5000
```
Opening `frontend/index.html` directly from disk also works; it talks to `http://localhost:5000`.
* Built-in demo accounts are **Cecil Howell** and **Diego Ortega**, password `1234`. Finishing the tour as Diego resets Diego to a clean slate for the next demo.
* Pair the laptop with the senior's room Bluetooth speaker. Questions are read aloud with text-to-speech (`en-US`) at a calm pace.
* For written AI summaries, add a Google Gemini API key under **Settings → AI key**. Without one, KAIGO uses built-in rules.
* **Settings → Dashboard tour** runs a nine-step guided tour: four steps on Today, then each sidebar tab.

### 4. Build and Flash the ESP32-S3 Hub
In an ESP-IDF 6.1 terminal (or the ESP-IDF VS Code extension):
```powershell
cd "$HOME\OneDrive\Desktop\KAIGO\firmware\KAIGO"
idf.py set-target esp32s3      # first time only
idf.py menuconfig              # KAIGO Hub Configuration: set Wi-Fi SSID and password
idf.py build
idf.py -p COM10 flash monitor
```
* The board is flashed through its USB-UART bridge (CH343, shows up as COM10 here). Use a data-capable USB cable on the port labelled UART/COM.
* After editing `main/Kconfig.projbuild`, run `idf.py reconfigure build`. A plain build may not pick up new options.

---

## Hub Configuration

All options live in `idf.py menuconfig` → **KAIGO Hub Configuration** and are stored in the git-ignored `sdkconfig`.

| Option | Default | Purpose |
|---|---|---|
| Wi-Fi SSID / password | empty | Network the hub joins (the laptop hotspot). |
| Caregiver server base URL | `http://192.168.137.1:5000` | Backend address, no trailing slash. |
| NTP server | `pool.ntp.org` | Internet time source. Falls back to the backend's clock. |
| Timezone | `CST6` | Monterrey / Mexico City, UTC-6, no daylight saving. |
| Maximum Wi-Fi transmit power | 15 dBm | Lower current spikes on the 3.3 V rail; 20 is the chip maximum. |
| ILI9488 panel tuning | on | Power, VCOM, gamma, 60 Hz frame rate and inversion settings that stop panel flicker. |

---

## How the Hub Behaves

* **Questions.** The hub polls the backend every 1.5 s. Yes/no questions are answered with the red and green buttons. 1 to 10 questions use the dial, confirmed with green. Pain questions are detected from the wording and show a pain scale.
* **Honest delivery.** If an answer does not reach the server, the hub says "NOT SENT" and the question comes back on the next poll. A question the caregiver withdraws disappears from the hub within about 3 s.
* **SOS.** Holding SOS shows a "KEEP HOLDING" bar. At 3 s the alert is sent immediately, retried up to 3 times, and the screen reports whether the family was actually notified. If the hub is offline at that moment it forces an immediate Wi-Fi reconnect first.
* **Time.** SOS records and WhatsApp messages are stamped with the backend's clock, so they are correct even before the hub has synced its own.
* **Offline.** The header badge switches between ONLINE and OFFLINE live. Wi-Fi retries back off from 1 s up to 10 s.

---

## Wellness Score

The 0 to 100 score on the dashboard is calculated from the senior's own answers by `compute_wellness_score()` in `backend/server.py`. It is a weighted average of up to four parts, each scored 0 to 100:

| Part | Weight | Answers used | How it is scored |
|---|---|---|---|
| Mood & energy | 30 | 1 to 10 questions where 10 is best | (answer - 1) / 9 x 100 |
| Pain | 30 | 1 to 10 questions where 10 is worst | (10 - answer) / 9 x 100 |
| Medication | 25 | Yes/no medication questions | Percent answered YES |
| Sleep | 15 | 1 to 10 sleep questions | (answer - 1) / 9 x 100 |

* Only answers from the last 14 days count, and newer answers count more: an answer loses half its influence every 3 days.
* A part with no answers is left out and the other weights are re-balanced, so the score only reflects what was actually answered. Example: mood 2/10 and medication taken gives (11 x 30 + 100 x 25) / 55 = 52.
* Each SOS alert in the last 7 days subtracts 15, up to 40. A YES to a "do you need help" question in the last 24 hours subtracts 10.
* Bands: 85 and up is Excellent / Stable, 70 to 84 is Good / Minor Follow-up, 50 to 69 is Needs Attention, below 50 is Action Required.

The dashboard shows the parts under the score, for example "Mood & energy 2/10 · Medication 100% taken. From 2 answers in the last 14 days."

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Hub log repeats `Wi-Fi disconnected (reason 201)` | The hotspot is off or the SSID is wrong. 201 means no access point found. |
| WhatsApp SOS text arrives a minute or more late | CallMeBot's queue. The server log line `WhatsApp alert handed to CallMeBot in ...` shows how long the hand-off itself took. |
| Display flickers | Check it lines up with Wi-Fi activity. If so, add a 470–1000 µF capacitor across the display supply and use a good USB port and cable. |
| Red and blue look swapped | Change MADCTL from `0x40` to `0x48` in `lcd_init_hardware()`. |
| `Server not reachable` in the web app | The backend is not running on port 5000. |
| COM10 missing when flashing | Charge-only cable, wrong USB port on the board, or the board is powered from a charger instead of the PC. |

---

## Locked Hardware Pin Configuration
* **TFT Display (320x480 portrait SPI, ILI9488, RGB666, `MADCTL=0x40`, 20 MHz):**
  * `PIN_MOSI`: GPIO 16
  * `PIN_SCLK`: GPIO 17
  * `PIN_CS`: GPIO 13
  * `PIN_DC`: GPIO 12
  * `PIN_RST`: GPIO 20 (this is also USB D+; fine while flashing through the UART bridge, but move it before using the S3's native USB port)
* **Inputs:**
  * **Potentiometer Dial (1–10 Scale):** Wiper on `GPIO 7` (ADC1_CH6)
  * **NO Button (Red):** `GPIO 18` (Internal Pull-Up, Active LOW)
  * **YES / Confirm Button (Green):** `GPIO 6` (Internal Pull-Up, Active LOW)
  * **EMERGENCY / SOS Button:** `GPIO 41` (Internal Pull-Up, Active LOW)
* **Board:** ESP32-S3 N16R8 (16 MB flash, 8 MB PSRAM, unused).
