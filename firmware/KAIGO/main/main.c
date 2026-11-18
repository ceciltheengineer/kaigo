/**
 * ============================================================================
 * KAIGO Hub — ESP32-S3 Senior Caregiver IoT Hub
 * Zero-Screen-Complexity Caregiver Peace-of-Mind System
 * ============================================================================
 * Hardware configuration (LOCKED):
 *   - MCU: ESP32-S3 (ESP-IDF v5.x / v6.x, C)
 *   - TFT LCD: 320x480 Portrait SPI, 18-bit RGB666, RGB order (MADCTL=0x40)
 *     * Orientation: Portrait, Towards GPIO pins is DOWN.
 *     * MOSI = GPIO 16, SCLK = GPIO 17, CS = GPIO 13, DC = GPIO 12, RST = GPIO 20
 *       (GPIO 20 is USB D+. Fine because the board is flashed over its UART bridge;
 *        move RST before using the S3 native USB / USB-JTAG port.)
 *     * 20 MHz SPI Clock
 *     * Init: SWRESET, SLPOUT, COLMOD, MADCTL, DISPON, plus (menuconfig option
 *       KAIGO_LCD_ILI9488_TUNING, default on) the standard ILI9488 power, VCOM,
 *       gamma, 60 Hz frame-rate and inversion-control registers that stop the
 *       panel flickering. If red and blue appear swapped use MADCTL=0x48 (BGR).
 *   - Potentiometer Wiper: GPIO 7 (ADC_UNIT_1, ADC_CHANNEL_6, ADC_ATTEN_DB_12)
 *   - NO Button (Red): GPIO 18 (Pull-Up, Active LOW)
 *   - YES / Confirm Button (Green): GPIO 6 (Pull-Up, Active LOW)
 *   - EMERGENCY / SOS Button: GPIO 41 (Pull-Up, Active LOW)
 * ============================================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <ctype.h>
#include <sys/time.h>
#include <assert.h>

#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"

#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_timer.h"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_heap_caps.h"
#include "esp_netif_sntp.h"

static const char *TAG = "KAIGO";

/* ============================================================================
 * NETWORK & SERVER CONFIGURATION
 * ============================================================================ */
/* Set with `idf.py menuconfig` -> "KAIGO Hub Configuration". The values live in
 * sdkconfig, which is git-ignored, so credentials stay out of source control. */
#define WIFI_SSID       CONFIG_KAIGO_WIFI_SSID
#define WIFI_PASS       CONFIG_KAIGO_WIFI_PASSWORD
#define SERVER_BASE_URL CONFIG_KAIGO_SERVER_BASE_URL

#define WIFI_CONNECTED_BIT BIT0
static EventGroupHandle_t s_wifi_event_group;
static bool s_is_wifi_connected = false;
static char s_device_ip[32] = "0.0.0.0";

/* ============================================================================
 * HARDWARE PIN DEFINITIONS
 * ============================================================================ */
#define PIN_MOSI        16
#define PIN_SCLK        17
#define PIN_CS          13
#define PIN_DC          12
#define PIN_RST         20

#define PIN_POT_ADC_CH  ADC_CHANNEL_6   /* GPIO 7 on ADC_UNIT_1 */
#define PIN_BTN_NO      18              /* Red button (Active LOW) */
#define PIN_BTN_YES     6               /* Green / Confirm button (Active LOW) */
#define PIN_BTN_SOS     41              /* Emergency button (Active LOW) */

/* Display dimensions: Portrait (320x480), Pins facing DOWN */
#define LCD_W           320
#define LCD_H           480
#define LINES_PER_BATCH 10
#define DMA_BUF_SIZE    (LCD_W * 3 * LINES_PER_BATCH)

static spi_device_handle_t s_spi_lcd = NULL;
static uint8_t *s_dma_buffer = NULL;
static adc_oneshot_unit_handle_t s_adc_handle = NULL;

/* ============================================================================
 * COLOR PALETTE (RGB888, sent as R, G, B; in 18-bit mode the panel uses the
 * top 6 bits of each byte)
 * Light Mode Theme — Clean, Bright, Medical-Grade High Contrast
 * ============================================================================ */
typedef struct {
    uint8_t r;
    uint8_t g;
    uint8_t b;
} color_t;

static const color_t COLOR_BG_WHITE     = {250, 252, 255}; /* Soft white background */
static const color_t COLOR_WHITE        = {255, 255, 255}; /* Pure white */
static const color_t COLOR_CARD_BG      = {241, 245, 249}; /* Slate 100 card fill */
static const color_t COLOR_CARD_BORDER  = {203, 213, 225}; /* Slate 300 border */
static const color_t COLOR_TEXT_MAIN    = { 30,  41,  59}; /* Slate 800 high-contrast */
static const color_t COLOR_TEXT_MUTED   = {100, 116, 139}; /* Slate 500 secondary */
static const color_t COLOR_GREEN        = { 16, 185, 129}; /* Emerald 500 (YES/Confirm) */
static const color_t COLOR_RED          = {239,  68,  68}; /* Red 500 (NO/SOS) */
static const color_t COLOR_AMBER        = {245, 158,  11}; /* Amber 500 (Scale mid) */
static const color_t COLOR_BLUE         = { 59, 130, 246}; /* Blue 500 (Accent) */
static const color_t COLOR_CHEEK_PINK   = {251, 113, 133}; /* Rose pink blushing cheeks */
static const color_t COLOR_EYE_DARK     = { 15,  23,  42}; /* Slate 900 eye iris */
static const color_t COLOR_EYE_SHINE    = { 56, 189, 248}; /* Sky 400 eye sparkle */
static const color_t COLOR_HEART_RED    = {244,  63,  94}; /* Rose 500 heart eye */
static const color_t COLOR_LIGHT_GRAY   = {226, 232, 240}; /* Gauge background */

/* ============================================================================
 * 8x8 ASCII BITMAP FONT TABLE (ASCII 32 to 126)
 * ============================================================================ */
