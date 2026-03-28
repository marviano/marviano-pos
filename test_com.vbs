On Error Resume Next
Set reg = CreateObject("FlexCodeSDK.FinFPReg")
If Err.Number <> 0 Then
    WScript.Echo "Error creating FinFPReg: " & Err.Description
Else
    WScript.Echo "FinFPReg created successfully."
    reg.AddDeviceInfo "test", "test", "test"
    If Err.Number <> 0 Then
        WScript.Echo "AddDeviceInfo failed: " & Err.Description
    Else
        WScript.Echo "AddDeviceInfo succeeded (unexpectedly with dummy keys?)"
    End If
End If

Err.Clear
Set ver = CreateObject("FlexCodeSDK.FinFPVer")
If Err.Number <> 0 Then
    WScript.Echo "Error creating FinFPVer: " & Err.Description
Else
    WScript.Echo "FinFPVer created successfully."
End If
