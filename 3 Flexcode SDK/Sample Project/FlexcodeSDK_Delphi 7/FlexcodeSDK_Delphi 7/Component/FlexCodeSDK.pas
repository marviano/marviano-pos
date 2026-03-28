unit FlexCodeSDK;

// ************************************************************************ //
// WARNING                                                                    
// -------                                                                    
// The types declared in this file were generated from data read from a       
// Type Library. If this type library is explicitly or indirectly (via        
// another type library referring to this type library) re-imported, or the   
// 'Refresh' command of the Type Library Editor activated while editing the   
// Type Library, the contents of this file will be regenerated and all        
// manual modifications will be lost.                                         
// ************************************************************************ //

// PASTLWTR : 1.2
// File generated on 02/02/2013 13:16:42 from Type Library described below.

// ************************************************************************  //
// Type Lib: flexcodesdk.dll (1)
// LIBID: {F4A7BEC7-D2B4-4949-82AE-7215C0A62CBA}
// LCID: 0
// Helpfile: 
// HelpString: 
// DepndLst: 
//   (1) v2.0 stdole, (C:\Windows\system32\stdole2.tlb)
// Errors:
//   Error creating palette bitmap of (TFinFPReg) : Server C:\Program Files\FlexCodeSDK\FlexCodeSDK.dll contains no icons
//   Error creating palette bitmap of (TFinFPVer) : Server C:\Program Files\FlexCodeSDK\FlexCodeSDK.dll contains no icons
//   Error creating palette bitmap of (TFinFPImg) : Server C:\Program Files\FlexCodeSDK\FlexCodeSDK.dll contains no icons
// ************************************************************************ //
// *************************************************************************//
// NOTE:                                                                      
// Items guarded by $IFDEF_LIVE_SERVER_AT_DESIGN_TIME are used by properties  
// which return objects that may need to be explicitly created via a function 
// call prior to any access via the property. These items have been disabled  
// in order to prevent accidental use from within the object inspector. You   
// may enable them by defining LIVE_SERVER_AT_DESIGN_TIME or by selectively   
// removing them from the $IFDEF blocks. However, such items must still be    
// programmatically created via a method of the appropriate CoClass before    
// they can be used.                                                          
{$TYPEDADDRESS OFF} // Unit must be compiled without type-checked pointers. 
{$WARN SYMBOL_PLATFORM OFF}
{$WRITEABLECONST ON}
{$VARPROPSETTER ON}
interface

uses Windows, ActiveX, Classes, Graphics, OleServer, StdVCL, Variants;
  

// *********************************************************************//
// GUIDS declared in the TypeLibrary. Following prefixes are used:        
//   Type Libraries     : LIBID_xxxx                                      
//   CoClasses          : CLASS_xxxx                                      
//   DISPInterfaces     : DIID_xxxx                                       
//   Non-DISP interfaces: IID_xxxx                                        
// *********************************************************************//
const
  // TypeLibrary Major and minor versions
  FlexCodeSDKMajorVersion = 1;
  FlexCodeSDKMinorVersion = 0;

  LIBID_FlexCodeSDK: TGUID = '{F4A7BEC7-D2B4-4949-82AE-7215C0A62CBA}';

  IID__FinFPReg: TGUID = '{EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}';
  DIID___FinFPReg: TGUID = '{A46BACD3-59C7-4DD0-837F-4E87B5DC7F27}';
  IID__FinFPVer: TGUID = '{A69996B1-F92D-44AB-9DFC-281A943B8080}';
  DIID___FinFPVer: TGUID = '{D909833E-B44C-4068-8708-2932BF6C2805}';
  IID__FinFPImg: TGUID = '{4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}';
  DIID___FinFPImg: TGUID = '{8CC684F1-FF03-4435-9F15-EC71D3FD7AAF}';
  CLASS_FinFPReg: TGUID = '{2FC47774-99F8-4340-97BF-8CAE49EE7802}';
  CLASS_FinFPVer: TGUID = '{F9DE13FC-D844-452A-B335-FD2E8A4D8CFE}';
  CLASS_FinFPImg: TGUID = '{36E848EB-64ED-4347-B3E2-B99AC98BF4BB}';

// *********************************************************************//
// Declaration of Enumerations defined in Type Library                    
// *********************************************************************//
// Constants for enum RegistrationStatus
type
  RegistrationStatus = Integer;
const
  r_OK = $00000000;
  r_RegistrationFailed = $00000003;
  r_NoDevice = $00000007;
  r_PoorImageQuality = $00000008;
  r_ActivationIncorrect = $00000009;
  r_RegistrationCaptureStart = $0000000A;
  r_RegistrationCaptureStop = $0000000B;

// Constants for enum VerificationStatus
type
  VerificationStatus = Integer;