static const uint8_t FONT8x8_BASIC[95][8] = {
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00}, /* 32   */
    {0x18,0x3C,0x3C,0x18,0x18,0x00,0x18,0x00}, /* 33 ! */
    {0x66,0x66,0x24,0x00,0x00,0x00,0x00,0x00}, /* 34 " */
    {0x6C,0x6C,0xFE,0x6C,0xFE,0x6C,0x6C,0x00}, /* 35 # */
    {0x18,0x3E,0x60,0x3C,0x06,0x7C,0x18,0x00}, /* 36 $ */
    {0x00,0x63,0x66,0x0C,0x18,0x33,0x63,0x00}, /* 37 % */
    {0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00}, /* 38 & */
    {0x30,0x30,0x60,0x00,0x00,0x00,0x00,0x00}, /* 39 ' */
    {0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00}, /* 40 ( */
    {0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00}, /* 41 ) */
    {0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00}, /* 42 * */
    {0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00}, /* 43 + */
    {0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30}, /* 44 , */
    {0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00}, /* 45 - */
    {0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00}, /* 46 . */
    {0x06,0x0C,0x18,0x30,0x60,0xC0,0x80,0x00}, /* 47 / */
    {0x3C,0x66,0x6E,0x76,0x66,0x66,0x3C,0x00}, /* 48 0 */
    {0x18,0x38,0x18,0x18,0x18,0x18,0x7E,0x00}, /* 49 1 */
    {0x3C,0x66,0x06,0x0C,0x18,0x30,0x7E,0x00}, /* 50 2 */
    {0x3C,0x66,0x06,0x1C,0x06,0x66,0x3C,0x00}, /* 51 3 */
    {0x0C,0x1C,0x34,0x64,0x7E,0x04,0x0E,0x00}, /* 52 4 */
    {0x7E,0x60,0x7C,0x06,0x06,0x66,0x3C,0x00}, /* 53 5 */
    {0x1C,0x30,0x60,0x7C,0x66,0x66,0x3C,0x00}, /* 54 6 */
    {0x7E,0x06,0x0C,0x18,0x30,0x30,0x30,0x00}, /* 55 7 */
    {0x3C,0x66,0x66,0x3C,0x66,0x66,0x3C,0x00}, /* 56 8 */
    {0x3C,0x66,0x66,0x3E,0x06,0x0C,0x38,0x00}, /* 57 9 */
    {0x00,0x18,0x18,0x00,0x18,0x18,0x00,0x00}, /* 58 : */
    {0x00,0x18,0x18,0x00,0x18,0x18,0x30,0x00}, /* 59 ; */
    {0x0E,0x1C,0x38,0x70,0x38,0x1C,0x0E,0x00}, /* 60 < */
    {0x00,0x7E,0x00,0x7E,0x00,0x00,0x00,0x00}, /* 61 = */
    {0x70,0x38,0x1C,0x0E,0x1C,0x38,0x70,0x00}, /* 62 > */
    {0x3C,0x66,0x06,0x0C,0x18,0x00,0x18,0x00}, /* 63 ? */
    {0x3C,0x42,0x99,0xA5,0xA5,0x9E,0x40,0x3C}, /* 64 @ */
    {0x18,0x3C,0x66,0x66,0x7E,0x66,0x66,0x00}, /* 65 A */
    {0x7C,0x66,0x66,0x7C,0x66,0x66,0x7C,0x00}, /* 66 B */
    {0x3C,0x66,0x60,0x60,0x60,0x66,0x3C,0x00}, /* 67 C */
    {0x78,0x6C,0x66,0x66,0x66,0x6C,0x78,0x00}, /* 68 D */
    {0x7E,0x60,0x60,0x7C,0x60,0x60,0x7E,0x00}, /* 69 E */
    {0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x00}, /* 70 F */
    {0x3C,0x66,0x60,0x6E,0x66,0x66,0x3E,0x00}, /* 71 G */
    {0x66,0x66,0x66,0x7E,0x66,0x66,0x66,0x00}, /* 72 H */
    {0x3C,0x18,0x18,0x18,0x18,0x18,0x3C,0x00}, /* 73 I */
    {0x1E,0x0C,0x0C,0x0C,0x0C,0x6C,0x38,0x00}, /* 74 J */
    {0x66,0x6C,0x78,0x70,0x78,0x6C,0x66,0x00}, /* 75 K */
    {0x60,0x60,0x60,0x60,0x60,0x60,0x7E,0x00}, /* 76 L */
    {0x63,0x77,0x7F,0x6B,0x63,0x63,0x63,0x00}, /* 77 M */
    {0x66,0x76,0x7E,0x7E,0x6E,0x66,0x66,0x00}, /* 78 N */
    {0x3C,0x66,0x66,0x66,0x66,0x66,0x3C,0x00}, /* 79 O */
    {0x7C,0x66,0x66,0x7C,0x60,0x60,0x60,0x00}, /* 80 P */
    {0x3C,0x66,0x66,0x66,0x6A,0x6C,0x36,0x00}, /* 81 Q */
    {0x7C,0x66,0x66,0x7C,0x6C,0x66,0x66,0x00}, /* 82 R */
    {0x3C,0x66,0x60,0x3C,0x06,0x66,0x3C,0x00}, /* 83 S */
    {0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x00}, /* 84 T */
    {0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00}, /* 85 U */
    {0x66,0x66,0x66,0x66,0x66,0x3C,0x18,0x00}, /* 86 V */
    {0x63,0x63,0x63,0x6B,0x7F,0x77,0x63,0x00}, /* 87 W */
    {0x66,0x66,0x3C,0x18,0x3C,0x66,0x66,0x00}, /* 88 X */
    {0x66,0x66,0x66,0x3C,0x18,0x18,0x18,0x00}, /* 89 Y */
    {0x7E,0x06,0x0C,0x18,0x30,0x60,0x7E,0x00}, /* 90 Z */
    {0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00}, /* 91 [ */
    {0xC0,0x60,0x30,0x18,0x0C,0x06,0x02,0x00}, /* 92 \ */
    {0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00}, /* 93 ] */
    {0x10,0x38,0x6C,0xC6,0x00,0x00,0x00,0x00}, /* 94 ^ */
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF}, /* 95 _ */
    {0x30,0x18,0x0C,0x00,0x00,0x00,0x00,0x00}, /* 96 ` */
    {0x00,0x00,0x3C,0x06,0x3E,0x66,0x3E,0x00}, /* 97 a */
    {0x60,0x60,0x7C,0x66,0x66,0x66,0x7C,0x00}, /* 98 b */
    {0x00,0x00,0x3C,0x66,0x60,0x66,0x3C,0x00}, /* 99 c */
    {0x06,0x06,0x3E,0x66,0x66,0x66,0x3E,0x00}, /* 100 d */
    {0x00,0x00,0x3C,0x66,0x7E,0x60,0x3C,0x00}, /* 101 e */
    {0x1C,0x30,0x30,0x78,0x30,0x30,0x30,0x00}, /* 102 f */
    {0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x3C}, /* 103 g */
    {0x60,0x60,0x7C,0x66,0x66,0x66,0x66,0x00}, /* 104 h */
    {0x18,0x00,0x38,0x18,0x18,0x18,0x3C,0x00}, /* 105 i */
    {0x0C,0x00,0x1C,0x0C,0x0C,0x0C,0x6C,0x38}, /* 106 j */
    {0x60,0x60,0x66,0x6C,0x78,0x6C,0x66,0x00}, /* 107 k */
    {0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00}, /* 108 l */
    {0x00,0x00,0x66,0x7F,0x7F,0x6B,0x63,0x00}, /* 109 m */
    {0x00,0x00,0x7C,0x66,0x66,0x66,0x66,0x00}, /* 110 n */
    {0x00,0x00,0x3C,0x66,0x66,0x66,0x3C,0x00}, /* 111 o */
    {0x00,0x00,0x7C,0x66,0x66,0x7C,0x60,0x60}, /* 112 p */
    {0x00,0x00,0x3E,0x66,0x66,0x3E,0x06,0x06}, /* 113 q */
    {0x00,0x00,0x7C,0x66,0x60,0x60,0x60,0x00}, /* 114 r */
    {0x00,0x00,0x3E,0x60,0x3C,0x06,0x7C,0x00}, /* 115 s */
    {0x18,0x18,0x7E,0x18,0x18,0x18,0x0E,0x00}, /* 116 t */
    {0x00,0x00,0x66,0x66,0x66,0x66,0x3E,0x00}, /* 117 u */
    {0x00,0x00,0x66,0x66,0x66,0x3C,0x18,0x00}, /* 118 v */
    {0x00,0x00,0x63,0x6B,0x7F,0x3E,0x36,0x00}, /* 119 w */
    {0x00,0x00,0x66,0x3C,0x18,0x3C,0x66,0x00}, /* 120 x */
    {0x00,0x00,0x66,0x66,0x66,0x3E,0x06,0x3C}, /* 121 y */
    {0x00,0x00,0x7E,0x0C,0x18,0x30,0x7E,0x00}, /* 122 z */
    {0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00}, /* 123 { */
    {0x18,0x18,0x18,0x00,0x18,0x18,0x18,0x00}, /* 124 | */
    {0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00}, /* 125 } */
    {0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00}  /* 126 ~ */
};

/* ============================================================================
 * JSON PARSER HELPERS
 * ============================================================================ */
static bool json_find_key(const char *json, const char *key, const char **out_val)
{
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return false;

    p += strlen(pattern);
    while (*p && (*p == ' ' || *p == ':' || *p == '\t' || *p == '\r' || *p == '\n')) {
        p++;
    }
    *out_val = p;
    return true;
}

static bool json_get_bool(const char *json, const char *key, bool *out_val)
{
    const char *val;
    if (!json_find_key(json, key, &val)) return false;
    if (strncmp(val, "true", 4) == 0) {
        *out_val = true;
        return true;
    } else if (strncmp(val, "false", 5) == 0) {
        *out_val = false;
        return true;
    }
    return false;
}

static bool json_get_int(const char *json, const char *key, int *out_val)
{
    const char *val;
    if (!json_find_key(json, key, &val)) return false;

    char *endptr;
    long num = strtol(val, &endptr, 10);
    if (endptr == val) return false;
    *out_val = (int)num;
    return true;
}

static bool json_get_string(const char *json, const char *key, char *out_buf, size_t max_len)
{
    const char *val;
    if (!json_find_key(json, key, &val)) return false;
    if (*val != '\"') return false;

    val++;
    size_t idx = 0;
    while (*val && *val != '\"' && idx < max_len - 1) {
        if (*val == '\\' && *(val + 1)) {
            val++;
        }
        out_buf[idx++] = *val++;
    }
    out_buf[idx] = '\0';
    return true;
}

/* ============================================================================
 * DISPLAY DRIVER FUNCTIONS
 * ============================================================================ */
static void lcd_cmd(uint8_t cmd)
{
    gpio_set_level(PIN_DC, 0);
    /* 1-byte transfers go through the SPI FIFO (tx_data), no DMA descriptor needed */
    spi_transaction_t t = {
        .flags = SPI_TRANS_USE_TXDATA,
        .length = 8,
    };
    t.tx_data[0] = cmd;
    spi_device_polling_transmit(s_spi_lcd, &t);
}

static void lcd_data(const uint8_t *data, int len)
{
    if (len <= 0) return;
    gpio_set_level(PIN_DC, 1);
    spi_transaction_t t = {
        .length = (size_t)len * 8,
    };
    if (len <= 4) {
        t.flags = SPI_TRANS_USE_TXDATA;
        memcpy(t.tx_data, data, (size_t)len);
    } else {
        t.tx_buffer = data;
    }
    spi_device_polling_transmit(s_spi_lcd, &t);
}

static void lcd_set_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    uint8_t caset[4] = { (uint8_t)(x0 >> 8), (uint8_t)(x0 & 0xFF), (uint8_t)(x1 >> 8), (uint8_t)(x1 & 0xFF) };
    uint8_t raset[4] = { (uint8_t)(y0 >> 8), (uint8_t)(y0 & 0xFF), (uint8_t)(y1 >> 8), (uint8_t)(y1 & 0xFF) };

    lcd_cmd(0x2A);
    lcd_data(caset, 4);

    lcd_cmd(0x2B);
    lcd_data(raset, 4);

    lcd_cmd(0x2C);
}

/**
 * Generic ST7796 / ILI9488-style bring-up: reset, sleep out, 18-bit colour,
 * portrait MADCTL, display on. No panel-specific VCOM / inversion tuning.
 */
