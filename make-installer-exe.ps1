$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$zip = Join-Path $dist "gnp-monitor-windows.zip"
$bootstrap = Join-Path $root "installer-bootstrap.cmd"
$exe = Join-Path $dist "GNPMonitorSetup.exe"
$build = Join-Path $env:TEMP "gnp-monitor-iexpress"
$buildZip = Join-Path $build "gnp-monitor-windows.zip"
$buildBootstrap = Join-Path $build "installer-bootstrap.cmd"
$buildSed = Join-Path $build "gnp-monitor-iexpress.sed"
$buildExe = Join-Path $env:TEMP "GNPMonitorSetup.exe"

if (!(Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "package-windows.ps1")

if (!(Test-Path $zip)) {
  throw "No se genero $zip"
}
if (!(Test-Path $bootstrap)) {
  throw "No existe $bootstrap"
}

if (Test-Path $exe) {
  Remove-Item -LiteralPath $exe -Force
}
if (Test-Path $build) {
  Remove-Item -LiteralPath $build -Recurse -Force
}
if (Test-Path $buildExe) {
  Remove-Item -LiteralPath $buildExe -Force
}
New-Item -ItemType Directory -Path $build -Force | Out-Null
Copy-Item -LiteralPath $zip -Destination $buildZip
Copy-Item -LiteralPath $bootstrap -Destination $buildBootstrap

$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=Instalacion de GNP Monitor iniciada.
TargetName=$buildExe
FriendlyName=GNP Monitor Setup
AppLaunched=installer-bootstrap.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[Strings]
FILE0="gnp-monitor-windows.zip"
FILE1="installer-bootstrap.cmd"

[SourceFiles]
SourceFiles0=$build\
SourceFiles1=$build\

[SourceFiles0]
%FILE0%=

[SourceFiles1]
%FILE1%=
"@

Set-Content -LiteralPath $buildSed -Value $sedContent -Encoding ASCII

$iexpress = Join-Path $env:WINDIR "System32\iexpress.exe"
if (!(Test-Path $iexpress)) {
  throw "No encontre iexpress.exe en $iexpress"
}

& $iexpress /N /Q $buildSed

for ($index = 0; $index -lt 20 -and !(Test-Path $buildExe); $index++) {
  Start-Sleep -Milliseconds 250
}

if (!(Test-Path $buildExe)) {
  throw "IExpress no genero $buildExe"
}

Copy-Item -LiteralPath $buildExe -Destination $exe -Force
Write-Host "Ejecutable creado: $exe"
