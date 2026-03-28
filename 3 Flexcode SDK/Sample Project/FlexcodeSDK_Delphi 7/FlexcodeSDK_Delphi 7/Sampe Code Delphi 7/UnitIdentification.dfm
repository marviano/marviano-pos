object FormIdentification: TFormIdentification
  Left = 564
  Top = 111
  BorderIcons = [biSystemMenu]
  BorderStyle = bsSingle
  Caption = 'Form Identification'
  ClientHeight = 555
  ClientWidth = 351
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
    Top = 138
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
    Left = 12
    Top = 261
    Width = 44
    Height = 13
    Caption = 'Template'
  end
  object Label5: TLabel
    Left = 56
    Top = 348
    Width = 11
    Height = 13
    Caption = 'ID'
  end
  object Label7: TLabel
    Left = 8
    Top = 381
    Width = 58
    Height = 13
    Caption = 'Finger Index'
  end
  object Label8: TLabel
    Left = 97
    Top = 450
    Width = 52
    Height = 13
    Caption = 'Information'
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
  object button1: TButton
    Left = 8
    Top = 112
    Width = 337
    Height = 25
    Caption = 'Add Device ( Multi Devices Support )'
    TabOrder = 3
    OnClick = button1Click
  end
  object GroupBox1: TGroupBox
    Left = 8
    Top = 160
    Width = 337
    Height = 81
    Caption = 'Add Template for Speed Test'
    TabOrder = 4
    object Button2: TButton
      Left = 206
      Top = 16
      Width = 123
      Height = 25
      Caption = '&Paste from clipboard'
      TabOrder = 0
      OnClick = Button2Click
    end
    object Button3: TButton
      Left = 206
      Top = 48
      Width = 123
      Height = 25
      Caption = 'Add as &1999 Templates'
      TabOrder = 1
      OnClick = Button3Click
    end
    object RichEdit1: TRichEdit
      Left = 8
      Top = 16
      Width = 193
      Height = 57
      ScrollBars = ssBoth
      TabOrder = 2
    end
  end
  object Button4: TButton
    Left = 214
    Top = 248
    Width = 123
    Height = 25
    Caption = 'Paste &from clipboard'
    TabOrder = 5
    OnClick = Button4Click
  end
  object Edit4: TEdit
    Left = 72
    Top = 344
    Width = 121
    Height = 21
    TabOrder = 6
  end
  object ComboBox1: TComboBox
    Left = 72
    Top = 378
    Width = 121
    Height = 21
    Style = csDropDownList
    ItemHeight = 13
    ItemIndex = 0
    TabOrder = 7
    Text = 'Left Pinkie'
    Items.Strings = (
      'Left Pinkie'
      'Left Ring'
      'Left Middle'
      'Left Index'
      'Left Thumb'
      'Right Thumb'
      'Right Index'
      'Right Middle'
      'Right Ring'
      'Right Pinkie')
  end
  object Button5: TButton
    Left = 200
    Top = 344
    Width = 83
    Height = 25
    Caption = 'Add &Template'
    TabOrder = 8
    OnClick = Button5Click
  end
  object Button6: TButton
    Left = 288
    Top = 344
    Width = 57
    Height = 25
    Caption = '&Remove'
    TabOrder = 9
    OnClick = Button6Click
  end
  object Button7: TButton
    Left = 200
    Top = 376
    Width = 145
    Height = 25
    Caption = 'Clear &FP List'
    TabOrder = 10
    OnClick = Button7Click
  end
  object CheckBox1: TCheckBox
    Left = 8
    Top = 424
    Width = 169
    Height = 17
    Caption = 'Allow working in background'
    TabOrder = 11
  end
  object Button8: TButton
    Left = 200
    Top = 416
    Width = 145
    Height = 25
    Caption = '&Start Verify'
    TabOrder = 12
    OnClick = Button8Click
  end
  object Panel1: TPanel
    Left = 8
    Top = 448
    Width = 78
    Height = 100
    BevelOuter = bvNone
    BorderStyle = bsSingle
    Ctl3D = False
    ParentCtl3D = False
    TabOrder = 13
    object Image1: TImage
      Left = 0
      Top = 0
      Width = 76
      Height = 98
      Align = alClient
    end
  end
  object RichEdit2: TRichEdit
    Left = 8
    Top = 280
    Width = 337
    Height = 57
    ScrollBars = ssBoth
    TabOrder = 14
  end
  object RichEdit3: TRichEdit
    Left = 96
    Top = 464
    Width = 249
    Height = 81
    ScrollBars = ssBoth
    TabOrder = 15
  end
  object FinFPVer1: TFinFPVer
    AutoConnect = False
    ConnectKind = ckRunningOrNew
    OnFPVerificationStatus = FinFPVer1FPVerificationStatus
    OnFPVerificationID = FinFPVer1FPVerificationID
    OnFPVerificationImage = FinFPVer1FPVerificationImage
    Left = 296
    Top = 8
  end
end