const
  v_NotMatch = $00000000;
  v_OK = $00000001;
  v_MultiplelMatch = $00000002;
  v_VerificationFailed = $00000003;
  v_NoDevice = $00000007;
  v_PoorImageQuality = $00000008;
  v_ActivationIncorrect = $00000009;
  v_VerifyCaptureStop = $0000000B;
  v_VerifyCaptureFingerTouch = $0000000F;
  v_FPListFull = $00000010;
  v_FPDevFull = $00000011;
  v_FPListEmpty = $00000012;

// Constants for enum FingerNumber
type
  FingerNumber = Integer;
const
  Fn_LeftPinkie = $00000000;
  Fn_LeftRing = $00000001;
  Fn_LeftMiddle = $00000002;
  Fn_LeftIndex = $00000003;
  Fn_LeftThumb = $00000004;
  Fn_RightThumb = $00000005;
  Fn_RightIndex = $00000006;
  Fn_RightMiddle = $00000007;
  Fn_RightRing = $00000008;
  Fn_RightPinkie = $00000009;
  Fn_None = $0000000A;

// Constants for enum FPImageStatus
type
  FPImageStatus = Integer;
const
  Fi_NoDevice = $00000007;
  Fi_ActivationIncorrect = $00000009;
  Fi_FPImageStop = $0000000B;

type

// *********************************************************************//
// Forward declaration of types defined in TypeLibrary                    
// *********************************************************************//
  _FinFPReg = interface;
  _FinFPRegDisp = dispinterface;
  __FinFPReg = dispinterface;
  _FinFPVer = interface;
  _FinFPVerDisp = dispinterface;
  __FinFPVer = dispinterface;
  _FinFPImg = interface;
  _FinFPImgDisp = dispinterface;
  __FinFPImg = dispinterface;

// *********************************************************************//
// Declaration of CoClasses defined in Type Library                       
// (NOTE: Here we map each CoClass to its Default Interface)              
// *********************************************************************//
  FinFPReg = _FinFPReg;
  FinFPVer = _FinFPVer;
  FinFPImg = _FinFPImg;


// *********************************************************************//
// Interface: _FinFPReg
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}
// *********************************************************************//
  _FinFPReg = interface(IDispatch)
    ['{EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}']
    procedure FPRegistrationStart(const SecureKey: WideString); safecall;
    procedure FPRegistrationStop; safecall;
    function SDKVersion: WideString; safecall;
    function SDKSupport: WideString; safecall;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool; safecall;
    procedure Set_PictureSampleHeight(Param1: Smallint); safecall;
    procedure Set_PictureSampleWidth(Param1: Smallint); safecall;
    procedure Set_PictureSamplePath(const Param1: WideString); safecall;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  end;

// *********************************************************************//
// DispIntf:  _FinFPRegDisp
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}
// *********************************************************************//
  _FinFPRegDisp = dispinterface
    ['{EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}']
    procedure FPRegistrationStart(const SecureKey: WideString); dispid 1610809347;
    procedure FPRegistrationStop; dispid 1610809348;
    function SDKVersion: WideString; dispid 1610809355;
    function SDKSupport: WideString; dispid 1610809356;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool; dispid 1610809357;
    property PictureSampleHeight: Smallint writeonly dispid 1745027074;
    property PictureSampleWidth: Smallint writeonly dispid 1745027073;
    property PictureSamplePath: WideString writeonly dispid 1745027072;
  end;

// *********************************************************************//
// DispIntf:  __FinFPReg
// Flags:     (4240) Hidden NonExtensible Dispatchable
// GUID:      {A46BACD3-59C7-4DD0-837F-4E87B5DC7F27}
// *********************************************************************//
  __FinFPReg = dispinterface
    ['{A46BACD3-59C7-4DD0-837F-4E87B5DC7F27}']
    procedure FPRegistrationStatus(Status: RegistrationStatus); dispid 1;
    procedure FPRegistrationTemplate(const FPTemplate: WideString); dispid 2;
    procedure FPSamplesNeeded(Samples: Smallint); dispid 3;
    procedure FPRegistrationImage; dispid 4;
  end;

// *********************************************************************//
// Interface: _FinFPVer
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {A69996B1-F92D-44AB-9DFC-281A943B8080}
// *********************************************************************//
  _FinFPVer = interface(IDispatch)
    ['{A69996B1-F92D-44AB-9DFC-281A943B8080}']
    procedure FPVerificationStart(const VerifyEmployeeID: WideString); safecall;
    procedure FPVerificationStop; safecall;
    procedure WorkingInBackground(Status: WordBool); safecall;
    procedure Set_PictureSampleHeight(Param1: Smallint); safecall;
    procedure Set_PictureSampleWidth(Param1: Smallint); safecall;
    procedure Set_PictureSamplePath(const Param1: WideString); safecall;
    function FPAlreadyLoad(const ID: WideString; FPIndex: FingerNumber): WordBool; safecall;
    function FPLoad(const ID: WideString; FPIndex: FingerNumber; const FPTemplate: WideString; 
                    const SecureKey: WideString): WordBool; safecall;
    function FPUnload(const ID: WideString; FPIndex: FingerNumber): WordBool; safecall;
    function GetFPCount: Smallint; safecall;
    procedure FPListClear; safecall;
    function SDKVersion: WideString; safecall;
    function SDKSupport: WideString; safecall;
    function AddDeviceInfo(const SN: WideString; const Verification: WideString; 
                           const Activation: WideString): WordBool; safecall;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  end;

