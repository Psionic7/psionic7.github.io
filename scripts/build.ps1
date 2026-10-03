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
$packageTool = Get-Command pnpm -ErrorAction SilentlyContinue
if ($packageTool) {
    $packagePath = $packageTool.Source
} else {
    $packagePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
    if (-not (Test-Path -LiteralPath $packagePath)) { throw 'Node.js와 pnpm을 설치해 주세요.' }
}
$previousCI = $env:CI
try {
    $env:CI = 'true'
    if (-not $SkipInstall) {
        & $packagePath install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw '패키지 설치 실패' }
    }
    & $packagePath build
    if ($LASTEXITCODE -ne 0) { throw '정적 빌드 실패' }
    & $nodeExecutable scripts/check-public.mjs
    if ($LASTEXITCODE -ne 0) { throw '공개 파일 검증 실패' }
} finally {
    $env:CI = $previousCI
}
Write-Host 'Build ready: docs/ (GitHub Pages uses main /docs)'
