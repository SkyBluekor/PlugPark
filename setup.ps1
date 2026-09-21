$ErrorActionPreference = 'Stop'

Write-Host '[1/3] Checking package.json...'
Get-Content package.json -Raw | ConvertFrom-Json | Out-Null
Write-Host 'package.json OK'

Write-Host '[2/3] Creating .dev.vars if missing...'
if (-not (Test-Path '.dev.vars')) {
    if (Test-Path '.dev.vars.example') {
        Copy-Item '.dev.vars.example' '.dev.vars'
    } elseif (Test-Path 'dev.vars.example') {
        Copy-Item 'dev.vars.example' '.dev.vars'
    } else {
        throw 'No dev vars example file found.'
    }
    Write-Host '.dev.vars created. Fill in both API keys before live API testing.'
} else {
    Write-Host '.dev.vars already exists; keeping it.'
}

Write-Host '[3/3] Installing npm packages...'
npm install
Write-Host ''
Write-Host 'Done. Next: npm run cf:dev'
