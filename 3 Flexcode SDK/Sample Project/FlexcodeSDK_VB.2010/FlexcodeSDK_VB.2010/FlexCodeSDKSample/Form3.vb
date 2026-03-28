Option Explicit On
Imports System.IO

Public Class Form3
    Dim WithEvents FPVer As FlexCodeSDK.FinFPVer

    Private Sub Form3_Disposed(ByVal sender As Object, ByVal e As System.EventArgs) Handles Me.Disposed
        FPVer.FPVerificationStop()
    End Sub

    Private Sub Form3_Load(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles MyBase.Load
        FPVer = New FlexCodeSDK.FinFPVer
        FPVer.PictureSamplePath = My.Application.Info.DirectoryPath & "\FPTemp.BMP"
        FPVer.PictureSampleHeight = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Height)
        FPVer.PictureSampleWidth = Microsoft.VisualBasic.Compatibility.VB6.PixelsToTwipsY(PictureBox1.Width)
    End Sub

    Private Sub FPVer_FPVerificationID(ByVal ID As String, ByVal FingerNr As FlexCodeSDK.FingerNumber) Handles FPVer.FPVerificationID
        TextBox6.Text = TextBox6.Text & vbNewLine & "ID = " & ID & ", FingerNr = " & FingerNr
    End Sub

    Private Sub FPVer_FPVerificationImage() Handles FPVer.FPVerificationImage
        TextBox6.Text = ""
        Dim imgFile As System.IO.FileStream = New System.IO.FileStream(My.Application.Info.DirectoryPath & "\FPTemp.BMP", System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite)
        Dim fileBytes(imgFile.Length) As Byte
        imgFile.Read(fileBytes, 0, fileBytes.Length)
        imgFile.Close()
        Dim ms As System.IO.MemoryStream = New MemoryStream(fileBytes)
        PictureBox1.Image = Image.FromStream(ms)
    End Sub

    Private Sub FPVer_FPVerificationStatus(ByVal Status As FlexCodeSDK.VerificationStatus) Handles FPVer.FPVerificationStatus
        Select Case Status
            Case FlexCodeSDK.VerificationStatus.v_ActivationIncorrect
                TextBox6.Text = TextBox6.Text & vbNewLine & "Activation / verification code is incorrent or not set"
            Case FlexCodeSDK.VerificationStatus.v_FPDevFull
                TextBox6.Text = TextBox6.Text & vbNewLine & "Max 10 devices"
            Case FlexCodeSDK.VerificationStatus.v_FPListEmpty
                TextBox6.Text = TextBox6.Text & vbNewLine & "Please add templates"
                Button4.Text = "Start Verification"
            Case FlexCodeSDK.VerificationStatus.v_FPListFull
                TextBox6.Text = TextBox6.Text & vbNewLine & "Max 2000 templates"
            Case FlexCodeSDK.VerificationStatus.v_MultiplelMatch
                TextBox6.Text = TextBox6.Text & vbNewLine & "Multiple match"
            Case FlexCodeSDK.VerificationStatus.v_NoDevice
                Button4.Text = "Start Verification"
                TextBox6.Text = TextBox6.Text & vbNewLine & "Please connect the device to USB port or Add a device"
            Case FlexCodeSDK.VerificationStatus.v_NotMatch
                TextBox6.Text = TextBox6.Text & vbNewLine & "No match"
            Case FlexCodeSDK.VerificationStatus.v_OK
                TextBox6.Text = TextBox6.Text & vbNewLine & "Match"
            Case FlexCodeSDK.VerificationStatus.v_PoorImageQuality
                TextBox6.Text = TextBox6.Text & vbNewLine & "Poor image quality"
            Case FlexCodeSDK.VerificationStatus.v_VerificationFailed
                TextBox6.Text = TextBox6.Text & vbNewLine & "Verification failed"
            Case FlexCodeSDK.VerificationStatus.v_VerifyCaptureFingerTouch
                TextBox6.Text = TextBox6.Text & vbNewLine & "Verify capture finger touch"
            Case FlexCodeSDK.VerificationStatus.v_VerifyCaptureStop
                TextBox6.Text = TextBox6.Text & vbNewLine & "Stop verify"
                Button4.Text = "Start Verification"
        End Select
    End Sub

    Private Sub Button1_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button1.Click
        If FPVer.AddDeviceInfo(TextBox1.Text, TextBox2.Text, TextBox3.Text) Then
            TextBox1.Text = ""
            TextBox2.Text = ""
            TextBox3.Text = ""
            MsgBox("Success")
        Else
            MsgBox("Fail")
        End If
    End Sub

    Private Sub Button2_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button2.Click
        TextBox4.Text = Clipboard.GetText
    End Sub

    Private Sub Button3_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button3.Click
        If FPVer.FPLoad(TextBox5.Text, GetFingerNumber(ComboBox1.Text), TextBox4.Text, "MySecretKey") Then
            MsgBox("Success. Total templates : " & CStr(FPVer.GetFPCount))
        Else
            MsgBox("Fail")
        End If
    End Sub

    Private Function GetFingerNumber(ByVal Finger As String) As FlexCodeSDK.FingerNumber
        Dim j As FlexCodeSDK.FingerNumber

        'Finger Number
        Select Case Finger
            Case "Left Pinkie"
                j = FlexCodeSDK.FingerNumber.Fn_LeftPinkie
            Case "Left Ring"
                j = FlexCodeSDK.FingerNumber.Fn_LeftRing
            Case "Left Middle"
                j = FlexCodeSDK.FingerNumber.Fn_LeftMiddle
            Case "Left Index"
                j = FlexCodeSDK.FingerNumber.Fn_LeftIndex
            Case "Left Thumb"
                j = FlexCodeSDK.FingerNumber.Fn_LeftThumb
            Case "Right Thumb"
                j = FlexCodeSDK.FingerNumber.Fn_RightThumb
            Case "Right Index"
                j = FlexCodeSDK.FingerNumber.Fn_RightIndex
            Case "Right Middle"
                j = FlexCodeSDK.FingerNumber.Fn_RightMiddle
            Case "Right Ring"
                j = FlexCodeSDK.FingerNumber.Fn_RightRing
            Case "Right Pinkie"
                j = FlexCodeSDK.FingerNumber.Fn_RightPinkie
            Case "(None)"
                j = FlexCodeSDK.FingerNumber.Fn_None
            Case Else
                j = FlexCodeSDK.FingerNumber.Fn_None
        End Select

        GetFingerNumber = j
    End Function

    Private Sub Button4_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button4.Click
        If CheckBox1.Checked Then
            FPVer.WorkingInBackground(True)
        Else
            FPVer.WorkingInBackground(False)
        End If
        If Button4.Text = "Start Verification" Then
            TextBox6.Text = ""
            Button4.Text = "Stop Verification"
            FPVer.FPVerificationStart()
        Else
            Button4.Text = "Start Verification"
            FPVer.FPVerificationStop()
        End If
    End Sub

    Private Sub Button5_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button5.Click
        Dim i As Integer
        For i = 1 To 1999
            FPVer.FPLoad(CStr(i), FlexCodeSDK.FingerNumber.Fn_LeftPinkie, TextBox7.Text, "MySecretKey")
        Next
        TextBox5.Text = 2000
        TextBox5.ReadOnly = True
        MsgBox("Done! Please add another template")
    End Sub

    Private Sub Button6_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button6.Click
        If FPVer.FPUnload(TextBox5.Text, GetFingerNumber(ComboBox1.Text)) Then
            MsgBox("Success. Total templates : " & CStr(FPVer.GetFPCount))
        Else
            MsgBox("Fail")
        End If
    End Sub

    Private Sub Button7_Click(ByVal sender As System.Object, ByVal e As System.EventArgs) Handles Button7.Click
        FPVer.FPListClear()
    End Sub
End Class