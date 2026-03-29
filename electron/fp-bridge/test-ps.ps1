$ErrorActionPreference = "Stop"
try {
    Write-Host "Instantiating FlexCodeSDK.FinFPReg..."
    $reg = New-Object -ComObject "FlexCodeSDK.FinFPReg"
    Write-Host "Successfully created!"
    
    # Check if events can be registered
    Register-ObjectEvent -InputObject $reg -EventName "FPSamplesNeeded" -Action {
        Write-Host "FPSamplesNeeded: $($Event.SourceEventArgs)"
    } | Out-Null
    Write-Host "Successfully registered event!"
    
    $reg.DeviceInfo("C700F001339", "7901D3C13E34109", "VPFAAB943C33362467D451A0")
    Write-Host "DeviceInfo called successfully!"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
