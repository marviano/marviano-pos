VERSION 5.00
Begin VB.Form Form2 
   BorderStyle     =   1  'Fixed Single
   Caption         =   "Fingerprint Identification"
   ClientHeight    =   7680
   ClientLeft      =   45
   ClientTop       =   375
   ClientWidth     =   4680
   LinkTopic       =   "Form2"
   MaxButton       =   0   'False
   MinButton       =   0   'False
   ScaleHeight     =   7680
   ScaleWidth      =   4680
   StartUpPosition =   3  'Windows Default
   Begin VB.Frame Frame1 
      Caption         =   "Add Templates for Test Speed"
      Height          =   1095
      Left            =   120
      TabIndex        =   23
      Top             =   2040
      Width           =   4455
      Begin VB.CommandButton Command5 
         Caption         =   "Add as 1999 templates "
         Height          =   375
         Left            =   2280
         TabIndex        =   26
         Top             =   610
         Width           =   2055
      End
      Begin VB.CommandButton Command8 
         Caption         =   "Paste from clipboard"
         Height          =   375
         Left            =   2280
         TabIndex        =   25
         Top             =   240
         Width           =   2055
      End
      Begin VB.TextBox Text7 
         Height          =   735
         Left            =   120
         MultiLine       =   -1  'True
         TabIndex        =   24
         Top             =   240
         Width           =   2055
      End
   End
   Begin VB.CommandButton Command7 
      Caption         =   "Clear FP List"
      Height          =   375
      Left            =   2520
      TabIndex        =   22
      Top             =   4680
      Width           =   2055
   End
   Begin VB.CommandButton Command6 
      Caption         =   "Remove"
      Height          =   375
      Left            =   3720
      TabIndex        =   21
      Top             =   4320
      Width           =   855
   End
   Begin VB.CheckBox Check1 
      Caption         =   "Allow SDK working in background"
      Height          =   255
      Left            =   120
      TabIndex        =   19
      Top             =   5460
      Width           =   2895
   End
   Begin VB.CommandButton Command4 
      Caption         =   "Start Verify"
      Height          =   375
      Left            =   3120
      TabIndex        =   15
      Top             =   5400
      Width           =   1455
   End
   Begin VB.CommandButton Command2 
      Caption         =   "Paste from clipboard"
      Height          =   375
      Left            =   2400
      TabIndex        =   8
      Top             =   3240
      Width           =   2175
   End
   Begin VB.CommandButton Command1 
      Caption         =   "Add Device (Multi devices support)"
      Height          =   375
      Left            =   120
      TabIndex        =   6
      Top             =   1320
      Width           =   4455
   End
   Begin VB.ComboBox Combo1 
      Height          =   315
      ItemData        =   "Form2.frx":0000
      Left            =   720
      List            =   "Form2.frx":0022
      Style           =   2  'Dropdown List
      TabIndex        =   13
      Top             =   4770
      Width           =   1725
   End
   Begin VB.TextBox Text5 
      Height          =   315
      Left            =   720
      TabIndex        =   11
      Top             =   4320
      Width           =   1725
   End
   Begin VB.TextBox Text6 
      BackColor       =   &H8000000F&
      Height          =   1455
      Left            =   1560
      Locked          =   -1  'True
      MultiLine       =   -1  'True
      TabIndex        =   18
      Top             =   6120
      Width           =   3015
   End
   Begin VB.PictureBox picSample 
      Height          =   1695
      Left            =   120
      ScaleHeight     =   1635
      ScaleWidth      =   1275
      TabIndex        =   17
      Top             =   5880
      Width           =   1335
   End
   Begin VB.CommandButton Command3 
      Caption         =   "Add Template"
      Height          =   375
      Left            =   2520
      TabIndex        =   14
      Top             =   4320
      Width           =   1215
   End
   Begin VB.TextBox Text4 
      Height          =   495
      Left            =   120
      MultiLine       =   -1  'True
      TabIndex        =   9
      Top             =   3720
      Width           =   4455
   End
   Begin VB.TextBox Text1 
      Height          =   315
      Left            =   1740
      TabIndex        =   1
      Top             =   120
      Width           =   2835
   End
   Begin VB.TextBox Text2 
      Height          =   315
      Left            =   1740
      TabIndex        =   3
      Top             =   540
      Width           =   2835
   End
   Begin VB.TextBox Text3 
      Height          =   315
      Left            =   1740
      TabIndex        =   5
      Top             =   960
      Width           =   2835
   End
   Begin VB.Label Label8 
      Caption         =   "Please stop any fingerprint process before verifying"
      ForeColor       =   &H000000FF&
      Height          =   255
      Left            =   120
      TabIndex        =   20
      Top             =   1800
      Width           =   4455
   End
   Begin VB.Label Label5 
      Caption         =   "ID"
      Height          =   240
      Left            =   120
      TabIndex        =   10
      Top             =   4350
      Width           =   2220
   End
   Begin VB.Label Label6 
      Caption         =   "Finger"
      Height          =   240
      Left            =   120
      TabIndex        =   12
      Top             =   4800
      Width           =   2265
   End
   Begin VB.Label Label7 
      Caption         =   "Information"
      Height          =   255
      Left            =   1560
      TabIndex        =   16
      Top             =   5880
      Width           =   1335
   End
   Begin VB.Label Label4 
      Caption         =   "Template"
      Height          =   255
      Left            =   120
      TabIndex        =   7
      Top             =   3480
      Width           =   1575
   End
   Begin VB.Label Label1 
      Caption         =   "Device Serial Nuber"
      Height          =   255
      Left            =   120
      TabIndex        =   0
      Top             =   150
      Width           =   1575
   End
   Begin VB.Label Label2 
      Caption         =   "Verification Code"
      Height          =   255
      Left            =   120
      TabIndex        =   2
      Top             =   570
      Width           =   1575
   End
   Begin VB.Label Label3 
      Caption         =   "Activation Code"
      Height          =   255
      Left            =   120
      TabIndex        =   4
      Top             =   990
      Width           =   1575
   End
