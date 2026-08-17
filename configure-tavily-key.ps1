$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$envPath=Join-Path $PSScriptRoot '.env'
if(-not(Test-Path -LiteralPath $envPath)){New-Item -ItemType File -Path $envPath -Force | Out-Null}

Write-Host ''
Write-Host 'TAVILY API KEY CONFIGURATION' -ForegroundColor Cyan
Write-Host 'The key is stored persistently in .env and is not written into source code.' -ForegroundColor DarkGray
$secure=Read-Host 'Paste the NEW Tavily API key (input hidden)' -AsSecureString
$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
if([string]::IsNullOrWhiteSpace($key)){throw 'No API key entered.'}
if($key.Contains("`r") -or $key.Contains("`n") -or $key.Contains('"')){throw 'The API key contains an unsupported character.'}

$lines=@(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
$replacement="TAVILY_API_KEY=`"$key`""
$found=$false
$out=@()
foreach($line in $lines){if($line -match '^\s*TAVILY_API_KEY\s*='){$out+=$replacement;$found=$true}else{$out+=$line}}
if(-not $found){$out+=$replacement}
Set-Content -LiteralPath $envPath -Value $out -Encoding UTF8
$key=$null

Write-Host 'New Tavily API key saved to .env.' -ForegroundColor Green
Write-Host 'Restart Aura OS before testing the provider.' -ForegroundColor Yellow
