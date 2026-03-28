VERSION 5.00
Begin VB.Form Form1 
   BorderStyle     =   3  'Fixed Dialog
   Caption         =   "Fingerprint Registration"
   ClientHeight    =   6945
   ClientLeft      =   45
   ClientTop       =   375
   ClientWidth     =   8985
   LinkTopic       =   "Form1"
   MaxButton       =   0   'False
   MinButton       =   0   'False
   ScaleHeight     =   6945
   ScaleWidth      =   8985
   ShowInTaskbar   =   0   'False
   StartUpPosition =   3  'Windows Default
   Begin VB.CommandButton Command2 
      Caption         =   "Copy template to clipboard"
      Height          =   375
      Left            =   6480
      TabIndex        =   13
      Top             =   6480
      Width           =   2415
   End
   Begin VB.PictureBox picSample 
      Height          =   1695
      Left            =   3120
      ScaleHeight     =   1635
      ScaleWidth      =   1275
      TabIndex        =   7
      Top             =   1440
      Width           =   1335
   End
   Begin VB.TextBox Text3 
      Height          =   315
      Left            =   1740
      TabIndex        =   5
      Top             =   960
      Width           =   2715
   End
   Begin VB.TextBox Text2 
      Height          =   315
      Left            =   1740
      TabIndex        =   3
      Top             =   540
      Width           =   2715
   End
   Begin VB.TextBox Text1 
      Height          =   315
      Left            =   1740
      TabIndex        =   1
      Top             =   120
      Width           =   2715
   End
   Begin VB.CommandButton Command1 
      Caption         =   "Registration"
      Height          =   735
      Left            =   120
      TabIndex        =   6
      Top             =   1440
      Width           =   2895
   End
   Begin VB.TextBox Text4 
      BackColor       =   &H8000000F&
      Height          =   3135
      Left            =   120
      Locked          =   -1  'True
      MultiLine       =   -1  'True
      TabIndex        =   9
      Top             =   3240
      Width           =   4335
   End
   Begin VB.TextBox Text5 
      Height          =   5895
      Left            =   4560
      Locked          =   -1  'True
      MultiLine       =   -1  'True
      TabIndex        =   12
      Top             =   480
      Width           =   4335
   End
   Begin VB.Label Label5 
      Caption         =   "Please stop any fingerprint process before registering"
      ForeColor       =   &H000000FF&
      Height          =   255
      Left            =   120
      TabIndex        =   10
      Top             =   6540
      Width           =   6255
   End
   Begin VB.Label Label6 
      Caption         =   "Template"
      Height          =   255
      Left            =   4560
      TabIndex        =   11
      Top             =   120
      Width           =   1335
   End
   Begin VB.Label Label3 
      Caption         =   "Activation Code"
      Height          =   255
      Left            =   120
      TabIndex        =   4
      Top             =   990
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
   Begin VB.Label Label1 
      Caption         =   "Device Serial Nuber"
      Height          =   255
      Left            =   120
      TabIndex        =   0
      Top             =   150
      Width           =   1575
   End
   Begin VB.Label Label4 
      Caption         =   "Information"
      Height          =   255
      Left            =   120
      TabIndex        =   8
      Top             =   2880
      Width           =   1335
   End
End
Attribute VB_Name = "Form1"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit
Dim WithEvents FPReg As FlexCodeSDK.FinFPReg
Attribute FPReg.VB_VarHelpID = -1

Private Sub Command2_Click()
  Clipboard.Clear
  Clipboard.SetText Text5.Text
End Sub

Private Sub Form_Load()
  Set FPReg = New FlexCodeSDK.FinFPReg
  FPReg.PictureSamplePath = App.Path & "\FPTemp.BMP"
  FPReg.PictureSampleHeight = picSample.Height
  FPReg.PictureSampleWidth = picSample.Width
End Sub

Private Sub Command1_Click()
  If Command1.Caption = "Registration" Then
    Command1.Caption = "Cancel"
    FPReg.DeviceInfo Text1.Text, Text2.Text, Text3.Text
    FPReg.FPRegistrationStart "MySecretKey"
  Else
    Command1.Caption = "Registration"
    FPReg.FPRegistrationStop
  End If
End Sub

Private Sub Form_Unload(Cancel As Integer)
  If Command1.Caption <> "Registration" Then
    FPReg.FPRegistrationStop
  End If
End Sub

Private Sub FPReg_FPRegistrationImage()
  picSample = LoadPicture(App.Path & "\FPTemp.BMP")
End Sub

Private Sub FPReg_FPRegistrationStatus(ByVal Status As FlexCodeSDK.RegistrationStatus)
  Select Case Status
    Case r_OK
      UpdateInfo "Registration Success"
      Command1.Caption = "Registration"
      
    Case r_RegistrationFailed
      UpdateInfo "Registration Fail"
      Command1.Caption = "Registration"
      
    Case r_NoDevice
      UpdateInfo "Please connect the device to USB port"
      Command1.Caption = "Registration"
      
    Case r_PoorImageQuality
      UpdateInfo "Poor image quality"
      
    Case r_ActivationIncorrect
      UpdateInfo "Activation / verification code is incorrent or not set"
           
    Case r_RegistrationCaptureStart
      UpdateInfo "Registration Start"
      
    Case r_RegistrationCaptureStop
      UpdateInfo "Registration Stop"
  End Select
End Sub

Private Sub FPReg_FPRegistrationTemplate(ByVal FPTemplate As String)
  Text5.Text = FPTemplate
End Sub

Private Sub FPReg_FPSamplesNeeded(ByVal Samples As Integer)
  UpdateInfo "Samples Needed " & Str(Samples)
End Sub

Public Sub UpdateInfo(vsDialog As String)
  Text4.Text = Text4.Text & vbCrLf & vsDialog
  Text4.SelStart = Len(Text4.Text)
  If Mid(Text4.Text, 1, Len(vbCrLf)) = vbCrLf Then
    Text4.Text = Mid(Text4.Text, Len(vbCrLf) + 1, Len(Text4.Text))
  End If
End Sub

