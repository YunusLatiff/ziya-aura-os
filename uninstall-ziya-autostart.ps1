$ErrorActionPreference='SilentlyContinue'
$taskName='Ziya Energy Aura Production Supervisor'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Host "Removed Windows task: $taskName" -ForegroundColor Green
}else{Write-Host 'Ziya production autostart task is not installed.' -ForegroundColor Yellow}