static void lcd_init_hardware(void)
{
    /* Hardware reset pulse */
    gpio_set_level(PIN_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(50));
    gpio_set_level(PIN_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(150));

    lcd_cmd(0x01); /* Software Reset */
    vTaskDelay(pdMS_TO_TICKS(150));

    lcd_cmd(0x11); /* Sleep Out */
    vTaskDelay(pdMS_TO_TICKS(150));

#if CONFIG_KAIGO_LCD_ILI9488_TUNING
    /* Standard ILI9488 panel tuning (same values as the widely used TFT_eSPI /
     * Adafruit init). Without power control, VCOM and frame-rate settings the
     * panel runs on reset defaults, which commonly shows as flicker / shimmer.
     * On an ST7796 these extended registers are locked and simply ignored. */
    {
        uint8_t pgamma[15] = {0x00, 0x03, 0x09, 0x08, 0x16, 0x0A, 0x3F, 0x78, 0x4C, 0x09, 0x0A, 0x08, 0x16, 0x1A, 0x0F};
        uint8_t ngamma[15] = {0x00, 0x16, 0x19, 0x03, 0x0F, 0x05, 0x32, 0x45, 0x46, 0x04, 0x0E, 0x0D, 0x35, 0x37, 0x0F};
        uint8_t pwr1[2]   = {0x17, 0x15};        /* Power Control 1: VREG1OUT / VREG2OUT */
        uint8_t pwr2[1]   = {0x41};              /* Power Control 2: VGH / VGL */
        uint8_t vcom[3]   = {0x00, 0x12, 0x80};  /* VCOM Control */
        uint8_t ifmode[1] = {0x00};              /* Interface Mode Control */
        uint8_t frmctr[1] = {0xA0};              /* Frame Rate Control: 60 Hz */
        uint8_t invctr[1] = {0x02};              /* Display Inversion Control: 2-dot */
        uint8_t dfunc[3]  = {0x02, 0x02, 0x3B};  /* Display Function Control */
        uint8_t entry[1]  = {0xC6};              /* Entry Mode Set */
        uint8_t adj3[4]   = {0xA9, 0x51, 0x2C, 0x82}; /* Adjust Control 3 */

        lcd_cmd(0xE0); lcd_data(pgamma, sizeof(pgamma));
        lcd_cmd(0xE1); lcd_data(ngamma, sizeof(ngamma));
        lcd_cmd(0xC0); lcd_data(pwr1, sizeof(pwr1));
        lcd_cmd(0xC1); lcd_data(pwr2, sizeof(pwr2));
        lcd_cmd(0xC5); lcd_data(vcom, sizeof(vcom));
        lcd_cmd(0xB0); lcd_data(ifmode, sizeof(ifmode));
        lcd_cmd(0xB1); lcd_data(frmctr, sizeof(frmctr));
        lcd_cmd(0xB4); lcd_data(invctr, sizeof(invctr));
        lcd_cmd(0xB6); lcd_data(dfunc, sizeof(dfunc));
        lcd_cmd(0xB7); lcd_data(entry, sizeof(entry));
        lcd_cmd(0xF7); lcd_data(adj3, sizeof(adj3));
    }
#endif

    /* Interface Pixel Format: 18-bit RGB666 */
    uint8_t pixfmt = 0x66;
    lcd_cmd(0x3A);
    lcd_data(&pixfmt, 1);

    /* MADCTL: Portrait, pins DOWN, RGB order (0x40). Use 0x48 if R/B look swapped. */
    uint8_t madctl = 0x40;
    lcd_cmd(0x36);
    lcd_data(&madctl, 1);

    lcd_cmd(0x29); /* Display ON */
    vTaskDelay(pdMS_TO_TICKS(100));
}

static void lcd_fill_rect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, color_t c)
{
    if (x >= LCD_W || y >= LCD_H || w == 0 || h == 0) return;
    if (x + w > LCD_W) w = LCD_W - x;
    if (y + h > LCD_H) h = LCD_H - y;

    lcd_set_window(x, y, x + w - 1, y + h - 1);
    gpio_set_level(PIN_DC, 1);

    uint32_t total_pixels = (uint32_t)w * h;
    uint32_t max_pixels_per_chunk = (LCD_W * LINES_PER_BATCH);
    /* Only pre-fill as much of the DMA buffer as this rectangle will actually send */
    uint32_t prefill = (total_pixels < max_pixels_per_chunk) ? total_pixels : max_pixels_per_chunk;

    for (uint32_t i = 0; i < prefill; i++) {
        s_dma_buffer[i * 3 + 0] = c.r;
        s_dma_buffer[i * 3 + 1] = c.g;
        s_dma_buffer[i * 3 + 2] = c.b;
    }

    while (total_pixels > 0) {
        uint32_t chunk_pixels = (total_pixels > max_pixels_per_chunk) ? max_pixels_per_chunk : total_pixels;
        spi_transaction_t t = {
            .length = chunk_pixels * 3 * 8,
            .tx_buffer = s_dma_buffer,
        };
        spi_device_polling_transmit(s_spi_lcd, &t);
        total_pixels -= chunk_pixels;
    }
}

static void lcd_draw_rect_outline(uint16_t x, uint16_t y, uint16_t w, uint16_t h, uint16_t thickness, color_t c)
{
    lcd_fill_rect(x, y, w, thickness, c);
    lcd_fill_rect(x, y + h - thickness, w, thickness, c);
    lcd_fill_rect(x, y, thickness, h, c);
    lcd_fill_rect(x + w - thickness, y, thickness, h, c);
}

static void lcd_clear(color_t c)
{
    lcd_fill_rect(0, 0, LCD_W, LCD_H, c);
}

/**
 * Draws a single scaled character (8x8)
 * (0x80 >> col) ensures correct left-to-right rendering
 */
static void lcd_draw_char(uint16_t x, uint16_t y, char ch, uint8_t scale, color_t fg, color_t bg)
{
    if (x + 8 * scale > LCD_W || y + 8 * scale > LCD_H) return;

    const uint8_t *bitmap;
    if (ch >= 32 && ch <= 126) {
        bitmap = FONT8x8_BASIC[ch - 32];
    } else {
        bitmap = FONT8x8_BASIC['?' - 32];
    }

    uint16_t char_w = 8 * scale;
    uint16_t char_h = 8 * scale;
    lcd_set_window(x, y, x + char_w - 1, y + char_h - 1);

    gpio_set_level(PIN_DC, 1);
    uint32_t buf_idx = 0;

    for (int row = 0; row < 8; row++) {
        uint8_t row_bits = bitmap[row];
        for (int sy = 0; sy < scale; sy++) {
            for (int col = 0; col < 8; col++) {
                bool pixel_on = (row_bits & (0x80 >> col)) != 0;
                color_t color = pixel_on ? fg : bg;
                for (int sx = 0; sx < scale; sx++) {
                    s_dma_buffer[buf_idx + 0] = color.r;
                    s_dma_buffer[buf_idx + 1] = color.g;
                    s_dma_buffer[buf_idx + 2] = color.b;
                    buf_idx += 3;
                }
            }
        }
    }

    spi_transaction_t t = {
        .length = buf_idx * 8,
        .tx_buffer = s_dma_buffer,
    };
    spi_device_polling_transmit(s_spi_lcd, &t);
}

/**
 * Smart Word-Wrapping Text Renderer
 * Never splits words awkwardly across lines! Breaks cleanly on spaces.
 */
static void lcd_draw_string_wrapped(uint16_t x, uint16_t y, uint16_t max_w, const char *str, uint8_t scale, color_t fg, color_t bg)
{
    uint16_t cur_x = x;
    uint16_t cur_y = y;
    uint16_t char_w = 8 * scale;
    uint16_t line_h = 8 * scale + (scale * 3);

    size_t i = 0;
    while (str[i] != '\0') {
        if (str[i] == '\n') {
            cur_x = x;
            cur_y += line_h;
            i++;
            continue;
        }

        /* Skip leading whitespace at start of a line */
        if (cur_x == x && str[i] == ' ') {
            i++;
            continue;
        }

        /* Scan length of upcoming word */
        size_t word_len = 0;
        while (str[i + word_len] != '\0' && str[i + word_len] != ' ' && str[i + word_len] != '\n') {
            word_len++;
        }

        uint16_t word_w = word_len * char_w;

        /* If word exceeds remaining line width, wrap to next line */
        if (cur_x > x && (cur_x + word_w > x + max_w)) {
            cur_x = x;
            cur_y += line_h;
        }

        if (cur_y + 8 * scale > LCD_H) break;

        /* Draw word characters */
        for (size_t w = 0; w < word_len; w++) {
            if (cur_x + char_w <= LCD_W) {
                lcd_draw_char(cur_x, cur_y, str[i + w], scale, fg, bg);
            }
            cur_x += char_w;
        }

        i += word_len;

        /* Space separator */
        if (str[i] == ' ') {
            cur_x += char_w;
            i++;
        }
    }
}

static void lcd_draw_string(uint16_t x, uint16_t y, const char *str, uint8_t scale, color_t fg, color_t bg)
{
    lcd_draw_string_wrapped(x, y, LCD_W - x, str, scale, fg, bg);
}

static void lcd_draw_string_centered(uint16_t y, const char *str, uint8_t scale, color_t fg, color_t bg)
{
    int len = strlen(str);
    while (scale > 1 && (uint32_t)len * 8 * scale > (LCD_W - 16)) {
        scale--;
    }
    uint16_t text_w = len * 8 * scale;
    uint16_t x = (text_w < LCD_W) ? ((LCD_W - text_w) / 2) : 8;
    lcd_draw_string(x, y, str, scale, fg, bg);
}

/* ============================================================================
 * FLICKER-FREE CUTE ANIME FACES (5 UNIQUE EXPRESSIONS)
 * Draws each 40x40 eye atomically into s_dma_buffer in RAM before 1ms SPI burst!
 * ============================================================================ */
#define NUM_FACES 5

