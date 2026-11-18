idf_component_register(SRCS "main.c"
                       INCLUDE_DIRS "."
                       REQUIRES esp_driver_gpio
                                esp_driver_spi
                                esp_adc
                                esp_wifi
                                esp_http_client
                                nvs_flash
                                esp_event
                                esp_netif
                                esp_timer)