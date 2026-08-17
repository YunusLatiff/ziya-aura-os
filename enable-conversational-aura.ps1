$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (!(Test-Path $envFile)) { throw '.env not found. Run configure-conversational-aura.ps1 first.' }
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
Set-EnvValue 'AURA_LLM_ENABLED' 'true'
Set-EnvValue 'AURA_ALWAYS_LISTEN' 'true'
Write-Host 'Conversational Aura enabled. Restart Aura OS to apply.' -ForegroundColor Green
Write-Host 'This will allow local Ollama inference and continuous Aura microphone listening.' -ForegroundColor Yellow
Write-Host 'Tony remains protected and outside Aura modification authority.'