// *********************************************************************//
// DispIntf:  _FinFPVerDisp
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {A69996B1-F92D-44AB-9DFC-281A943B8080}
// *********************************************************************//
  _FinFPVerDisp = dispinterface
    ['{A69996B1-F92D-44AB-9DFC-281A943B8080}']
    procedure FPVerificationStart(const VerifyEmployeeID: WideString); dispid 1610809347;
    procedure FPVerificationStop; dispid 1610809348;
    procedure WorkingInBackground(Status: WordBool); dispid 1610809354;
    property PictureSampleHeight: Smallint writeonly dispid 1745027074;
    property PictureSampleWidth: Smallint writeonly dispid 1745027073;
    property PictureSamplePath: WideString writeonly dispid 1745027072;
    function FPAlreadyLoad(const ID: WideString; FPIndex: FingerNumber): WordBool; dispid 1610809358;
    function FPLoad(const ID: WideString; FPIndex: FingerNumber; const FPTemplate: WideString; 
                    const SecureKey: WideString): WordBool; dispid 1610809359;
    function FPUnload(const ID: WideString; FPIndex: FingerNumber): WordBool; dispid 1610809360;
    function GetFPCount: Smallint; dispid 1610809361;
    procedure FPListClear; dispid 1610809362;
    function SDKVersion: WideString; dispid 1610809363;
    function SDKSupport: WideString; dispid 1610809364;
    function AddDeviceInfo(const SN: WideString; const Verification: WideString; 
                           const Activation: WideString): WordBool; dispid 1610809365;
  end;

// *********************************************************************//
// DispIntf:  __FinFPVer
// Flags:     (4240) Hidden NonExtensible Dispatchable
// GUID:      {D909833E-B44C-4068-8708-2932BF6C2805}
// *********************************************************************//
  __FinFPVer = dispinterface
    ['{D909833E-B44C-4068-8708-2932BF6C2805}']
    procedure FPVerificationStatus(Status: VerificationStatus); dispid 1;
    procedure FPVerificationID(const ID: WideString; FingerNr: FingerNumber); dispid 2;
    procedure FPVerificationImage; dispid 3;
  end;

// *********************************************************************//
// Interface: _FinFPImg
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}
// *********************************************************************//
  _FinFPImg = interface(IDispatch)
    ['{4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}']
    procedure FPImageStart; safecall;
    procedure FPImageStop; safecall;
    function SDKVersion: WideString; safecall;
    function SDKSupport: WideString; safecall;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool; safecall;
    procedure Set_PictureSampleHeight(Param1: Smallint); safecall;
    procedure Set_PictureSampleWidth(Param1: Smallint); safecall;
    procedure Set_PictureSamplePath(const Param1: WideString); safecall;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  end;

// *********************************************************************//
// DispIntf:  _FinFPImgDisp
// Flags:     (4560) Hidden Dual NonExtensible OleAutomation Dispatchable
// GUID:      {4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}
// *********************************************************************//
  _FinFPImgDisp = dispinterface
    ['{4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}']
    procedure FPImageStart; dispid 1610809347;
    procedure FPImageStop; dispid 1610809348;
    function SDKVersion: WideString; dispid 1610809352;
    function SDKSupport: WideString; dispid 1610809353;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool; dispid 1610809354;
    property PictureSampleHeight: Smallint writeonly dispid 1745027074;
    property PictureSampleWidth: Smallint writeonly dispid 1745027073;
    property PictureSamplePath: WideString writeonly dispid 1745027072;
  end;

// *********************************************************************//
// DispIntf:  __FinFPImg
// Flags:     (4240) Hidden NonExtensible Dispatchable
// GUID:      {8CC684F1-FF03-4435-9F15-EC71D3FD7AAF}
// *********************************************************************//
  __FinFPImg = dispinterface
    ['{8CC684F1-FF03-4435-9F15-EC71D3FD7AAF}']
    procedure FPImageStatus(Status: FPImageStatus); dispid 1;
    procedure FPImage; dispid 2;
  end;

