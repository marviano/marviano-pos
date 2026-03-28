VERSION 5.00
Begin VB.Form Form3 
   BorderStyle     =   1  'Fixed Single
   Caption         =   "Capture Fingerprint Image"
   ClientHeight    =   5985
   ClientLeft      =   45
   ClientTop       =   375
   ClientWidth     =   5580
   LinkTopic       =   "Form3"
   MaxButton       =   0   'False
   MinButton       =   0   'False
   ScaleHeight     =   5985
   ScaleWidth      =   5580
   StartUpPosition =   3  'Windows Default
   Begin VB.CommandButton Command1 
      Caption         =   "Start scan..."
      Height          =   495
      Left            =   1800
      TabIndex        =   6
      Top             =   1440
      Width           =   3675
   End
   Begin VB.CommandButton Command2 
      Caption         =   "Capture next image"
      Height          =   495
      Left            =   885
      TabIndex        =   10
      Top             =   5400
      Width           =   4605
   End
   Begin VB.TextBox Text4 
      Height          =   315
      Left            =   885
      TabIndex        =   9
      Top             =   4920
      Width           =   4605
   End
   Begin VB.PictureBox picSample 
      Height          =   2040
      Left            =   885
      ScaleHeight     =   1980
      ScaleWidth      =   1530
      TabIndex        =   7
      TabStop         =   0   'False
      Top             =   2760
      Width           =   1590
   End
   Begin VB.TextBox Text3 
      Height          =   315
      Left            =   1815
      TabIndex        =   5
      Top             =   960
      Width           =   3675
   End
   Begin VB.TextBox Text2 
      Height          =   315
      Left            =   1815
      TabIndex        =   3
      Top             =   540
      Width           =   3675
   End
   Begin VB.TextBox Text1 
      Height          =   315
      Left            =   1815
      TabIndex        =   1
      Top             =   120
      Width           =   3675
   End
   Begin VB.Label Label5 
      Caption         =   "Please stop any fingerprint process before capturing"
      ForeColor       =   &H000000FF&
      Height          =   255
      Left            =   120
      TabIndex        =   11
      Top             =   2040
      Width           =   5295
   End
   Begin VB.Label Label4 
      Caption         =   "File Name"
      Height          =   285
      Left            =   120
      TabIndex        =   8
      Top             =   4965
      Width           =   915
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
End
Attribute VB_Name = "Form3"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit
Dim WithEvents FPImage As FlexCodeSDK.FinFPImg
Attribute FPImage.VB_VarHelpID = -1

Private Sub Command1_Click()
  If Command1.Caption = "Start scan..." Then
    Command1.Caption = "Stop scan..."
    FPImage.DeviceInfo Text1.Text, Text2.Text, Text3.Text
    FPImage.FPImageStart
  Else
    Command1.Caption = "Start scan..."
    FPImage.FPImageStop
  End If
End Sub

Private Sub Command2_Click()
  FPImage.PictureSamplePath = Text4.Text
End Sub

Private Sub Form_Load()
  Set FPImage = New FlexCodeSDK.FinFPImg
  Text4.Text = App.Path & "\Sample.bmp"
  FPImage.PictureSamplePath = Text4.Text
  FPImage.PictureSampleHeight = picSample.Height
  FPImage.PictureSampleWidth = picSample.Width
End Sub

Private Sub Form_Unload(Cancel As Integer)
  FPImage.FPImageStop
End Sub

Private Sub FPImage_FPImage()
  picSample = LoadPicture(Text4.Text)
End Sub

Private Sub FPImage_FPImageStatus(ByVal Status As FlexCodeSDK.FPImageStatus)
  Select Case Status
  Case Fi_ActivationIncorrect
    MsgBox "Activation / verification code is incorrent or not set"
    Command1.Caption = "Start scan..."
  Case Fi_NoDevice
    MsgBox "Please connect the device to USB port"
    Command1.Caption = "Start scan..."
  Case Fi_FPImageStop
    MsgBox "Stop Scan"
    Command1.Caption = "Start scan..."
  End Select
End Sub

