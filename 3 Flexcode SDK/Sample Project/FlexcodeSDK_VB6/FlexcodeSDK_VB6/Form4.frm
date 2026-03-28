VERSION 5.00
Begin VB.Form Form4 
   BorderStyle     =   1  'Fixed Single
   Caption         =   "Fingerspot FlexCode SDK Sample"
   ClientHeight    =   2280
   ClientLeft      =   45
   ClientTop       =   375
   ClientWidth     =   3840
   LinkTopic       =   "Form3"
   MaxButton       =   0   'False
   MinButton       =   0   'False
   ScaleHeight     =   2280
   ScaleWidth      =   3840
   StartUpPosition =   3  'Windows Default
   Begin VB.CommandButton Command1 
      Caption         =   "Capture Fingerprint Image"
      Height          =   615
      Index           =   2
      Left            =   120
      TabIndex        =   2
      Top             =   1560
      Width           =   3615
   End
   Begin VB.CommandButton Command1 
      Caption         =   "Fingerprint Indetification"
      Height          =   615
      Index           =   1
      Left            =   120
      TabIndex        =   1
      Top             =   840
      Width           =   3615
   End
   Begin VB.CommandButton Command1 
      Caption         =   "Fingerprint Registration"
      Height          =   615
      Index           =   0
      Left            =   120
      TabIndex        =   0
      Top             =   120
      Width           =   3615
   End
End
Attribute VB_Name = "Form4"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Private Sub Command1_Click(Index As Integer)
  Select Case Index
  Case 0
    Form1.Show
  Case 1
    Form2.Show
  Case 2
    Form3.Show
  End Select
End Sub