// *********************************************************************//
// The Class CoFinFPReg provides a Create and CreateRemote method to          
// create instances of the default interface _FinFPReg exposed by              
// the CoClass FinFPReg. The functions are intended to be used by             
// clients wishing to automate the CoClass objects exposed by the         
// server of this typelibrary.                                            
// *********************************************************************//
  CoFinFPReg = class
    class function Create: _FinFPReg;
    class function CreateRemote(const MachineName: string): _FinFPReg;
  end;

  TFinFPRegFPRegistrationStatus = procedure(ASender: TObject; Status: RegistrationStatus) of object;
  TFinFPRegFPRegistrationTemplate = procedure(ASender: TObject; const FPTemplate: WideString) of object;
  TFinFPRegFPSamplesNeeded = procedure(ASender: TObject; Samples: Smallint) of object;


// *********************************************************************//
// OLE Server Proxy class declaration
// Server Object    : TFinFPReg
// Help String      : 
// Default Interface: _FinFPReg
// Def. Intf. DISP? : No
// Event   Interface: __FinFPReg
// TypeFlags        : (2) CanCreate
// *********************************************************************//
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  TFinFPRegProperties= class;
{$ENDIF}
  TFinFPReg = class(TOleServer)
  private
    FOnFPRegistrationStatus: TFinFPRegFPRegistrationStatus;
    FOnFPRegistrationTemplate: TFinFPRegFPRegistrationTemplate;
    FOnFPSamplesNeeded: TFinFPRegFPSamplesNeeded;
    FOnFPRegistrationImage: TNotifyEvent;
    FIntf:        _FinFPReg;
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    FProps:       TFinFPRegProperties;
    function      GetServerProperties: TFinFPRegProperties;
{$ENDIF}
    function      GetDefaultInterface: _FinFPReg;
  protected
    procedure InitServerData; override;
    procedure InvokeEvent(DispID: TDispID; var Params: TVariantArray); override;
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    constructor Create(AOwner: TComponent); override;
    destructor  Destroy; override;
    procedure Connect; override;
    procedure ConnectTo(svrIntf: _FinFPReg);
    procedure Disconnect; override;
    procedure FPRegistrationStart(const SecureKey: WideString);
    procedure FPRegistrationStop;
    function SDKVersion: WideString;
    function SDKSupport: WideString;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool;
    property DefaultInterface: _FinFPReg read GetDefaultInterface;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  published
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    property Server: TFinFPRegProperties read GetServerProperties;
{$ENDIF}
    property OnFPRegistrationStatus: TFinFPRegFPRegistrationStatus read FOnFPRegistrationStatus write FOnFPRegistrationStatus;
    property OnFPRegistrationTemplate: TFinFPRegFPRegistrationTemplate read FOnFPRegistrationTemplate write FOnFPRegistrationTemplate;
    property OnFPSamplesNeeded: TFinFPRegFPSamplesNeeded read FOnFPSamplesNeeded write FOnFPSamplesNeeded;
    property OnFPRegistrationImage: TNotifyEvent read FOnFPRegistrationImage write FOnFPRegistrationImage;
  end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
// *********************************************************************//
// OLE Server Properties Proxy Class
// Server Object    : TFinFPReg
// (This object is used by the IDE's Property Inspector to allow editing
//  of the properties of this server)
// *********************************************************************//
 TFinFPRegProperties = class(TPersistent)
  private
    FServer:    TFinFPReg;
    function    GetDefaultInterface: _FinFPReg;
    constructor Create(AServer: TFinFPReg);
  protected
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    property DefaultInterface: _FinFPReg read GetDefaultInterface;
  published
  end;
{$ENDIF}


// *********************************************************************//
// The Class CoFinFPVer provides a Create and CreateRemote method to          
// create instances of the default interface _FinFPVer exposed by              
// the CoClass FinFPVer. The functions are intended to be used by             
// clients wishing to automate the CoClass objects exposed by the         
// server of this typelibrary.                                            
// *********************************************************************//
  CoFinFPVer = class
    class function Create: _FinFPVer;
    class function CreateRemote(const MachineName: string): _FinFPVer;
  end;

  TFinFPVerFPVerificationStatus = procedure(ASender: TObject; Status: VerificationStatus) of object;
  TFinFPVerFPVerificationID = procedure(ASender: TObject; const ID: WideString; 
                                                          FingerNr: FingerNumber) of object;