End
Attribute VB_Name = "Form2"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit
Dim WithEvents FPVer As FlexCodeSDK.FinFPVer
Attribute FPVer.VB_VarHelpID = -1

Private Sub Command1_Click()
  If FPVer.AddDeviceInfo(Text1.Text, Text2.Text, Text3.Text) Then
    MsgBox "Success", , "Add Device"
    Text1.Text = ""
    Text2.Text = ""
    Text3.Text = ""
    Text1.SetFocus
  Else
    MsgBox "Fail", , "Add Device"
  End If
End Sub

Private Sub Command2_Click()
  Text4.Text = Clipboard.GetText
End Sub

Private Sub Command3_Click()
  If FPVer.FPLoad(Text5.Text, GetFingerNumber(Combo1.Text), Text4.Text, "MySecretKey") Then
    MsgBox "Success. Total templates : " & CStr(FPVer.GetFPCount), , "Add Template"
  Else
    MsgBox "Fail", , "Add Template"
  End If
End Sub

Private Sub Command4_Click()
  If Check1.Value Then
    FPVer.WorkingInBackground True
  Else
    FPVer.WorkingInBackground False
  End If
  If Command4.Caption = "Start Verify" Then
    Text6.Text = ""
    Command4.Caption = "Stop Verify"
    FPVer.FPVerificationStart
  Else
    Command4.Caption = "Start Verify"
    FPVer.FPVerificationStop
  End If
End Sub

Private Sub Command5_Click()
  Dim i As Integer
  For i = 1 To 1999
    FPVer.FPLoad CStr(i), Fn_LeftIndex, Text7.Text, "MySecretKey"
  Next
  Text5.Text = 2000
  Text5.Locked = True
  MsgBox "Done! Please add another template"
