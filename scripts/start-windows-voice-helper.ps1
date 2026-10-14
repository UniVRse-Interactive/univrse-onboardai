$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Speech
    $voiceReferences = if ($PSVersionTable.PSEdition -eq 'Core') { @('System.Speech','System.Collections','System.Linq','System.Runtime','System.Threading') } else { @('System.Speech','System.Core') }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsVoiceHelper.cs') -ReferencedAssemblies $voiceReferences
    $localVoice = New-Object WindowsVoice
    [Console]::WriteLine((@{ready=$true;voice=$localVoice.Name} | ConvertTo-Json -Compress))
    while ($null -ne ($requestLine = [Console]::ReadLine())) {
        try {
            $voiceRequest = $requestLine | ConvertFrom-Json
            $voiceResult = $localVoice.Render([string]$voiceRequest.text, [double]$voiceRequest.rate)
            [Console]::WriteLine((@{id=$voiceRequest.id;result=$voiceResult} | ConvertTo-Json -Depth 6 -Compress))
        } catch {
            [Console]::WriteLine((@{id=$voiceRequest.id;error='The installed Windows voice could not synthesize this answer.'} | ConvertTo-Json -Compress))
        }
    }
} catch {
    [Console]::WriteLine((@{ready=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))
    exit 1
} finally {
    if ($localVoice) { $localVoice.Dispose() }
}