// *********************************************************************//
// OLE Server Proxy class declaration
// Server Object    : TFinFPVer
// Help String      : 
// Default Interface: _FinFPVer
// Def. Intf. DISP? : No
// Event   Interface: __FinFPVer
// TypeFlags        : (2) CanCreate
// *********************************************************************//
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  TFinFPVerProperties= class;
{$ENDIF}
  TFinFPVer = class(TOleServer)
  private
    FOnFPVerificationStatus: TFinFPVerFPVerificationStatus;
    FOnFPVerificationID: TFinFPVerFPVerificationID;
    FOnFPVerificationImage: TNotifyEvent;
    FIntf:        _FinFPVer;
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    FProps:       TFinFPVerProperties;
    function      GetServerProperties: TFinFPVerProperties;
{$ENDIF}
    function      GetDefaultInterface: _FinFPVer;
  protected
    procedure InitServerData; override;
    procedure InvokeEvent(DispID: TDispID; var Params: TVariantArray); override;
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    constructor Create(AOwner: TComponent); override;
    destructor  Destroy; override;
    procedure Connect; override;
    procedure ConnectTo(svrIntf: _FinFPVer);
    procedure Disconnect; override;
    procedure FPVerificationStart(const VerifyEmployeeID: WideString);
    procedure FPVerificationStop;
    procedure WorkingInBackground(Status: WordBool);
    function FPAlreadyLoad(const ID: WideString; FPIndex: FingerNumber): WordBool;
    function FPLoad(const ID: WideString; FPIndex: FingerNumber; const FPTemplate: WideString; 
                    const SecureKey: WideString): WordBool;
    function FPUnload(const ID: WideString; FPIndex: FingerNumber): WordBool;
    function GetFPCount: Smallint;
    procedure FPListClear;
    function SDKVersion: WideString;
    function SDKSupport: WideString;
    function AddDeviceInfo(const SN: WideString; const Verification: WideString; 
                           const Activation: WideString): WordBool;
    property DefaultInterface: _FinFPVer read GetDefaultInterface;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  published
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    property Server: TFinFPVerProperties read GetServerProperties;
{$ENDIF}
    property OnFPVerificationStatus: TFinFPVerFPVerificationStatus read FOnFPVerificationStatus write FOnFPVerificationStatus;
    property OnFPVerificationID: TFinFPVerFPVerificationID read FOnFPVerificationID write FOnFPVerificationID;
    property OnFPVerificationImage: TNotifyEvent read FOnFPVerificationImage write FOnFPVerificationImage;
  end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
// *********************************************************************//
// OLE Server Properties Proxy Class
// Server Object    : TFinFPVer
// (This object is used by the IDE's Property Inspector to allow editing
//  of the properties of this server)
// *********************************************************************//
 TFinFPVerProperties = class(TPersistent)
  private
    FServer:    TFinFPVer;
    function    GetDefaultInterface: _FinFPVer;
    constructor Create(AServer: TFinFPVer);
  protected
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    property DefaultInterface: _FinFPVer read GetDefaultInterface;
  published
  end;
{$ENDIF}


// *********************************************************************//
// The Class CoFinFPImg provides a Create and CreateRemote method to          
// create instances of the default interface _FinFPImg exposed by              
// the CoClass FinFPImg. The functions are intended to be used by             
// clients wishing to automate the CoClass objects exposed by the         
// server of this typelibrary.                                            
// *********************************************************************//
  CoFinFPImg = class
    class function Create: _FinFPImg;
    class function CreateRemote(const MachineName: string): _FinFPImg;
  end;

  TFinFPImgFPImageStatus = procedure(ASender: TObject; Status: FPImageStatus) of object;


// *********************************************************************//
// OLE Server Proxy class declaration
// Server Object    : TFinFPImg
// Help String      : 
// Default Interface: _FinFPImg
// Def. Intf. DISP? : No
// Event   Interface: __FinFPImg
// TypeFlags        : (2) CanCreate
// *********************************************************************//
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  TFinFPImgProperties= class;
{$ENDIF}
  TFinFPImg = class(TOleServer)
  private
    FOnFPImageStatus: TFinFPImgFPImageStatus;
    FOnFPImage: TNotifyEvent;
    FIntf:        _FinFPImg;
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    FProps:       TFinFPImgProperties;
    function      GetServerProperties: TFinFPImgProperties;
{$ENDIF}
    function      GetDefaultInterface: _FinFPImg;
  protected
    procedure InitServerData; override;
    procedure InvokeEvent(DispID: TDispID; var Params: TVariantArray); override;
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    constructor Create(AOwner: TComponent); override;
    destructor  Destroy; override;
    procedure Connect; override;
    procedure ConnectTo(svrIntf: _FinFPImg);
    procedure Disconnect; override;
    procedure FPImageStart;
    procedure FPImageStop;
    function SDKVersion: WideString;
    function SDKSupport: WideString;
    function DeviceInfo(const SN: WideString; const Verification: WideString; 
                        const Activation: WideString): WordBool;
    property DefaultInterface: _FinFPImg read GetDefaultInterface;
    property PictureSampleHeight: Smallint write Set_PictureSampleHeight;
    property PictureSampleWidth: Smallint write Set_PictureSampleWidth;
    property PictureSamplePath: WideString write Set_PictureSamplePath;
  published
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
    property Server: TFinFPImgProperties read GetServerProperties;
{$ENDIF}
    property OnFPImageStatus: TFinFPImgFPImageStatus read FOnFPImageStatus write FOnFPImageStatus;
    property OnFPImage: TNotifyEvent read FOnFPImage write FOnFPImage;
  end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