static void set_eye_pixel(uint8_t *buf, int x, int y, color_t c)
{
    if (x < 0 || x >= 40 || y < 0 || y >= 40) return;
    int idx = (y * 40 + x) * 3;
    buf[idx + 0] = c.r;
    buf[idx + 1] = c.g;
    buf[idx + 2] = c.b;
}

static void fill_eye_rect(uint8_t *buf, int x, int y, int w, int h, color_t c)
{
    for (int dy = 0; dy < h; dy++) {
        for (int dx = 0; dx < w; dx++) {
            set_eye_pixel(buf, x + dx, y + dy, c);
        }
    }
}

/**
 * Atomic 40x40 eye generator for zero-flicker rendering
 */
static void compose_eye_buffer(uint8_t *buf, int face_idx, bool is_right_eye, bool is_blinking)
{
    fill_eye_rect(buf, 0, 0, 40, 40, COLOR_BG_WHITE);

    if (is_blinking) {
        /* Happy closed squint arc: ⌒ */
        fill_eye_rect(buf, 6,  24, 6, 6, COLOR_EYE_DARK);
        fill_eye_rect(buf, 10, 18, 20, 6, COLOR_EYE_DARK);
        fill_eye_rect(buf, 28, 24, 6, 6, COLOR_EYE_DARK);
        return;
    }

    switch (face_idx) {
        case 0: /* Face 0: Classic Anime Sparkle */
        case 1: /* Face 1: Cat Sparkle */
        default: {
            fill_eye_rect(buf, 4, 4, 32, 32, COLOR_EYE_DARK);
            fill_eye_rect(buf, 8, 22, 24, 12, COLOR_EYE_SHINE);
            fill_eye_rect(buf, 20, 8, 10, 10, COLOR_WHITE);
            fill_eye_rect(buf, 8, 24, 5, 5, COLOR_WHITE);
            break;
        }

        case 2: { /* Face 2: Playful Wink (Left winks, Right sparkles) */
            if (!is_right_eye) {
                fill_eye_rect(buf, 6, 22, 28, 6, COLOR_EYE_DARK);
                fill_eye_rect(buf, 4, 16, 6, 8, COLOR_EYE_DARK);
            } else {
                fill_eye_rect(buf, 4, 4, 32, 32, COLOR_EYE_DARK);
                fill_eye_rect(buf, 8, 22, 24, 12, COLOR_EYE_SHINE);
                fill_eye_rect(buf, 20, 8, 10, 10, COLOR_WHITE);
                fill_eye_rect(buf, 8, 24, 5, 5, COLOR_WHITE);
            }
            break;
        }

        case 3: { /* Face 3: Heart Eyes */
            fill_eye_rect(buf, 12, 10, 6, 4, COLOR_HEART_RED);
            fill_eye_rect(buf, 22, 10, 6, 4, COLOR_HEART_RED);
            fill_eye_rect(buf, 9,  13, 22, 6, COLOR_HEART_RED);
            fill_eye_rect(buf, 11, 19, 18, 5, COLOR_HEART_RED);
            fill_eye_rect(buf, 14, 24, 12, 4, COLOR_HEART_RED);
            fill_eye_rect(buf, 17, 28, 6, 4, COLOR_HEART_RED);
            fill_eye_rect(buf, 19, 32, 2, 2, COLOR_HEART_RED);
            fill_eye_rect(buf, 13, 12, 3, 3, COLOR_WHITE);
            break;
        }

        case 4: { /* Face 4: Laughing Squint (⌒  ⌒) */
            fill_eye_rect(buf, 6,  24, 6, 6, COLOR_EYE_DARK);
            fill_eye_rect(buf, 10, 17, 20, 6, COLOR_EYE_DARK);
            fill_eye_rect(buf, 28, 24, 6, 6, COLOR_EYE_DARK);
            break;
        }
    }
}

static void lcd_push_eye(uint16_t x, uint16_t y, int face_idx, bool is_right_eye, bool is_blinking)
{
    compose_eye_buffer(s_dma_buffer, face_idx, is_right_eye, is_blinking);

    lcd_set_window(x, y, x + 40 - 1, y + 40 - 1);
    gpio_set_level(PIN_DC, 1);
    spi_transaction_t t = {
        .length = 40 * 40 * 3 * 8,
        .tx_buffer = s_dma_buffer,
    };
    spi_device_polling_transmit(s_spi_lcd, &t);
}

static void ui_draw_face(int face_idx, bool blinking, bool full_redraw)
{
    const uint16_t left_eye_x  = 80;
    const uint16_t right_eye_x = 200;
    const uint16_t eye_y       = 115;

    lcd_push_eye(left_eye_x, eye_y, face_idx, false, blinking);
    lcd_push_eye(right_eye_x, eye_y, face_idx, true, blinking);

    if (full_redraw) {
        /* 1. Eyebrows */
        lcd_fill_rect(82,  98, 36, 4, COLOR_EYE_DARK);
        lcd_fill_rect(202, 98, 36, 4, COLOR_EYE_DARK);

        /* 2. Rosy Blushing Cheeks */
        lcd_fill_rect(75,  166, 46, 14, COLOR_CHEEK_PINK);
        lcd_fill_rect(199, 166, 46, 14, COLOR_CHEEK_PINK);

        /* 3. Expression-Specific Mouth */
        lcd_fill_rect(140, 166, 40, 20, COLOR_BG_WHITE);

        switch (face_idx) {
            case 1: { /* Cat mouth "ω" */
                lcd_fill_rect(146, 170, 4, 4, COLOR_EYE_DARK);
                lcd_fill_rect(148, 174, 8, 3, COLOR_EYE_DARK);
                lcd_fill_rect(156, 170, 3, 4, COLOR_EYE_DARK);
                lcd_fill_rect(159, 170, 3, 4, COLOR_EYE_DARK);
                lcd_fill_rect(162, 174, 8, 3, COLOR_EYE_DARK);
                lcd_fill_rect(170, 170, 4, 4, COLOR_EYE_DARK);
                break;
            }

            case 3: { /* Heart eyes open smile: ( ᗜ ) */
                lcd_fill_rect(152, 168, 16, 3, COLOR_EYE_DARK);
                lcd_fill_rect(150, 171, 20, 8, COLOR_CHEEK_PINK);
                lcd_fill_rect(152, 179, 16, 2, COLOR_EYE_DARK);
                break;
            }

            case 4: { /* Laughing big mouth: [ ᗜ ] */
                lcd_fill_rect(148, 168, 24, 3, COLOR_EYE_DARK);
                lcd_fill_rect(148, 171, 24, 10, COLOR_CHEEK_PINK);
                lcd_fill_rect(150, 181, 20, 3, COLOR_EYE_DARK);
                break;
            }

            case 0:
            case 2:
            default: { /* Sweet cat/anime smile \_/ */
                lcd_fill_rect(152, 168, 4, 5, COLOR_EYE_DARK);
                lcd_fill_rect(154, 173, 12, 4, COLOR_EYE_DARK);
                lcd_fill_rect(164, 168, 4, 5, COLOR_EYE_DARK);
                break;
            }
        }
    }
}

/* ============================================================================
 * QUICK WELLNESS TIPS LIST
 * ============================================================================ */
static const char *s_quick_tips[] = {
    "Drink a warm glass of water",
    "Take 3 deep gentle breaths",
    "Enjoy a few mins of sunlight",
    "Roll your shoulders to stretch",
    "Remember your daily pills",
    "Call a loved one to say hi",
    "Keep a warm smile today!",
    "Rest your eyes and relax"
};
#define NUM_QUICK_TIPS (sizeof(s_quick_tips) / sizeof(s_quick_tips[0]))

static int s_tip_index = 0;
static int s_face_index = 0;
static int s_yes_click_count = 0;

static void ui_draw_tip_card_static(void)
{
    lcd_fill_rect(18, 272, 284, 136, COLOR_WHITE);
    lcd_draw_rect_outline(16, 270, 288, 140, 2, COLOR_CARD_BORDER);

    lcd_fill_rect(24, 278, 140, 24, COLOR_CARD_BG);
    lcd_draw_string(30, 282, "DAILY TIP", 2, COLOR_BLUE, COLOR_CARD_BG);

    lcd_draw_string_centered(382, "Press GREEN for new tip!", 1, COLOR_TEXT_MUTED, COLOR_WHITE);
}

static void ui_update_tip_card(const char *tip_str)
{
    /* Clear ONLY the text area inside the card */
    lcd_fill_rect(22, 312, 276, 62, COLOR_WHITE);
    lcd_draw_string_wrapped(26, 318, 268, tip_str, 2, COLOR_TEXT_MAIN, COLOR_WHITE);
}

/* Wi-Fi state the idle screen currently shows, so the loop can repaint on change */
static bool s_idle_badge_online = false;

static void ui_draw_wifi_badge(void)
{
    s_idle_badge_online = s_is_wifi_connected;
    lcd_fill_rect(LCD_W - 105, 12, 93, 22, COLOR_CARD_BG); /* clear both badge sizes */
    if (s_idle_badge_online) {
        lcd_fill_rect(LCD_W - 95, 12, 82, 22, COLOR_GREEN);
        lcd_draw_string(LCD_W - 88, 16, "ONLINE", 1, COLOR_WHITE, COLOR_GREEN);
    } else {
        lcd_fill_rect(LCD_W - 105, 12, 92, 22, COLOR_RED);
        lcd_draw_string(LCD_W - 98, 16, "OFFLINE", 1, COLOR_WHITE, COLOR_RED);
    }
}

