cd /d %~dp0
if /i "%PROCESSOR_IDENTIFIER:~0,3%"=="X86" 
	(
	echo system is x86
	copy .\*.dll %windir%\system32\
	regsvr32 /s /c %windir%\system32\FlexCodeSDK.dll
	) 
else 
	(
	copy .\*.dll %windir%\SysWOW64\
	regsvr32 /s /c %windir%\SysWOW64\FlexCodeSDK.dll
	)
