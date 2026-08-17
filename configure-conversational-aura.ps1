$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (!(Test-Path $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }

function Set-EnvValue([string]$Name,[string]$Value) {
  $lines = @(Get-Content $envFile -ErrorAction SilentlyContinue)
  $escaped = $Value.Replace('"','\"')
  $line = "$Name=`"$escaped`""
  $matched = $false
  $new = foreach ($l in $lines) {
    if ($l -match "^$([regex]::Escape($Name))=") { $matched = $true; $line } else { $l }
  }
  if (-not $matched) { $new += $line }
  Set-Content -Path $envFile -Value $new -Encoding UTF8
}

Write-Host '============================================'
Write-Host ' AURA OS v0.6.2 - HARDWARE-SAFE AURA'
Write-Host '============================================'
Write-Host 'This configures Aura only. Tony is not read or modified.'
Write-Host 'Conversational Aura will be kept DORMANT on the current laptop.' -ForegroundColor Yellow

$ollamaUrl = Read-Host 'Ollama URL to preserve for future activation [http://127.0.0.1:11434]'
if ([string]::IsNullOrWhiteSpace($ollamaUrl)) { $ollamaUrl = 'http://127.0.0.1:11434' }
$model = Read-Host 'Future Aura conversation model [qwen3:8b]'
if ([string]::IsNullOrWhiteSpace($model)) { $model = 'qwen3:8b' }
$wake = Read-Host 'Future wake word [Aura]'
if ([string]::IsNullOrWhiteSpace($wake)) { $wake = 'Aura' }
$window = Read-Host 'Future conversation follow-up window in seconds [25]'
if ([string]::IsNullOrWhiteSpace($window)) { $window = '25' }

Set-EnvValue 'AURA_OLLAMA_URL' $ollamaUrl
Set-EnvValue 'AURA_OLLAMA_MODEL' $model
Set-EnvValue 'AURA_WAKE_WORD' $wake
Set-EnvValue 'AURA_CONVERSATION_WINDOW_SECONDS' $window
Set-EnvValue 'AURA_LLM_ENABLED' 'false'
Set-EnvValue 'AURA_ALWAYS_LISTEN' 'false'
Set-EnvValue 'AURA_VOICE_ONLY' 'true'

Write-Host ''
Write-Host 'Conversational Aura is configured but DORMANT.' -ForegroundColor Green
Write-Host 'Aura will not call Ollama or start continuous microphone recognition.'
Write-Host 'All non-conversational Aura OS phases continue to operate normally.'
Write-Host 'When upgraded hardware is ready, run .\enable-conversational-aura.ps1 and restart Aura.' -ForegroundColor Cyan
Write-Host 'Tony remains protected and outside Aura modification authority.' -ForegroundColor Yellow
