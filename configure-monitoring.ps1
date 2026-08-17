$ErrorActionPreference = "Stop"
Write-Host "============================================"
Write-Host " AURA OS v0.5.0 - MONITORING CONFIGURATION"
Write-Host "============================================"
Write-Host "This configures Aura/Steve only. Tony is not read or modified."
$envPath = Join-Path $PSScriptRoot ".env"
if (!(Test-Path $envPath)) { New-Item -ItemType File -Path $envPath -Force | Out-Null }
function Set-EnvValue($name,$value) {
  $lines = @(Get-Content $envPath -ErrorAction SilentlyContinue)
  $pattern = "^" + [regex]::Escape($name) + "="
  $replacement = "$name=$value"
  $found = $false
  for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $pattern) { $lines[$i]=$replacement; $found=$true } }
  if (!$found) { $lines += $replacement }
  Set-Content -Path $envPath -Value $lines -Encoding UTF8
}
$stale = Read-Host "Agent stale threshold in minutes [10]"; if ([string]::IsNullOrWhiteSpace($stale)) {$stale="10"}
$batch = Read-Host "Batch stall threshold in minutes [20]"; if ([string]::IsNullOrWhiteSpace($batch)) {$batch="20"}
$tick = Read-Host "Health scan interval in seconds [60]"; if ([string]::IsNullOrWhiteSpace($tick)) {$tick="60"}
$hour = Read-Host "Steve automatic daily report hour (0-23) [17]"; if ([string]::IsNullOrWhiteSpace($hour)) {$hour="17"}
$email = Read-Host "Steve report recipient email [yunus@ziyaenergy.co.za]"; if ([string]::IsNullOrWhiteSpace($email)) {$email="yunus@ziyaenergy.co.za"}
$enable = Read-Host "Allow Steve to email operational reports automatically? (yes/no) [no]"; if ([string]::IsNullOrWhiteSpace($enable)) {$enable="no"}
Set-EnvValue "MONITOR_AGENT_STALE_MINUTES" $stale
Set-EnvValue "MONITOR_BATCH_STALL_MINUTES" $batch
Set-EnvValue "MONITOR_OUTBOUND_STUCK_MINUTES" "10"
Set-EnvValue "MONITOR_TICK_SECONDS" $tick
Set-EnvValue "STEVE_AUTO_REPORT_HOUR" $hour
Set-EnvValue "STEVE_REPORT_EMAIL" $email
Set-EnvValue "STEVE_EMAIL_ENABLED" ($(if ($enable -match '^(y|yes|true|1)$') {'true'} else {'false'}))
Write-Host "Monitoring configuration saved. Restart Aura to load the new values."
