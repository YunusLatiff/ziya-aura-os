$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$taskName='Ziya Energy Aura Production Supervisor'
$watchdog=Join-Path $PSScriptRoot 'ziya-watchdog.ps1'
if(-not(Test-Path -LiteralPath $watchdog -PathType Leaf)){throw "Watchdog script not found: $watchdog"}

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$args = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`" -StartupDelaySeconds 15"
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $PSScriptRoot
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([timespan]::Zero)
$principal=New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Starts and supervises Aura Operations (:4310), Ziya CRM (:4311), and externally starts/restarts Tony at Windows logon. Does not modify Tony.' -Force | Out-Null

Write-Host ''
Write-Host "Installed Windows logon task: $taskName" -ForegroundColor Green
Write-Host 'It can run on battery, starts when available, and the watchdog handles Aura/CRM/Tony crash recovery.' -ForegroundColor Green
Write-Host 'Starting the task now...' -ForegroundColor White
Start-ScheduledTask -TaskName $taskName
