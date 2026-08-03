/* Este repositorio es público: no guardar claves, tokens ni datos privados.
   La URL siguiente es el puente de PRUEBAS; no contiene secretos. */
window.TURNIO_FRONT_BUILD = 'V.30';
// Versión visible para usuarios. Debe coincidir con FRONT_BUILD / cabecera.
window.TURNIO_APP_VERSION = 'V.30';
/* Escritorio ≥900px: herramientas en ventana flotante sin salir de Radar/Mapa.
   false = comportamiento clásico (una pantalla). Móvil no usa flotantes. */
window.TURNIO_DESKTOP_FLOAT_WINDOWS = true;
window.TURNIO_EXTERNAL_API =
  new URLSearchParams(window.location.search).get("api") ||
  "https://api-pruebas.turniorail.es";
