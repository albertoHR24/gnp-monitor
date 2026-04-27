$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$packageDir = Join-Path $dist "gnp-monitor-windows"
$zip = Join-Path $dist "gnp-monitor-windows.zip"

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null

$items = @(
  "gnp-monitor.js",
  "package.json",
  "package-lock.json",
  "ecosystem.config.js",
  ".env.example",
  "DEPLOYMENT.md",
  "install-windows.cmd",
  "start-monitor.cmd",
  "stop-monitor.cmd",
  "restart-monitor.cmd",
  "logs-monitor.cmd",
  "status-monitor.cmd",
  "public",
  "tests"
)

foreach ($item in $items) {
  $source = Join-Path $root $item
  if (!(Test-Path $source)) {
    continue
  }

  $target = Join-Path $packageDir $item
  if ((Get-Item $source).PSIsContainer) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $target
  }
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zip -Force
Write-Host "Paquete creado: $zip"