End Sub

Private Sub Command6_Click()
  If FPVer.FPUnload(Text5.Text, GetFingerNumber(Combo1.Text)) Then
    MsgBox "Success. Total templates : " & CStr(FPVer.GetFPCount), , "Unload Template"
  Else
    MsgBox "Fail", , "Unload Template"
  End If
End Sub

Private Sub Command7_Click()
  FPVer.FPListClear
End Sub

Private Sub Command8_Click()
  Text7.Text = Clipboard.GetText
End Sub

Private Sub Form_Load()
  Set FPVer = New FlexCodeSDK.FinFPVer
  FPVer.PictureSamplePath = App.Path & "\FPTemp.BMP"
  FPVer.PictureSampleHeight = picSample.Height
  FPVer.PictureSampleWidth = picSample.Width
End Sub

Private Sub Form_Unload(Cancel As Integer)
  FPVer.FPVerificationStop
End Sub

Private Sub FPVer_FPVerificationID(ByVal ID As String, ByVal FingerNr As FlexCodeSDK.FingerNumber)
  UpdateInfo "ID = " & ID & ", FingerNr = " & Str(FingerNr)
End Sub

Private Sub FPVer_FPVerificationImage()
  picSample = LoadPicture(App.Path & "\FPTemp.BMP")
End Sub

Private Sub FPVer_FPVerificationStatus(ByVal Status As FlexCodeSDK.VerificationStatus)
  Select Case Status
    Case v_ActivationIncorrect
      UpdateInfo "Activation / verification code is incorrent"
      Command4.Caption = "Start Verify"
    Case v_FPListEmpty
      UpdateInfo "Please add some templates"
      Command4.Caption = "Start Verify"
    Case v_FPListFull
      UpdateInfo "Max 2000 templates"
    Case v_FPDevFull
      UpdateInfo "Max 10 devices"
    Case v_MultiplelMatch
      UpdateInfo "Multiple match"
    Case v_NoDevice
      UpdateInfo "Please connect the device to USB port"
      Command4.Caption = "Start Verify"
    Case v_NotMatch
      UpdateInfo "Not match"
    Case v_OK
      UpdateInfo "Match"
    Case v_PoorImageQuality
      UpdateInfo "Poor image quality"
    Case v_VerificationFailed
      UpdateInfo "Verification fail"
    Case v_VerifyCaptureFingerTouch
       UpdateInfo "Finger touch"
    Case v_VerifyCaptureStop
      UpdateInfo "Stop Verify"
      Command4.Caption = "Start Verify"
  End Select
End Sub

Public Sub UpdateInfo(vsDialog As String)
  Text6.Text = Text6.Text & vbCrLf & vsDialog
  Text6.SelStart = Len(Text6.Text)
  If Mid(Text6.Text, 1, Len(vbCrLf)) = vbCrLf Then
    Text6.Text = Mid(Text6.Text, Len(vbCrLf) + 1, Len(Text6.Text))
  End If
End Sub

Private Function GetFingerNumber(Finger As String) As FingerNumber
  Dim j As FingerNumber
  
  'Finger Number
  Select Case Finger
    Case "Left Pinkie"
      j = Fn_LeftPinkie
    Case "Left Ring"
      j = Fn_LeftRing
    Case "Left Middle"
      j = Fn_LeftMiddle
    Case "Left Index"
      j = Fn_LeftIndex
    Case "Left Thumb"
      j = Fn_LeftThumb
    Case "Right Thumb"
      j = Fn_RightThumb
    Case "Right Index"
      j = Fn_RightIndex
    Case "Right Middle"
      j = Fn_RightMiddle
    Case "Right Ring"
      j = Fn_RightRing
    Case "Right Pinkie"
      j = Fn_RightPinkie
    Case "(None)"
      j = Fn_None
    Case Else
      j = Fn_None
  End Select
  
  GetFingerNumber = j
End Function
