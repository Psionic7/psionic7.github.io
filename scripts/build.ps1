param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
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
    $localPython = Join-Path (Split-Path $projectRoot -Parent) 'my_real_estate/.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $localPython)) { $localPython = 'python' }
    $localEnv = Join-Path (Split-Path $projectRoot -Parent) 'my_real_estate/.env'
    & $localPython -X utf8 scripts/check_public.py --secrets-file $localEnv
    if ($LASTEXITCODE -ne 0) { throw '공개 파일 검증 실패' }
} finally {
    $env:CI = $previousCI
}
Write-Host 'Build ready: docs/ (GitHub Pages uses main /docs)'
