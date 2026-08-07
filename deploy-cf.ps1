# Deploy front de pruebas a Cloudflare Workers (assets).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$files = @(
  'index.html','app.js','styles.css','turnio-config.js','turnio-base.css',
  'supabase-auth-config.js','conexiones.js','cx-encaminar.js','cx-estaciones.js',
  'cx-retrasos.js','mallas-gtfs.js','distancias-kms.json','estaciones-pantallas.json',
  'maquinas-catalogo.json',
  'correspondencias-tren.json',
  'manifest.webmanifest','sw.js','icon-192.png','icon-512.png',
  'combinados-hoy.html','pantalla-adif.html','calculadora-conduccion.html','.nojekyll','_headers'
)

New-Item -ItemType Directory -Force -Path _site | Out-Null
Get-ChildItem _site -Force | Remove-Item -Recurse -Force
foreach ($f in $files) {
  if (Test-Path $f) { Copy-Item $f (Join-Path '_site' $f) -Force }
}

npx wrangler deploy
