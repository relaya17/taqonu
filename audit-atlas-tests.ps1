$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " ATLAS SECURITY / AGENT TEST AUDIT" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] Repository status..." -ForegroundColor Yellow
git status --short
Write-Host ""

Write-Host "[2/5] Workspace information..." -ForegroundColor Yellow
pnpm -v
node -v
Write-Host ""

Write-Host "[3/5] Searching for Agent Runtime tests..." -ForegroundColor Yellow

$testFiles = Get-ChildItem -Path . -Recurse -File `
    -Include "*.test.ts","*.test.tsx","*.spec.ts","*.spec.tsx" `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\dist\\" -and
        $_.FullName -notmatch "\\build\\"
    }

if ($testFiles) {
    $testFiles | ForEach-Object {
        Write-Host $_.FullName -ForegroundColor Gray
    }
}
else {
    Write-Host "No test files found." -ForegroundColor Red
}

Write-Host ""
Write-Host "[4/5] Searching for ExecutionCorrelation tests..." -ForegroundColor Yellow

$correlationMatches = Get-ChildItem -Path . -Recurse -File `
    -Include "*.test.ts","*.test.tsx","*.spec.ts","*.spec.tsx" `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\"
    } |
    Select-String -Pattern "ExecutionCorrelation|correlation" -CaseSensitive:$false

if ($correlationMatches) {
    $correlationMatches | ForEach-Object {
        Write-Host "$($_.Path):$($_.LineNumber) $($_.Line.Trim())" -ForegroundColor Green
    }
}
else {
    Write-Host "NO ExecutionCorrelation test references found." -ForegroundColor Red
}

Write-Host ""
Write-Host "[5/5] Running repository tests..." -ForegroundColor Yellow
Write-Host ""

pnpm test

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " ATLAS TEST RESULT" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

if ($exitCode -eq 0) {
    Write-Host "TEST COMMAND: PASSED" -ForegroundColor Green
}
else {
    Write-Host "TEST COMMAND: FAILED OR BLOCKED" -ForegroundColor Red
    Write-Host "Exit code: $exitCode" -ForegroundColor Red
}

Write-Host ""
Write-Host "IMPORTANT:"
Write-Host "- A passing test proves only the behavior covered by that test."
Write-Host "- Missing tests are NOT treated as verified."
Write-Host "- ExecutionCorrelation requires dedicated test coverage."
Write-Host "- Specification text is not evidence of implementation."
Write-Host ""

exit $exitCode