static void ui_draw_idle_footer(void)
{
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 34, COLOR_CARD_BG);
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 1, COLOR_CARD_BORDER);
    char ip_str[48];
    snprintf(ip_str, sizeof(ip_str), "IP: %s", s_is_wifi_connected ? s_device_ip : "---");
    lcd_draw_string(14, LCD_H - 22, ip_str, 1, COLOR_TEXT_MUTED, COLOR_CARD_BG);
}

/* Called from the idle loop: repaints badge + footer when Wi-Fi drops or returns */
static void ui_refresh_idle_status_if_changed(void)
{
    if (s_is_wifi_connected != s_idle_badge_online) {
        ui_draw_wifi_badge();
        ui_draw_idle_footer();
    }
}

static void ui_draw_idle_screen(void)
{
    lcd_clear(COLOR_BG_WHITE);

    /* 1. Header Banner */
    lcd_fill_rect(0, 0, LCD_W, 46, COLOR_CARD_BG);
    lcd_fill_rect(0, 46, LCD_W, 2, COLOR_CARD_BORDER);
    lcd_draw_string(14, 14, "KAIGO HUB", 2, COLOR_TEXT_MAIN, COLOR_CARD_BG);
    ui_draw_wifi_badge();

    /* 2. Draw Cute Face */
    ui_draw_face(s_face_index, false, true);

    /* 3. Subtitle under face */
    lcd_draw_string_centered(225, "I am here with you", 2, COLOR_TEXT_MUTED, COLOR_BG_WHITE);

    /* 4. Tip Card frame and initial tip */
    ui_draw_tip_card_static();
    ui_update_tip_card(s_quick_tips[s_tip_index]);

    /* 5. Bottom Status Footer */
    ui_draw_idle_footer();
}

/* ============================================================================
 * QUESTION SCREENS (PORTRAIT 320x480)
 * ============================================================================ */
static void ui_draw_boolean_footer(void)
{
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 34, COLOR_CARD_BG);
    lcd_draw_string_centered(LCD_H - 22, "Press RED for NO, GREEN for YES", 1, COLOR_TEXT_MUTED, COLOR_CARD_BG);
}

static void ui_draw_boolean_question(const char *text)
{
    lcd_clear(COLOR_BG_WHITE);

    /* Header */
    lcd_fill_rect(0, 0, LCD_W, 46, COLOR_CARD_BG);
    lcd_fill_rect(0, 46, LCD_W, 2, COLOR_CARD_BORDER);
    lcd_draw_string_centered(14, "CAREGIVER QUESTION", 2, COLOR_BLUE, COLOR_CARD_BG);

    /* Question Card with Word-Wrapping */
    lcd_fill_rect(16, 60, 288, 150, COLOR_WHITE);
    lcd_draw_rect_outline(16, 60, 288, 150, 2, COLOR_CARD_BORDER);
    lcd_draw_string_wrapped(28, 80, 264, text, 2, COLOR_TEXT_MAIN, COLOR_WHITE);

    /* Red NO Button Card (280x76, perfectly centered) */
    lcd_fill_rect(20, 226, 280, 76, COLOR_RED);
    lcd_draw_rect_outline(20, 226, 280, 76, 2, COLOR_CARD_BORDER);
    lcd_draw_string_centered(245, "[ RED ]    NO", 2, COLOR_WHITE, COLOR_RED);
    lcd_draw_string_centered(273, "Press Red Button for NO", 1, COLOR_WHITE, COLOR_RED);

    /* Green YES Button Card (280x76, perfectly centered) */
    lcd_fill_rect(20, 318, 280, 76, COLOR_GREEN);
    lcd_draw_rect_outline(20, 318, 280, 76, 2, COLOR_CARD_BORDER);
    lcd_draw_string_centered(337, "[ GREEN ]   YES", 2, COLOR_WHITE, COLOR_GREEN);
    lcd_draw_string_centered(365, "Press Green Button for YES", 1, COLOR_WHITE, COLOR_GREEN);

    ui_draw_boolean_footer();
}

static int  s_current_q_id = 0;
static int  s_last_answered_q_id = -1;  /* ids are unique per question; never re-show one we delivered */
static char s_current_q_text[256] = "";
static char s_current_q_type[32] = "";

/* True if `word` occurs in `haystack` as a whole word (so "head" does not match "heading") */
static bool contains_whole_word(const char *haystack, const char *word)
{
    size_t wlen = strlen(word);
    const char *p = haystack;
    while ((p = strstr(p, word)) != NULL) {
        bool start_ok = (p == haystack) || !isalpha((unsigned char)p[-1]);
        bool end_ok   = !isalpha((unsigned char)p[wlen]);
        if (start_ok && end_ok) return true;
        p++;
    }
    return false;
}

/**
 * Heuristic: a range question is shown with pain-scale anchors when its text
 * contains one of these whole words/phrases. The server does not send an
 * explicit pain type, so this list is the only switch.
 */
static bool is_pain_question_c(const char *text)
{
    if (!text) return false;
    char lower[256];
    strncpy(lower, text, sizeof(lower) - 1);
    lower[sizeof(lower) - 1] = '\0';
    for (int i = 0; lower[i]; i++) {
        lower[i] = (char)tolower((unsigned char)lower[i]);
    }
    static const char *const keywords[] = {
        "pain", "painful", "dolor", "duele", "ache", "aches", "aching",
        "headache", "backache", "back pain", "hurt", "hurts", "hurting",
        "sore", "knee", "knees", "rodilla", "espalda", "joint", "joints", NULL
    };
    for (int i = 0; keywords[i]; i++) {
        if (contains_whole_word(lower, keywords[i])) return true;
    }
    return false;
}

static void ui_draw_range_footer(bool is_pain)
{
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 34, COLOR_CARD_BG);
    if (is_pain) {
        lcd_draw_string_centered(LCD_H - 22, "1 = No Pain   10 = Severe Pain", 1, COLOR_TEXT_MUTED, COLOR_CARD_BG);
    } else {
        lcd_draw_string_centered(LCD_H - 22, "Turn DIAL to set, press GREEN", 1, COLOR_TEXT_MUTED, COLOR_CARD_BG);
    }
}

static void ui_draw_range_question_static(const char *text)
{
    lcd_clear(COLOR_BG_WHITE);

    bool is_pain = is_pain_question_c(text);

    /* Header */
    lcd_fill_rect(0, 0, LCD_W, 46, COLOR_CARD_BG);
    lcd_fill_rect(0, 46, LCD_W, 2, COLOR_CARD_BORDER);
    if (is_pain) {
        lcd_draw_string_centered(14, "PAIN SCALE: 1 TO 10", 2, COLOR_RED, COLOR_CARD_BG);
    } else {
        lcd_draw_string_centered(14, "RATE 1 TO 10", 2, COLOR_BLUE, COLOR_CARD_BG);
    }

    /* Question Card with Word-Wrapping */
    lcd_fill_rect(16, 56, 288, 104, COLOR_WHITE);
    lcd_draw_rect_outline(16, 56, 288, 104, 2, COLOR_CARD_BORDER);
    lcd_draw_string_wrapped(28, 70, 264, text, 2, COLOR_TEXT_MAIN, COLOR_WHITE);

    /* Green Confirm Button Box */
    lcd_fill_rect(20, 330, 280, 80, COLOR_GREEN);
    lcd_draw_rect_outline(20, 330, 280, 80, 2, COLOR_CARD_BORDER);
    lcd_draw_string_centered(343, "CONFIRM", 4, COLOR_WHITE, COLOR_GREEN);
    lcd_draw_string_centered(383, "[ GREEN BUTTON ]", 1, COLOR_WHITE, COLOR_GREEN);

    ui_draw_range_footer(is_pain);
}

static void ui_update_range_slider(int current_val)
{
    /* Clear ONLY the dynamic numeric text and label area */
    lcd_fill_rect(20, 170, 280, 85, COLOR_BG_WHITE);

    bool is_pain = is_pain_question_c(s_current_q_text);
    const char *desc = "";
    color_t val_color = COLOR_GREEN;

    if (is_pain) {
        if (current_val <= 1) {
            desc = "NO PAIN";
            val_color = COLOR_GREEN;
        } else if (current_val <= 3) {
            desc = "MILD PAIN";
            val_color = COLOR_GREEN;
        } else if (current_val <= 6) {
            desc = "MODERATE PAIN";
            val_color = COLOR_AMBER;
        } else if (current_val <= 8) {
            desc = "SEVERE PAIN";
            val_color = COLOR_RED;
        } else {
            desc = "UNBEARABLE";
            val_color = COLOR_RED;
        }
    } else {
        if (current_val <= 3) {
            desc = "POOR / LOW";
            val_color = COLOR_RED;
        } else if (current_val <= 6) {
            desc = "FAIR / MODERATE";
            val_color = COLOR_AMBER;
        } else {
            desc = "GREAT / RESTFUL";
            val_color = COLOR_GREEN;
        }
    }

    char num_buf[16];
    snprintf(num_buf, sizeof(num_buf), "%d / 10", current_val);
    lcd_draw_string_centered(175, num_buf, 4, val_color, COLOR_BG_WHITE);
    lcd_draw_string_centered(215, desc, 2, val_color, COLOR_BG_WHITE);

    /* Horizontal Segment Bar */
    uint16_t bar_x = 30;
    uint16_t bar_y = 265;
    uint16_t bar_w = 260;
    uint16_t bar_h = 24;

    uint16_t fill_w = (bar_w * current_val) / 10;
    lcd_fill_rect(bar_x, bar_y, fill_w, bar_h, val_color);
    if (fill_w < bar_w) {
        lcd_fill_rect(bar_x + fill_w, bar_y, bar_w - fill_w, bar_h, COLOR_LIGHT_GRAY);
    }
    lcd_draw_rect_outline(bar_x, bar_y, bar_w, bar_h, 1, COLOR_CARD_BORDER);
}

