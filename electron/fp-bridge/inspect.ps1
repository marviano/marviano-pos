$reg = New-Object -ComObject FlexCodeSDK.FinFPReg
$reg | Get-Member | Out-File "d:\Austin\Code\marviano-pos\electron\fp-bridge\members.txt"
