[CmdletBinding()]
param(
  [ValidateSet('Package','Install','Start','Stop','Uninstall')][string]$Action = 'Package',
  [string]$PackageRoot = (Join-Path $PSScriptRoot '..\artifacts\windows'),
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AgentMe\app'),
  [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'AgentMe\data'),
  [SecureString]$AuthToken,
  [switch]$EnableStartup,
  [switch]$RemoveUserData
)
$ErrorActionPreference = 'Stop'
$resolvedWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedPackage = [IO.Path]::GetFullPath($PackageRoot)
$resolvedInstall = [IO.Path]::GetFullPath($InstallRoot)
$resolvedData = [IO.Path]::GetFullPath($DataRoot)
function Assert-SafeTarget([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -eq [IO.Path]::GetPathRoot($Path) -or $Path -eq $resolvedWorkspace) { throw "Unsafe target: $Path" }
}
Assert-SafeTarget $resolvedPackage; Assert-SafeTarget $resolvedInstall; Assert-SafeTarget $resolvedData
$pidFile = Join-Path $resolvedData 'agentme.pid'
$secretFile = Join-Path $resolvedData 'auth-token.dpapi'
$startupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'AgentMe.ps1'

switch ($Action) {
  'Package' {
    & corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    New-Item -ItemType Directory -Force $resolvedPackage | Out-Null
    Copy-Item -Recurse -Force (Join-Path $resolvedWorkspace 'dist') $resolvedPackage
    Copy-Item -Force (Join-Path $resolvedWorkspace 'package.json'),(Join-Path $resolvedWorkspace 'pnpm-lock.yaml'),(Join-Path $resolvedWorkspace 'pnpm-workspace.yaml') $resolvedPackage
    Push-Location $resolvedPackage
    try { & corepack pnpm install --prod --frozen-lockfile; if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed' } }
    finally { Pop-Location }
    Write-Host "Package prepared at $resolvedPackage"
  }
  'Install' {
    if (-not (Test-Path (Join-Path $resolvedPackage 'dist\apps\host\src\main.js'))) { throw 'Package has not been built' }
    New-Item -ItemType Directory -Force $resolvedInstall,$resolvedData | Out-Null
    Copy-Item -Recurse -Force (Join-Path $resolvedPackage 'dist') $resolvedInstall
    Copy-Item -Recurse -Force (Join-Path $resolvedPackage 'node_modules') $resolvedInstall
    if ($null -ne $AuthToken) { $AuthToken | ConvertFrom-SecureString | Set-Content -Encoding utf8 $secretFile }
    if (-not (Test-Path $secretFile)) { throw 'AuthToken is required for the first install' }
    if ($EnableStartup) { "& '$PSCommandPath' -Action Start -InstallRoot '$resolvedInstall' -DataRoot '$resolvedData'" | Set-Content -Encoding utf8 $startupFile }
    Write-Host "Installed. User data: $resolvedData"
  }
  'Start' {
    if (Test-Path $pidFile) { $existingPid = [int](Get-Content $pidFile); if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) { Write-Host 'AgentMe is already running'; break } }
    $secure = Get-Content $secretFile | ConvertTo-SecureString
    $credential = [pscredential]::new('agentme', $secure)
    $env:AGENTME_AUTH_TOKEN = $credential.GetNetworkCredential().Password
    $env:AGENTME_DATABASE_PATH = Join-Path $resolvedData 'agentme.sqlite'
    $process = Start-Process node -ArgumentList (Join-Path $resolvedInstall 'dist\apps\host\src\main.js') -WindowStyle Hidden -PassThru
    $process.Id | Set-Content -Encoding ascii $pidFile
    Remove-Item Env:\AGENTME_AUTH_TOKEN,Env:\AGENTME_DATABASE_PATH -ErrorAction SilentlyContinue
    Write-Host "AgentMe started (PID $($process.Id))"
  }
  'Stop' {
    if (Test-Path $pidFile) { $agentPid = [int](Get-Content $pidFile); Stop-Process -Id $agentPid -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $pidFile -Force }
    Write-Host 'AgentMe stopped'
  }
  'Uninstall' {
    & $PSCommandPath -Action Stop -InstallRoot $resolvedInstall -DataRoot $resolvedData -PackageRoot $resolvedPackage
    if (Test-Path $resolvedInstall) { Remove-Item -LiteralPath $resolvedInstall -Recurse -Force }
    if (Test-Path $startupFile) { Remove-Item -LiteralPath $startupFile -Force }
    if ($RemoveUserData -and (Test-Path $resolvedData)) { Remove-Item -LiteralPath $resolvedData -Recurse -Force; Write-Host 'User data permanently removed' }
    else { Write-Host "Uninstalled; user data retained at $resolvedData" }
  }
}