/**
 * Result screen after an answer. `sent` is the real HTTP outcome: the senior
 * must never be told the caregiver was notified when the request failed.
 */
static void ui_draw_answered_screen(const char *ans, bool sent)
{
    lcd_clear(COLOR_BG_WHITE);

    lcd_fill_rect(16, 70, 288, 320, COLOR_WHITE);
    lcd_draw_rect_outline(16, 70, 288, 320, 2, COLOR_CARD_BORDER);

    char buf[64];
    snprintf(buf, sizeof(buf), "\" %s \"", ans);

    if (sent) {
        lcd_draw_string_centered(110, "RESPONSE SENT!", 2, COLOR_GREEN, COLOR_WHITE);
        lcd_draw_string_centered(190, buf, 4, COLOR_TEXT_MAIN, COLOR_WHITE);
        lcd_draw_string_centered(280, "Thank you!", 2, COLOR_TEXT_MUTED, COLOR_WHITE);
        lcd_draw_string_centered(310, "Caregiver has been notified", 1, COLOR_TEXT_MUTED, COLOR_WHITE);
    } else {
        lcd_draw_string_centered(110, "NOT SENT", 2, COLOR_RED, COLOR_WHITE);
        lcd_draw_string_centered(190, buf, 4, COLOR_TEXT_MAIN, COLOR_WHITE);
        lcd_draw_string_centered(280, "No connection", 2, COLOR_RED, COLOR_WHITE);
        lcd_draw_string_centered(310, "The question will be asked again", 1, COLOR_TEXT_MUTED, COLOR_WHITE);
    }
}

/* Shown the moment the 3-second SOS hold is confirmed, before the HTTP attempts */
static void ui_draw_sos_screen(void)
{
    lcd_clear(COLOR_RED);

    lcd_fill_rect(20, 50, 280, 360, COLOR_WHITE);

    lcd_draw_string_centered(90,  "EMERGENCY", 4, COLOR_RED, COLOR_WHITE);
    lcd_draw_string_centered(140, "SOS ALERT", 4, COLOR_RED, COLOR_WHITE);

    lcd_draw_string_centered(230, "SENDING ALERT...", 2, COLOR_TEXT_MAIN, COLOR_WHITE);
}

/* Replaces the "SENDING..." line with the real outcome of the SOS post */
static void ui_update_sos_status(bool sent)
{
    lcd_fill_rect(24, 220, 272, 130, COLOR_WHITE);
    if (sent) {
        lcd_draw_string_centered(230, "FAMILY NOTIFIED", 2, COLOR_TEXT_MAIN, COLOR_WHITE);
        lcd_draw_string_centered(270, "Alert sent to family", 2, COLOR_RED, COLOR_WHITE);
        lcd_draw_string_centered(330, "Stay calm, help is on the way", 1, COLOR_TEXT_MUTED, COLOR_WHITE);
    } else {
        lcd_draw_string_centered(230, "ALERT NOT SENT", 2, COLOR_RED, COLOR_WHITE);
        lcd_draw_string_centered(270, "No connection", 2, COLOR_RED, COLOR_WHITE);
        lcd_draw_string_centered(330, "Please call for help by phone", 1, COLOR_TEXT_MAIN, COLOR_WHITE);
    }
}

/* ============================================================================
 * INPUTS: BUTTONS & ADC POTENTIOMETER
 * ============================================================================ */
static void gpio_init_all(void)
{
    gpio_config_t btn_cfg = {
        .pin_bit_mask = (1ULL << PIN_BTN_NO) | (1ULL << PIN_BTN_YES) | (1ULL << PIN_BTN_SOS),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&btn_cfg);

    gpio_config_t lcd_ctrl = {
        .pin_bit_mask = (1ULL << PIN_DC) | (1ULL << PIN_RST),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&lcd_ctrl);
    gpio_set_level(PIN_DC, 1);
    gpio_set_level(PIN_RST, 1);
}

static void adc_init_potentiometer(void)
{
    adc_oneshot_unit_init_cfg_t init_config = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_config, &s_adc_handle));

    adc_oneshot_chan_cfg_t chan_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc_handle, PIN_POT_ADC_CH, &chan_config));
}

#define POT_SAMPLES        16
#define POT_HYSTERESIS_RAW 60   /* ADC counts the wiper must move past a step edge before the value changes */

static int read_potentiometer_raw(void)
{
    int sum = 0;
    for (int i = 0; i < POT_SAMPLES; i++) {
        int raw = 0;
        if (adc_oneshot_read(s_adc_handle, PIN_POT_ADC_CH, &raw) == ESP_OK) {
            sum += raw;
        }
    }
    return sum / POT_SAMPLES;
}

/* 12-bit reading -> 1..10 in ten equal steps, so 10 is reachable from ~90% travel */
static int pot_raw_to_scale(int raw)
{
    int mapped = (raw * 10) / 4096 + 1;
    if (mapped < 1) mapped = 1;
    if (mapped > 10) mapped = 10;
    return mapped;
}

/**
 * Hysteresis: a reading must sit a clear margin inside a neighbouring step
 * before the displayed value moves, so a wiper resting on a step edge does
 * not flicker between two numbers.
 */
static int pot_scale_with_hysteresis(int raw, int last_val)
{
    if (last_val < 1) return pot_raw_to_scale(raw);
    int up   = pot_raw_to_scale(raw - POT_HYSTERESIS_RAW);
    int down = pot_raw_to_scale(raw + POT_HYSTERESIS_RAW);
    if (up > last_val)   return up;
    if (down < last_val) return down;
    return last_val;
}

static bool check_button_pressed(gpio_num_t pin)
{
    if (gpio_get_level(pin) == 0) {
        vTaskDelay(pdMS_TO_TICKS(40)); /* Debounce */
        if (gpio_get_level(pin) == 0) {
            /* Wait for button release to prevent continuous re-triggering */
            int timeout = 0;
            while (gpio_get_level(pin) == 0 && timeout < 25) {
                vTaskDelay(pdMS_TO_TICKS(20));
                timeout++;
            }
            return true;
        }
    }
    return false;
}

/* ----------------------------------------------------------------------------
 * SOS hold feedback: a "keep holding" bar drawn over the footer strip of
 * whatever screen is showing. The main loop restores the footer when the
 * button is released early (s_sos_overlay_active tells it to).
 * -------------------------------------------------------------------------- */
static bool s_sos_overlay_active = false;

static void ui_sos_hold_begin(void)
{
    s_sos_overlay_active = true;
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 34, COLOR_WHITE);
    lcd_fill_rect(0, LCD_H - 34, LCD_W, 2, COLOR_RED);
    lcd_draw_string_centered(LCD_H - 30, "KEEP HOLDING FOR SOS", 1, COLOR_RED, COLOR_WHITE);
    lcd_draw_rect_outline(20, LCD_H - 16, 280, 12, 1, COLOR_RED);
}

/* Grows the bar from prev_percent to percent, painting only the new slice */
static void ui_sos_hold_progress(int prev_percent, int percent)
{
    const uint16_t inner_x = 22;
    const uint16_t inner_w = 276;
    uint16_t prev_w = (uint16_t)(inner_w * prev_percent / 100);
    uint16_t new_w  = (uint16_t)(inner_w * percent / 100);
    if (new_w > prev_w) {
        lcd_fill_rect(inner_x + prev_w, LCD_H - 14, new_w - prev_w, 8, COLOR_RED);
    }
}

/**
 * 3-Second Hold Guard for SOS Button:
 * Prevents accidental bumps or taps. The senior must deliberately press
 * and hold the SOS button for 3.0 continuous seconds to activate an emergency alert.
 * While held, a progress bar fills in the footer so they know to keep pressing.
 */
static bool check_sos_long_press(void)
{
    if (gpio_get_level(PIN_BTN_SOS) != 0) {
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(40)); /* Debounce */
    if (gpio_get_level(PIN_BTN_SOS) != 0) {
        return false;
    }

    ESP_LOGI(TAG, "SOS button pressed, holding for 3-second deliberate confirmation...");
    const int required_hold_ms = 3000;
    const int step_ms = 50;
    int elapsed_ms = 40;
    int prev_pct = 0;

    ui_sos_hold_begin();

    while (gpio_get_level(PIN_BTN_SOS) == 0) {
        vTaskDelay(pdMS_TO_TICKS(step_ms));
        elapsed_ms += step_ms;

        int pct = elapsed_ms * 100 / required_hold_ms;
        if (pct > 100) pct = 100;
        ui_sos_hold_progress(prev_pct, pct);
        prev_pct = pct;

        if (elapsed_ms >= required_hold_ms) {
            /* Return immediately so the alert goes out now, even if the senior
             * keeps holding. The caller waits for release after the SOS flow. */
            ESP_LOGW(TAG, "SOS 3-second hold confirmed! Activating emergency alert.");
            return true;
        }
    }

    ESP_LOGI(TAG, "SOS button released early (%d ms) - accidental press ignored", elapsed_ms);
    return false; /* caller repaints the footer (s_sos_overlay_active is still set) */
}