// *********************************************************************//
// OLE Server Properties Proxy Class
// Server Object    : TFinFPImg
// (This object is used by the IDE's Property Inspector to allow editing
//  of the properties of this server)
// *********************************************************************//
 TFinFPImgProperties = class(TPersistent)
  private
    FServer:    TFinFPImg;
    function    GetDefaultInterface: _FinFPImg;
    constructor Create(AServer: TFinFPImg);
  protected
    procedure Set_PictureSampleHeight(Param1: Smallint);
    procedure Set_PictureSampleWidth(Param1: Smallint);
    procedure Set_PictureSamplePath(const Param1: WideString);
  public
    property DefaultInterface: _FinFPImg read GetDefaultInterface;
  published
  end;
{$ENDIF}


procedure Register;

resourcestring
  dtlServerPage = 'FlexcodeSDK';

  dtlOcxPage = 'ActiveX';

implementation

uses ComObj;

class function CoFinFPReg.Create: _FinFPReg;
begin
  Result := CreateComObject(CLASS_FinFPReg) as _FinFPReg;
end;

class function CoFinFPReg.CreateRemote(const MachineName: string): _FinFPReg;
begin
  Result := CreateRemoteComObject(MachineName, CLASS_FinFPReg) as _FinFPReg;
end;

procedure TFinFPReg.InitServerData;
const
  CServerData: TServerData = (
    ClassID:   '{2FC47774-99F8-4340-97BF-8CAE49EE7802}';
    IntfIID:   '{EB51C7FB-35BE-4EC7-B482-66F9BE9A35B6}';
    EventIID:  '{A46BACD3-59C7-4DD0-837F-4E87B5DC7F27}';
    LicenseKey: nil;
    Version: 500);
begin
  ServerData := @CServerData;
end;

procedure TFinFPReg.Connect;
var
  punk: IUnknown;
begin
  if FIntf = nil then
  begin
    punk := GetServer;
    ConnectEvents(punk);
    Fintf:= punk as _FinFPReg;
  end;
end;

procedure TFinFPReg.ConnectTo(svrIntf: _FinFPReg);
begin
  Disconnect;
  FIntf := svrIntf;
  ConnectEvents(FIntf);
end;

procedure TFinFPReg.DisConnect;
begin
  if Fintf <> nil then
  begin
    DisconnectEvents(FIntf);
    FIntf := nil;
  end;
end;

function TFinFPReg.GetDefaultInterface: _FinFPReg;
begin
  if FIntf = nil then
    Connect;
  Assert(FIntf <> nil, 'DefaultInterface is NULL. Component is not connected to Server. You must call ''Connect'' or ''ConnectTo'' before this operation');
  Result := FIntf;
end;

constructor TFinFPReg.Create(AOwner: TComponent);
begin
  inherited Create(AOwner);
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps := TFinFPRegProperties.Create(Self);
{$ENDIF}
end;

destructor TFinFPReg.Destroy;
begin
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps.Free;
{$ENDIF}
  inherited Destroy;
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
function TFinFPReg.GetServerProperties: TFinFPRegProperties;
begin
  Result := FProps;
end;
{$ENDIF}

procedure TFinFPReg.InvokeEvent(DispID: TDispID; var Params: TVariantArray);
begin
  case DispID of
    -1: Exit;  // DISPID_UNKNOWN
    1: if Assigned(FOnFPRegistrationStatus) then
         FOnFPRegistrationStatus(Self, Params[0] {RegistrationStatus});
    2: if Assigned(FOnFPRegistrationTemplate) then
         FOnFPRegistrationTemplate(Self, Params[0] {const WideString});
    3: if Assigned(FOnFPSamplesNeeded) then
         FOnFPSamplesNeeded(Self, Params[0] {Smallint});
    4: if Assigned(FOnFPRegistrationImage) then
         FOnFPRegistrationImage(Self);
  end; {case DispID}
end;

procedure TFinFPReg.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPReg.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPReg.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

procedure TFinFPReg.FPRegistrationStart(const SecureKey: WideString);
begin
  DefaultInterface.FPRegistrationStart(SecureKey);
end;

procedure TFinFPReg.FPRegistrationStop;
begin
  DefaultInterface.FPRegistrationStop;
end;

function TFinFPReg.SDKVersion: WideString;
begin
  Result := DefaultInterface.SDKVersion;
end;

function TFinFPReg.SDKSupport: WideString;
begin
  Result := DefaultInterface.SDKSupport;
end;

function TFinFPReg.DeviceInfo(const SN: WideString; const Verification: WideString; 
                              const Activation: WideString): WordBool;
begin
  Result := DefaultInterface.DeviceInfo(SN, Verification, Activation);
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
constructor TFinFPRegProperties.Create(AServer: TFinFPReg);
begin
  inherited Create;
  FServer := AServer;
end;

function TFinFPRegProperties.GetDefaultInterface: _FinFPReg;
begin
  Result := FServer.DefaultInterface;
end;

procedure TFinFPRegProperties.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPRegProperties.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPRegProperties.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

