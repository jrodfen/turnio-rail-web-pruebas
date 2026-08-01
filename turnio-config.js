/* Este repositorio es público: no guardar claves, tokens ni datos privados.
   La URL siguiente es el puente de PRUEBAS; no contiene secretos. */
window.TURNIO_EXTERNAL_API =
  new URLSearchParams(window.location.search).get("api") ||
  "https://api-pruebas.turniorail.es";