/* ============================================================================
 * SPI BUS INITIALIZATION (20 MHz FOR MAXIMUM SIGNAL INTEGRITY)
 * ============================================================================ */
static void spi_init_lcd(void)
{
    spi_bus_config_t buscfg = {
        .mosi_io_num = PIN_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = PIN_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = DMA_BUF_SIZE + 32,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO));

    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = 20 * 1000 * 1000, /* 20 MHz: Rock-solid stability on ST7796/ILI9488 */
        .mode = 0,
        .spics_io_num = PIN_CS,
        .queue_size = 1,
        .flags = 0,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &devcfg, &s_spi_lcd));

    s_dma_buffer = heap_caps_malloc(DMA_BUF_SIZE, MALLOC_CAP_DMA);
    assert(s_dma_buffer != NULL);
}

/* ============================================================================
 * WI-FI EVENT HANDLER
 * ============================================================================ */
/* ----------------------------------------------------------------------------
 * Reconnect with backoff. Hammering esp_wifi_connect() every ~2.4 s while the
 * hotspot is off means a full-power scan burst every 2.4 s; on a weak USB
 * supply those current spikes dip the 3.3 V rail and the LCD backlight with it.
 * -------------------------------------------------------------------------- */
#define WIFI_BACKOFF_MIN_MS 1000
#define WIFI_BACKOFF_MAX_MS 10000   /* capped low so an SOS never waits long for Wi-Fi */

static esp_timer_handle_t s_wifi_retry_timer = NULL;
static uint32_t s_wifi_backoff_ms = WIFI_BACKOFF_MIN_MS;

static void wifi_retry_timer_cb(void *arg)
{
    esp_wifi_connect();
}

/* Skip the backoff and try to connect right now (used when SOS is pressed offline) */
static void wifi_reconnect_now(void)
{
    if (s_is_wifi_connected) return;
    if (s_wifi_retry_timer) esp_timer_stop(s_wifi_retry_timer); /* ESP_ERR_INVALID_STATE if idle: fine */
    esp_wifi_connect();
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *d = (wifi_event_sta_disconnected_t *)event_data;
        s_is_wifi_connected = false;
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ESP_LOGW(TAG, "Wi-Fi disconnected (reason %d), retrying in %lu ms",
                 d ? (int)d->reason : -1, (unsigned long)s_wifi_backoff_ms);
        if (s_wifi_retry_timer) {
            esp_timer_stop(s_wifi_retry_timer);
            esp_timer_start_once(s_wifi_retry_timer, (uint64_t)s_wifi_backoff_ms * 1000ULL);
        } else {
            esp_wifi_connect();
        }
        s_wifi_backoff_ms *= 2;
        if (s_wifi_backoff_ms > WIFI_BACKOFF_MAX_MS) s_wifi_backoff_ms = WIFI_BACKOFF_MAX_MS;
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        snprintf(s_device_ip, sizeof(s_device_ip), IPSTR, IP2STR(&event->ip_info.ip));
        s_is_wifi_connected = true;
        s_wifi_backoff_ms = WIFI_BACKOFF_MIN_MS;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ESP_LOGI(TAG, "Wi-Fi Connected. Device IP: %s", s_device_ip);
        esp_netif_sntp_start(); /* (re)sync the clock every time we get an address */
    }
}

static void time_sync_init(void);

static void wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    const esp_timer_create_args_t retry_args = {
        .callback = wifi_retry_timer_cb,
        .name = "wifi_retry",
    };
    ESP_ERROR_CHECK(esp_timer_create(&retry_args, &s_wifi_retry_timer));

    time_sync_init(); /* before esp_wifi_start, so got-IP can always start SNTP */

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    /* Cap TX power: lower current spikes on the shared 3.3 V rail. The hotspot
     * is a laptop in the same room, so 15 dBm is plenty. Unit is 0.25 dBm. */
    esp_err_t pwr_err = esp_wifi_set_max_tx_power((int8_t)(CONFIG_KAIGO_WIFI_MAX_TX_POWER_DBM * 4));
    if (pwr_err != ESP_OK) {
        ESP_LOGW(TAG, "Could not cap Wi-Fi TX power: %s", esp_err_to_name(pwr_err));
    }
}

/* ============================================================================
 * REAL-TIME CLOCK (SNTP, with the KAIGO server as a fallback clock)
 * ============================================================================ */
#define TIME_VALID_AFTER_EPOCH 1704067200LL   /* 2024-01-01: anything earlier is "never synced" */

static bool time_is_valid(void)
{
    return (long long)time(NULL) >= TIME_VALID_AFTER_EPOCH;
}

static void log_local_time(const char *source)
{
    time_t now = time(NULL);
    struct tm tm_local;
    localtime_r(&now, &tm_local);
    char buf[40];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S %Z", &tm_local);
    ESP_LOGI(TAG, "Clock set from %s: %s", source, buf);
}

static void sntp_sync_cb(struct timeval *tv)
{
    log_local_time("SNTP");
}

static void time_sync_init(void)
{
    setenv("TZ", CONFIG_KAIGO_TIMEZONE, 1);
    tzset();

    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_KAIGO_NTP_SERVER);
    cfg.start = false;             /* started on every IP_EVENT_STA_GOT_IP */
    cfg.sync_cb = sntp_sync_cb;
    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "SNTP init failed: %s (server clock fallback still works)", esp_err_to_name(err));
    }
}

/* Fallback when the hotspot has no internet: adopt the server's clock */
static void time_adopt_server_clock(long long server_epoch)
{
    if (time_is_valid() || server_epoch < TIME_VALID_AFTER_EPOCH) return;
    struct timeval tv = { .tv_sec = (time_t)server_epoch, .tv_usec = 0 };
    settimeofday(&tv, NULL);
    log_local_time("KAIGO server");
}

/* ============================================================================
 * HTTP CLIENT IMPLEMENTATION
 * ============================================================================ */
static char s_http_response_buf[2048];
static int s_http_response_len = 0;

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (evt->data_len > 0) {
                int copy_len = evt->data_len;
                if (s_http_response_len + copy_len < (int)sizeof(s_http_response_buf) - 1) {
                    memcpy(s_http_response_buf + s_http_response_len, evt->data, copy_len);
                    s_http_response_len += copy_len;
                    s_http_response_buf[s_http_response_len] = '\0';
                }
            }
            break;
        default:
            break;
    }
    return ESP_OK;
}

static bool http_get_active_question(int *out_id, char *out_text, size_t max_text_len, char *out_type, size_t max_type_len, bool *out_active)
{
    *out_active = false;
    if (!s_is_wifi_connected) return false;

    s_http_response_len = 0;
    memset(s_http_response_buf, 0, sizeof(s_http_response_buf));

    char url[128];
    snprintf(url, sizeof(url), "%s/api/question", SERVER_BASE_URL);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 2500,
        .event_handler = http_event_handler,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return false;

    esp_err_t err = esp_http_client_perform(client);
    int status_code = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    /* Returns true whenever the server answered with a parseable "active" flag,
     * so callers can tell "no question right now" apart from "could not reach server". */
    if (err == ESP_OK && status_code == 200 && s_http_response_len > 0) {
        bool active = false;
        int server_time = 0;
        if (json_get_int(s_http_response_buf, "server_time", &server_time)) {
            time_adopt_server_clock((long long)server_time);
        }
        if (!json_get_bool(s_http_response_buf, "active", &active)) return false;
        *out_active = active;
        if (active) {
            json_get_int(s_http_response_buf, "id", out_id);
            json_get_string(s_http_response_buf, "text", out_text, max_text_len);
            json_get_string(s_http_response_buf, "type", out_type, max_type_len);
        }
        return true;
    }
    return false;
}

static bool http_post_answer(int question_id, const char *answer_str)
{
    if (!s_is_wifi_connected) return false;

    char url[128];
    snprintf(url, sizeof(url), "%s/api/answer", SERVER_BASE_URL);

    char post_data[128];
    snprintf(post_data, sizeof(post_data), "{\"id\":%d,\"answer\":\"%s\"}", question_id, answer_str);

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 3500,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return false;

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, post_data, strlen(post_data));

    esp_err_t err = esp_http_client_perform(client);
    int status_code = esp_http_client_get_status_code(client);

    esp_http_client_cleanup(client);
    return (err == ESP_OK && (status_code == 200 || status_code == 201));
}

static bool http_post_sos(void)
{
    if (!s_is_wifi_connected) return false;

    char url[128];
    snprintf(url, sizeof(url), "%s/api/sos", SERVER_BASE_URL);

    /* Only report a device timestamp once the clock is synced; the server
     * stamps the alert with its own clock either way. */
    char post_data[64];
    if (time_is_valid()) {
        snprintf(post_data, sizeof(post_data), "{\"timestamp\":%lld}", (long long)time(NULL));
    } else {
        snprintf(post_data, sizeof(post_data), "{}");
    }

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 4000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return false;

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, post_data, strlen(post_data));

    esp_err_t err = esp_http_client_perform(client);
    int status_code = esp_http_client_get_status_code(client);

    esp_http_client_cleanup(client);
    return (err == ESP_OK && (status_code == 200 || status_code == 201));
}

/* ============================================================================
 * STATE MACHINE & MAIN APPLICATION LOOP
 * ============================================================================ */
typedef enum {
    STATE_IDLE,
    STATE_SHOW_QUESTION
} app_state_t;

#define SOS_POST_ATTEMPTS 3