{$ENDIF}

class function CoFinFPVer.Create: _FinFPVer;
begin
  Result := CreateComObject(CLASS_FinFPVer) as _FinFPVer;
end;

class function CoFinFPVer.CreateRemote(const MachineName: string): _FinFPVer;
begin
  Result := CreateRemoteComObject(MachineName, CLASS_FinFPVer) as _FinFPVer;
end;

procedure TFinFPVer.InitServerData;
const
  CServerData: TServerData = (
    ClassID:   '{F9DE13FC-D844-452A-B335-FD2E8A4D8CFE}';
    IntfIID:   '{A69996B1-F92D-44AB-9DFC-281A943B8080}';
    EventIID:  '{D909833E-B44C-4068-8708-2932BF6C2805}';
    LicenseKey: nil;
    Version: 500);
begin
  ServerData := @CServerData;
end;

procedure TFinFPVer.Connect;
var
  punk: IUnknown;
begin
  if FIntf = nil then
  begin
    punk := GetServer;
    ConnectEvents(punk);
    Fintf:= punk as _FinFPVer;
  end;
end;

procedure TFinFPVer.ConnectTo(svrIntf: _FinFPVer);
begin
  Disconnect;
  FIntf := svrIntf;
  ConnectEvents(FIntf);
end;

procedure TFinFPVer.DisConnect;
begin
  if Fintf <> nil then
  begin
    DisconnectEvents(FIntf);
    FIntf := nil;
  end;
end;

function TFinFPVer.GetDefaultInterface: _FinFPVer;
begin
  if FIntf = nil then
    Connect;
  Assert(FIntf <> nil, 'DefaultInterface is NULL. Component is not connected to Server. You must call ''Connect'' or ''ConnectTo'' before this operation');
  Result := FIntf;
end;

constructor TFinFPVer.Create(AOwner: TComponent);
begin
  inherited Create(AOwner);
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps := TFinFPVerProperties.Create(Self);
{$ENDIF}
end;

destructor TFinFPVer.Destroy;
begin
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps.Free;
{$ENDIF}
  inherited Destroy;
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
function TFinFPVer.GetServerProperties: TFinFPVerProperties;
begin
  Result := FProps;
end;
{$ENDIF}

procedure TFinFPVer.InvokeEvent(DispID: TDispID; var Params: TVariantArray);
begin
  case DispID of
    -1: Exit;  // DISPID_UNKNOWN
    1: if Assigned(FOnFPVerificationStatus) then
         FOnFPVerificationStatus(Self, Params[0] {VerificationStatus});
    2: if Assigned(FOnFPVerificationID) then
         FOnFPVerificationID(Self,
                             Params[0] {const WideString},
                             Params[1] {FingerNumber});
    3: if Assigned(FOnFPVerificationImage) then
         FOnFPVerificationImage(Self);
  end; {case DispID}
end;

procedure TFinFPVer.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPVer.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPVer.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

procedure TFinFPVer.FPVerificationStart(const VerifyEmployeeID: WideString);
begin
  DefaultInterface.FPVerificationStart(VerifyEmployeeID);
end;

procedure TFinFPVer.FPVerificationStop;
begin
  DefaultInterface.FPVerificationStop;
end;

procedure TFinFPVer.WorkingInBackground(Status: WordBool);
begin
  DefaultInterface.WorkingInBackground(Status);
end;

function TFinFPVer.FPAlreadyLoad(const ID: WideString; FPIndex: FingerNumber): WordBool;
begin
  Result := DefaultInterface.FPAlreadyLoad(ID, FPIndex);
end;

function TFinFPVer.FPLoad(const ID: WideString; FPIndex: FingerNumber; 
                          const FPTemplate: WideString; const SecureKey: WideString): WordBool;
begin
  Result := DefaultInterface.FPLoad(ID, FPIndex, FPTemplate, SecureKey);
end;

function TFinFPVer.FPUnload(const ID: WideString; FPIndex: FingerNumber): WordBool;
begin
  Result := DefaultInterface.FPUnload(ID, FPIndex);
end;

function TFinFPVer.GetFPCount: Smallint;
begin
  Result := DefaultInterface.GetFPCount;
end;

procedure TFinFPVer.FPListClear;
begin
  DefaultInterface.FPListClear;
end;

function TFinFPVer.SDKVersion: WideString;
begin
  Result := DefaultInterface.SDKVersion;
end;

function TFinFPVer.SDKSupport: WideString;
begin
  Result := DefaultInterface.SDKSupport;
end;

function TFinFPVer.AddDeviceInfo(const SN: WideString; const Verification: WideString; 
                                 const Activation: WideString): WordBool;
begin
  Result := DefaultInterface.AddDeviceInfo(SN, Verification, Activation);
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
constructor TFinFPVerProperties.Create(AServer: TFinFPVer);
begin
  inherited Create;
  FServer := AServer;
