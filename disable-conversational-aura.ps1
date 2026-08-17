$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (!(Test-Path $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }
function Set-EnvValue([string]$Name,[string]$Value) {
  $lines = @(Get-Content $envFile -ErrorAction SilentlyContinue)
  $line = "$Name=$Value"
  $matched = $false
  $new = foreach ($l in $lines) {
    if ($l -match "^$([regex]::Escape($Name))=") { $matched = $true; $line } else { $l }
  }
  if (-not $matched) { $new += $line }
  Set-Content -Path $envFile -Value $new -Encoding UTF8
}
Set-EnvValue 'AURA_LLM_ENABLED' 'false'
Set-EnvValue 'AURA_ALWAYS_LISTEN' 'false'
Write-Host 'Conversational Aura disabled. Restart Aura OS to apply.' -ForegroundColor Green
Write-Host 'No Ollama inference or continuous Aura microphone will be started.'
Write-Host 'Tony was not read or modified.' -ForegroundColor Yellow
