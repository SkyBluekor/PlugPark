param(
  [string]$McpProject = ""
)

$ErrorActionPreference = "Stop"

$plugParkRoot = Split-Path -Parent $PSScriptRoot
$template = Join-Path $PSScriptRoot "mcp-web-s1\bridge.ts"

if (-not $McpProject) {
  $projectsRoot = Split-Path -Parent $plugParkRoot
  $McpProject = Join-Path $projectsRoot "PlugPark-MCP"
}

$targetSrc = Join-Path $McpProject "src"
$targetServer = Join-Path $targetSrc "server.ts"
$targetBridge = Join-Path $targetSrc "bridge.ts"

if (-not (Test-Path $template)) {
  throw "Bridge template not found: $template"
}

if (-not (Test-Path $targetServer)) {
  throw "PlugPark-MCP server.ts not found: $targetServer"
}

New-Item -ItemType Directory -Force -Path $targetSrc | Out-Null

if (Test-Path $targetBridge) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$targetBridge.$stamp.bak"
  Copy-Item $targetBridge $backup -Force
  Write-Host "Backup             PASS  $backup"
}

Copy-Item $template $targetBridge -Force

Write-Host ""
Write-Host "=============================================================================="
Write-Host "PLUGPARK MCP-WEB-S1 BRIDGE"
Write-Host "=============================================================================="
Write-Host "MCP project         PASS  $McpProject"
Write-Host "Bridge installed    PASS  $targetBridge"
Write-Host ""
Write-Host ('Run: cd "' + $McpProject + '"')
Write-Host "     npx tsc --noEmit"
Write-Host "     npx tsx src/bridge.ts"
Write-Host ""
Write-Host "Default bridge: http://127.0.0.1:3000"
Write-Host "Default model : qwen3.5:9b"
