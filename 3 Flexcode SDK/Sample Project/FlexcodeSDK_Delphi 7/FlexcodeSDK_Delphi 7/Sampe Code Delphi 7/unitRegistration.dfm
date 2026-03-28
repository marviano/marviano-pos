object FormRegistration: TFormRegistration
  Left = 256
  Top = 134
  BorderIcons = [biSystemMenu]
  BorderStyle = bsSingle
  Caption = 'Form Registration'
  ClientHeight = 528
  ClientWidth = 666
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -11
  Font.Name = 'MS Sans Serif'
  Font.Style = []
  OldCreateOrder = False
  Position = poScreenCenter
  OnClose = FormClose
  OnCreate = FormCreate
  PixelsPerInch = 96
  TextHeight = 13
  object Label1: TLabel
    Left = 9
    Top = 21
    Width = 103
    Height = 13
    Caption = 'Device Serial Number'
  end
  object Label2: TLabel
    Left = 31
    Top = 52
    Width = 80
    Height = 13
    Caption = 'Verification Code'
  end
  object Label3: TLabel
    Left = 36
    Top = 85
    Width = 75
    Height = 13
    Caption = 'Activation Code'
  end
  object Label4: TLabel
    Left = 343
    Top = 20
    Width = 44
    Height = 13
    Caption = 'Template'
  end
  object Label5: TLabel
    Left = 12
    Top = 213
    Width = 52
    Height = 13
    Caption = 'Information'
  end
  object Label6: TLabel
    Left = 10
    Top = 499
    Width = 315
    Height = 16
    Caption = 'Please Stop Any Fingerprint Process Before Registering'
    Font.Charset = ANSI_CHARSET
    Font.Color = clRed
    Font.Height = -13
    Font.Name = 'Tahoma'
    Font.Style = []
    ParentFont = False
  end
  object Edit1: TEdit
    Left = 120
    Top = 16
    Width = 121
    Height = 20
    Ctl3D = False
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentCtl3D = False
    ParentFont = False
    TabOrder = 0
  end
  object Edit2: TEdit
    Left = 120
    Top = 48
    Width = 153
    Height = 20
    Ctl3D = False
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentCtl3D = False
    ParentFont = False
    TabOrder = 1
  end
  object Edit3: TEdit
    Left = 120
    Top = 80
    Width = 217
    Height = 20
    Ctl3D = False
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentCtl3D = False
    ParentFont = False
    TabOrder = 2
  end
  object Button1: TButton
    Left = 8
    Top = 112
    Width = 241
    Height = 41
    Caption = '&Registration'
    TabOrder = 3
    OnClick = Button1Click
  end
  object Panel1: TPanel
    Left = 259
    Top = 112
    Width = 78
    Height = 100
    BevelOuter = bvNone
    BorderStyle = bsSingle
    Ctl3D = False
    ParentCtl3D = False
    TabOrder = 4
    object Image1: TImage
      Left = 0
      Top = 0
      Width = 76
      Height = 98
      Align = alClient
    end
  end
  object Button2: TButton
    Left = 496
    Top = 496
    Width = 161
    Height = 25
    Caption = '&Copy Finger Data to clipboard'
    TabOrder = 5
    OnClick = Button2Click
  end
  object memo2: TRichEdit
    Left = 8
    Top = 232
    Width = 329
    Height = 257
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentFont = False
    ReadOnly = True
    ScrollBars = ssBoth
    TabOrder = 6
  end
  object Memo1: TRichEdit
    Left = 344
    Top = 40
    Width = 313
    Height = 449
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentFont = False
    ReadOnly = True
    ScrollBars = ssBoth
    TabOrder = 7
  end
  object FinFPReg1: TFinFPReg
    AutoConnect = False
    ConnectKind = ckRunningOrNew
    OnFPRegistrationStatus = FinFPReg1FPRegistrationStatus
    OnFPRegistrationTemplate = FinFPReg1FPRegistrationTemplate
    OnFPSamplesNeeded = FinFPReg1FPSamplesNeeded
    OnFPRegistrationImage = FinFPReg1FPRegistrationImage
    Left = 504
    Top = 8
  end
end
