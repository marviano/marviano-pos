object FormCaptureImage: TFormCaptureImage
  Left = 186
  Top = 258
  Width = 370
  Height = 415
  Caption = 'Form Capture Fingerprint Image'
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
  object Label6: TLabel
    Left = 10
    Top = 146
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
  object Label4: TLabel
    Left = 82
    Top = 174
    Width = 29
    Height = 13
    Caption = 'Image'
  end
  object Label5: TLabel
    Left = 69
    Top = 317
    Width = 42
    Height = 13
    Caption = 'Filename'
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
    Width = 225
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
    Left = 120
    Top = 112
    Width = 225
    Height = 25
    Caption = '&Start Scan'
    TabOrder = 3
    OnClick = Button1Click
  end
  object Panel1: TPanel
    Left = 120
    Top = 172
    Width = 97
    Height = 133
    BevelOuter = bvNone
    BorderStyle = bsSingle
    Ctl3D = False
    ParentCtl3D = False
    TabOrder = 4
    object Image1: TImage
      Left = 0
      Top = 0
      Width = 95
      Height = 131
      Align = alClient
    end
  end
  object Edit4: TEdit
    Left = 120
    Top = 312
    Width = 225
    Height = 20
    Ctl3D = False
    Font.Charset = ANSI_CHARSET
    Font.Color = clWindowText
    Font.Height = -11
    Font.Name = 'Courier New'
    Font.Style = []
    ParentCtl3D = False
    ParentFont = False
    TabOrder = 5
  end
  object Button2: TButton
    Left = 120
    Top = 344
    Width = 225
    Height = 25
    Caption = '&Capture Next Image'
    TabOrder = 6
    OnClick = Button2Click
  end
  object FinFPImg1: TFinFPImg
    AutoConnect = False
    ConnectKind = ckRunningOrNew
    OnFPImageStatus = FinFPImg1FPImageStatus
    OnFPImage = FinFPImg1FPImage
    Left = 320
    Top = 8
  end
end