end;

function TFinFPVerProperties.GetDefaultInterface: _FinFPVer;
begin
  Result := FServer.DefaultInterface;
end;

procedure TFinFPVerProperties.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPVerProperties.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPVerProperties.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

{$ENDIF}

class function CoFinFPImg.Create: _FinFPImg;
begin
  Result := CreateComObject(CLASS_FinFPImg) as _FinFPImg;
end;

class function CoFinFPImg.CreateRemote(const MachineName: string): _FinFPImg;
begin
  Result := CreateRemoteComObject(MachineName, CLASS_FinFPImg) as _FinFPImg;
end;

procedure TFinFPImg.InitServerData;
const
  CServerData: TServerData = (
    ClassID:   '{36E848EB-64ED-4347-B3E2-B99AC98BF4BB}';
    IntfIID:   '{4DC3CDFF-AF38-4DDE-A9B5-CEB6A4233FDA}';
    EventIID:  '{8CC684F1-FF03-4435-9F15-EC71D3FD7AAF}';
    LicenseKey: nil;
    Version: 500);
begin
  ServerData := @CServerData;
end;

procedure TFinFPImg.Connect;
var
  punk: IUnknown;
begin
  if FIntf = nil then
  begin
    punk := GetServer;
    ConnectEvents(punk);
    Fintf:= punk as _FinFPImg;
  end;
end;

procedure TFinFPImg.ConnectTo(svrIntf: _FinFPImg);
begin
  Disconnect;
  FIntf := svrIntf;
  ConnectEvents(FIntf);
end;

procedure TFinFPImg.DisConnect;
begin
  if Fintf <> nil then
  begin
    DisconnectEvents(FIntf);
    FIntf := nil;
  end;
end;

function TFinFPImg.GetDefaultInterface: _FinFPImg;
begin
  if FIntf = nil then
    Connect;
  Assert(FIntf <> nil, 'DefaultInterface is NULL. Component is not connected to Server. You must call ''Connect'' or ''ConnectTo'' before this operation');
  Result := FIntf;
end;

constructor TFinFPImg.Create(AOwner: TComponent);
begin
  inherited Create(AOwner);
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps := TFinFPImgProperties.Create(Self);
{$ENDIF}
end;

destructor TFinFPImg.Destroy;
begin
{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
  FProps.Free;
{$ENDIF}
  inherited Destroy;
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
function TFinFPImg.GetServerProperties: TFinFPImgProperties;
begin
  Result := FProps;
end;
{$ENDIF}

procedure TFinFPImg.InvokeEvent(DispID: TDispID; var Params: TVariantArray);
begin
  case DispID of
    -1: Exit;  // DISPID_UNKNOWN
    1: if Assigned(FOnFPImageStatus) then
         FOnFPImageStatus(Self, Params[0] {FPImageStatus});
    2: if Assigned(FOnFPImage) then
         FOnFPImage(Self);
  end; {case DispID}
end;

procedure TFinFPImg.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPImg.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPImg.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

procedure TFinFPImg.FPImageStart;
begin
  DefaultInterface.FPImageStart;
end;

procedure TFinFPImg.FPImageStop;
begin
  DefaultInterface.FPImageStop;
end;

function TFinFPImg.SDKVersion: WideString;
begin
  Result := DefaultInterface.SDKVersion;
end;

function TFinFPImg.SDKSupport: WideString;
begin
  Result := DefaultInterface.SDKSupport;
end;

function TFinFPImg.DeviceInfo(const SN: WideString; const Verification: WideString; 
                              const Activation: WideString): WordBool;
begin
  Result := DefaultInterface.DeviceInfo(SN, Verification, Activation);
end;

{$IFDEF LIVE_SERVER_AT_DESIGN_TIME}
constructor TFinFPImgProperties.Create(AServer: TFinFPImg);
begin
  inherited Create;
  FServer := AServer;
end;

function TFinFPImgProperties.GetDefaultInterface: _FinFPImg;
begin
  Result := FServer.DefaultInterface;
end;

procedure TFinFPImgProperties.Set_PictureSampleHeight(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleHeight(Param1);
end;

procedure TFinFPImgProperties.Set_PictureSampleWidth(Param1: Smallint);
begin
  DefaultInterface.Set_PictureSampleWidth(Param1);
end;

procedure TFinFPImgProperties.Set_PictureSamplePath(const Param1: WideString);
  { Warning: The property PictureSamplePath has a setter and a getter whose
    types do not match. Delphi was unable to generate a property of
    this sort and so is using a Variant as a passthrough. }
var
  InterfaceVariant: OleVariant;
begin
  InterfaceVariant := DefaultInterface;
  InterfaceVariant.PictureSamplePath := Param1;
end;

{$ENDIF}

procedure Register;
begin
  RegisterComponents(dtlServerPage, [TFinFPReg, TFinFPVer, TFinFPImg]);
end;

end.
