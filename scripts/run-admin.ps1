param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExecutable = $nodeCommand.Source } else {
    $nodeExecutable = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js 24.19 이상을 설치해 주세요.' }
}
$env:PATH = (Split-Path $nodeExecutable -Parent) + ';' + $env:PATH
try {
    $existingAdmin = Invoke-RestMethod -Uri 'http://127.0.0.1:8623/api/state' -TimeoutSec 2
    if ($existingAdmin.app -eq 'home-records-local-admin') {
        Write-Host 'Local administrator is already running: http://127.0.0.1:8623/'
        Start-Process -FilePath 'http://127.0.0.1:8623/'
        exit 0
    }
} catch { }
if (-not $SkipInstall) {
    $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpmCommand) { $packageExecutable = $pnpmCommand.Source } else {
        $packageExecutable = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
        if (-not (Test-Path -LiteralPath $packageExecutable)) { throw 'pnpm 11을 설치해 주세요.' }
    }
    $previousCI = $env:CI
    try { $env:CI = 'true'; & $packageExecutable install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { throw '패키지 설치 실패' } }
    finally { $env:CI = $previousCI }
}
& $nodeExecutable node_modules/vite/bin/vite.js build --config vite.admin.config.js
if ($LASTEXITCODE -ne 0) { throw 'React 관리자 빌드 실패' }
Write-Host 'Open http://127.0.0.1:8623/ (local administrator only)'
& $nodeExecutable server/index.mjs
exit $LASTEXITCODE