/* Repaints the footer strip of the current screen after the SOS hold bar was abandoned */
static void ui_restore_footer(app_state_t state)
{
    if (state == STATE_SHOW_QUESTION) {
        if (strcmp(s_current_q_type, "boolean") == 0) {
            ui_draw_boolean_footer();
        } else {
            ui_draw_range_footer(is_pain_question_c(s_current_q_text));
        }
    } else {
        ui_draw_idle_footer();
    }
}

/* Posts the answer, shows the real outcome for ~2.8 s, then returns to idle */
static void submit_answer_and_show_result(const char *ans_str)
{
    ESP_LOGI(TAG, "Selected: %s", ans_str);
    bool sent = http_post_answer(s_current_q_id, ans_str);
    if (sent) {
        s_last_answered_q_id = s_current_q_id;
    } else {
        ESP_LOGW(TAG, "Answer '%s' for question %d was NOT delivered (offline or server error)", ans_str, s_current_q_id);
    }
    ui_draw_answered_screen(ans_str, sent);
    vTaskDelay(pdMS_TO_TICKS(2800));
    ui_draw_idle_screen();
}

static void kaigo_main_task(void *pvParameters)
{
    app_state_t state = STATE_IDLE;
    int last_dial_val = -1;
    TickType_t last_poll_tick = 0;
    TickType_t last_blink_tick = 0;
    bool is_blinking = false;

    ui_draw_idle_screen();

    while (1) {
        /* --------------------------------------------------------------------
         * HIGH PRIORITY: EMERGENCY / SOS BUTTON (GPIO 41, 3-SECOND HOLD REQUIRED)
         * -------------------------------------------------------------------- */
        if (check_sos_long_press()) {
            s_sos_overlay_active = false; /* SOS screen replaces everything */
            ESP_LOGW(TAG, "EMERGENCY SOS CONFIRMED (3S HOLD)!");
            ui_draw_sos_screen();

            /* Offline? Skip the reconnect backoff and give Wi-Fi a few seconds */
            if (!s_is_wifi_connected) {
                ESP_LOGW(TAG, "SOS while offline: forcing Wi-Fi reconnect");
                wifi_reconnect_now();
                xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(8000));
            }

            int64_t sos_t0 = esp_timer_get_time();
            bool sent = false;
            for (int attempt = 1; attempt <= SOS_POST_ATTEMPTS && !sent; attempt++) {
                sent = http_post_sos();
                if (!sent) {
                    ESP_LOGE(TAG, "SOS post attempt %d/%d failed", attempt, SOS_POST_ATTEMPTS);
                    vTaskDelay(pdMS_TO_TICKS(1000));
                }
            }
            if (sent) {
                ESP_LOGW(TAG, "SOS delivered to server %lld ms after hold confirmed",
                         (long long)((esp_timer_get_time() - sos_t0) / 1000));
            }
            ui_update_sos_status(sent);

            vTaskDelay(pdMS_TO_TICKS(5000));
            while (gpio_get_level(PIN_BTN_SOS) == 0) {   /* still held: do not re-trigger */
                vTaskDelay(pdMS_TO_TICKS(50));
            }
            state = STATE_IDLE;
            ui_draw_idle_screen();
            continue;
        } else if (s_sos_overlay_active) {
            /* Button released before 3 s: put the normal footer back */
            s_sos_overlay_active = false;
            ui_restore_footer(state);
        }

        TickType_t now = xTaskGetTickCount();

        /* --------------------------------------------------------------------
         * STATE MACHINE
         * -------------------------------------------------------------------- */
        switch (state) {
            case STATE_IDLE: {
                /* 0. Keep the ONLINE/OFFLINE badge and IP footer truthful */
                ui_refresh_idle_status_if_changed();

                /* 1. Interactive YES Button Click -> New Tip, Every 5 Clicks -> New Face! */
                if (check_button_pressed(PIN_BTN_YES)) {
                    s_tip_index = (s_tip_index + 1) % NUM_QUICK_TIPS;
                    s_yes_click_count++;

                    if (s_yes_click_count % 5 == 0) {
                        s_face_index = (s_face_index + 1) % NUM_FACES;
                        ui_draw_face(s_face_index, false, true);
                        ESP_LOGI(TAG, "YES click milestone (%d): New Face expression %d!", s_yes_click_count, s_face_index);
                    }

                    ui_update_tip_card(s_quick_tips[s_tip_index]);
                    ESP_LOGI(TAG, "YES pressed in standby: Tip %d ('%s')", s_tip_index, s_quick_tips[s_tip_index]);
                }

                /* 2. Flicker-Free Blinking Animation (Blink 200ms every ~5s) */
                if (!is_blinking && (now - last_blink_tick) > pdMS_TO_TICKS(4800)) {
                    is_blinking = true;
                    last_blink_tick = now;
                    ui_draw_face(s_face_index, true, false);
                } else if (is_blinking && (now - last_blink_tick) > pdMS_TO_TICKS(200)) {
                    is_blinking = false;
                    last_blink_tick = now;
                    ui_draw_face(s_face_index, false, false);
                }

                /* 3. Poll server for active questions every 1500ms */
                if ((now - last_poll_tick) > pdMS_TO_TICKS(1500)) {
                    last_poll_tick = now;

                    int q_id = 0;
                    char q_text[256] = "";
                    char q_type[32] = "";
                    bool q_active = false;

                    if (http_get_active_question(&q_id, q_text, sizeof(q_text), q_type, sizeof(q_type), &q_active)) {
                        if (q_active && strlen(q_text) > 0 && q_id != s_last_answered_q_id) {
                            s_current_q_id = q_id;
                            strncpy(s_current_q_text, q_text, sizeof(s_current_q_text) - 1);
                            strncpy(s_current_q_type, q_type, sizeof(s_current_q_type) - 1);

                            ESP_LOGI(TAG, "New question received [ID=%d, Type=%s]: %s", s_current_q_id, s_current_q_type, s_current_q_text);

                            if (strcmp(s_current_q_type, "boolean") == 0) {
                                ui_draw_boolean_question(s_current_q_text);
                            } else {
                                ui_draw_range_question_static(s_current_q_text);
                                last_dial_val = -1;
                            }
                            state = STATE_SHOW_QUESTION;
                        }
                    }
                }
                break;
            }

            case STATE_SHOW_QUESTION: {
                /* The caregiver may withdraw or replace the question: re-check every 3 s */
                if ((now - last_poll_tick) > pdMS_TO_TICKS(3000)) {
                    last_poll_tick = now;
                    int q_id = 0;
                    char q_text[256] = "";
                    char q_type[32] = "";
                    bool q_active = false;
                    if (http_get_active_question(&q_id, q_text, sizeof(q_text), q_type, sizeof(q_type), &q_active)
                        && (!q_active || q_id != s_current_q_id)) {
                        ESP_LOGI(TAG, "Question %d withdrawn or replaced by caregiver, back to idle", s_current_q_id);
                        state = STATE_IDLE;
                        ui_draw_idle_screen();
                        break;
                    }
                }

                if (strcmp(s_current_q_type, "boolean") == 0) {
                    if (check_button_pressed(PIN_BTN_NO)) {          /* Red NO (GPIO 18) */
                        submit_answer_and_show_result("NO");
                        state = STATE_IDLE;
                    } else if (check_button_pressed(PIN_BTN_YES)) {  /* Green YES (GPIO 6) */
                        submit_answer_and_show_result("YES");
                        state = STATE_IDLE;
                    }
                } else {
                    /* Range 1-10 with potentiometer */
                    int raw = read_potentiometer_raw();
                    int current_dial = pot_scale_with_hysteresis(raw, last_dial_val);
                    if (current_dial != last_dial_val) {
                        last_dial_val = current_dial;
                        ui_update_range_slider(current_dial);
                    }

                    /* Green Confirm Button (GPIO 6) */
                    if (check_button_pressed(PIN_BTN_YES)) {
                        char ans_str[16];
                        snprintf(ans_str, sizeof(ans_str), "%d/10", current_dial);
                        submit_answer_and_show_result(ans_str);
                        state = STATE_IDLE;
                    }
                }
                break;
            }

            default:
                state = STATE_IDLE;
                break;
        }

        vTaskDelay(pdMS_TO_TICKS(35)); /* Yield CPU */
    }
}

/* ============================================================================
 * APPLICATION ENTRY POINT
 * ============================================================================ */
void app_main(void)
{
    ESP_LOGI(TAG, "==================================================");
    ESP_LOGI(TAG, "  KAIGO Hub v2.2 - Senior Caregiver Hub           ");
    ESP_LOGI(TAG, "  Portrait Mode, 20MHz SPI                        ");
    ESP_LOGI(TAG, "==================================================");

    /* 1. Initialize NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /* 2. Initialize GPIOs and ADC */
    gpio_init_all();
    adc_init_potentiometer();

    /* 3. Initialize SPI and LCD hardware */
    spi_init_lcd();
    lcd_init_hardware();

    /* Clear screen to light background */
    lcd_clear(COLOR_BG_WHITE);
    lcd_draw_string_centered(180, "KAIGO STARTING...", 2, COLOR_BLUE, COLOR_BG_WHITE);
    lcd_draw_string_centered(220, "Connecting to Wi-Fi...", 1, COLOR_TEXT_MUTED, COLOR_BG_WHITE);

    /* 4. Connect to Wi-Fi (also starts the SNTP clock sync) */
    wifi_init_sta();

    /* 5. Start main loop task */
    xTaskCreatePinnedToCore(kaigo_main_task, "kaigo_main_task", 8192, NULL, 5, NULL, 1);
}
