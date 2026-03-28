object FormMain: TFormMain
  Left = 587
  Top = 235
  BorderIcons = [biSystemMenu]
  BorderStyle = bsDialog
  Caption = 'Fingerspot FlexCode SDK Sample'
  ClientHeight = 124
  ClientWidth = 252
  Color = clWhite
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -11
  Font.Name = 'MS Sans Serif'
  Font.Style = []
  OldCreateOrder = False
  Position = poScreenCenter
  PixelsPerInch = 96
  TextHeight = 13
  object Button1: TButton
    Left = 7
    Top = 6
    Width = 240
    Height = 33
    Caption = 'Fingerprint &Registration'
    TabOrder = 0
    OnClick = Button1Click
  end
  object Button2: TButton
    Left = 7
    Top = 45
    Width = 240
    Height = 33
    Caption = 'Fingerprint &Identification'
    TabOrder = 1
    OnClick = Button2Click
  end
  object Button3: TButton
    Left = 7
    Top = 85
    Width = 240
    Height = 33
    Caption = '&Capture Fingerprint Image'
    TabOrder = 2
    OnClick = Button3Click
  end
end
